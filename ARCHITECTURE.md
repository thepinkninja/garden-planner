# Garden Planner — Architecture

A self-hosted web app for planning a vegetable garden: draw raised beds on a
grid, drag plants into them, and get planting/harvest/feeding reminders. Built
to run as a **single Docker container** on a home server (Unraid).

---

## 1. High-level design

The whole thing is deliberately simple — **one process, one file database, no
build step**:

```
┌─────────────────────────── Docker container ───────────────────────────┐
│                                                                         │
│   FastAPI (Uvicorn)  ──────────────────────────────────────────────┐    │
│   ├── /api/*   JSON REST API  ──────────►  SQLAlchemy  ──►  SQLite  │    │
│   └── /  +  /static/*   serves the web UI (HTML/CSS/JS)            │    │
│                                                                    │    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │  volume mount
                              /data/garden.db  (the only stateful thing)
```

- **Backend:** Python + FastAPI, served by Uvicorn.
- **Database:** SQLite — an embedded, single-file DB (`garden.db`). No separate
  database server/container.
- **Frontend:** A vanilla-JS single-page app (no React/Vue, no bundler). It's
  three static files served straight from disk by the same FastAPI process.
- **Persistence:** Everything lives in one file on a mounted volume, so backups
  = copy one file.

There is intentionally **no auth** — it's a single-user app for a trusted LAN,
sitting behind a reverse proxy.

---

## 2. Tech stack

| Layer        | Choice                          | Why                                     |
|--------------|---------------------------------|-----------------------------------------|
| Web framework| FastAPI                         | Fast, typed, auto-generates API docs    |
| ASGI server  | Uvicorn                         | Standard FastAPI runtime                |
| ORM          | SQLAlchemy 2.0                  | Mature, DB-agnostic models              |
| Validation   | Pydantic (via FastAPI schemas)  | Request/response typing                 |
| Database     | SQLite                          | Zero-admin, single-file, ideal for 1 user |
| Frontend     | Vanilla HTML/CSS/JS + SVG       | No build step; canvas drawn with SVG    |
| Packaging    | Docker / docker-compose         | One-command deploy on Unraid            |

---

## 3. Repository layout

```
gardening_app/
├── Dockerfile              # Builds the single app image (Python + backend)
├── docker-compose.yml      # Deploy config (ports, volume, env)
├── .dockerignore
├── data/                   # SQLite DB lives here (mounted volume, gitignored)
└── backend/
    ├── main.py             # App entrypoint: startup, seeding, static serving
    ├── database.py         # SQLAlchemy engine + session factory
    ├── models.py           # ORM models (the DB schema)
    ├── schemas.py          # Pydantic request/response models
    ├── requirements.txt
    ├── data/plants.json    # Seed data: 30 UK plants
    ├── routers/            # API endpoints, grouped by resource
    │   ├── gardens.py
    │   ├── beds.py
    │   ├── species.py
    │   ├── tasks.py
    │   └── settings.py
    └── static/             # The entire frontend
        ├── index.html
        ├── app.js          # All UI logic + SVG canvas rendering
        └── style.css
```

---

## 4. Data model

Five core tables (SQLAlchemy models in `models.py`). Relationships cascade on
delete (deleting a garden removes its beds and their placements).

```
Garden ──1:N── Bed ──1:N── PlantPlacement ──N:1── PlantSpecies
                                                       │
SeasonalTask (standalone)                              │
AppSettings  (key/value)                               │
```

| Model            | Purpose                                                                 |
|------------------|-------------------------------------------------------------------------|
| `Garden`         | A plot. Holds grid scale (cm per square) and canvas size in grid units. |
| `Bed`            | A raised bed: position (`x,y`) and size (`width,height`) in grid units. |
| `PlantSpecies`   | A plant type and its agronomy: sow/plant/harvest windows, spacing, feeding/watering notes, companions. |
| `PlantPlacement` | An actual planting: which species, in which bed, when, quantity, and an optional `x_pos/y_pos` (position *within* the bed for the drag-and-drop layout). |
| `SeasonalTask`   | Editable month-by-month reminders (e.g. "October: plant garlic").       |
| `AppSettings`    | Simple key/value store for app config (frost dates, etc.).              |

**Coordinate system:** all positions are in *grid units* (not pixels). The
frontend multiplies by a pixels-per-unit factor (with zoom) at render time, so
the data is resolution-independent.

---

## 5. Backend

### Startup (`main.py`, FastAPI `lifespan`)
On boot the app:
1. Ensures the `/data` directory exists and creates all tables.
2. Runs a tiny **migration** (adds `x_pos`/`y_pos` columns if an older DB lacks
   them — wrapped in try/except since SQLite has no `ADD COLUMN IF NOT EXISTS`).
3. **Seeds** the 30 plants (`data/plants.json`) and the default seasonal task
   calendar — but only if those tables are empty, so it's safe on every restart.

### API surface
All endpoints are under `/api`. REST-ish, JSON in/out:

| Prefix              | What it manages                                              |
|---------------------|-------------------------------------------------------------|
| `/api/gardens`      | CRUD gardens; list a garden's beds/placements               |
| `/api/beds`         | CRUD beds; add/move/remove plant placements within a bed    |
| `/api/species`      | CRUD the plant database                                     |
| `/api/tasks`        | **Generated** to-do list + succession suggestions + seasonal task CRUD |
| `/api/settings`     | Get/set app settings (single + bulk)                        |
| `/api/export/json`  | Full data dump for backup                                   |

### The interesting bit — `tasks.py` (derived data)
Tasks aren't stored; they're **computed on request** from what's planted:
- **Harvest windows** — from each placement's planted date + the species'
  days-to-harvest range.
- **Feeding reminders** — from species feeding frequency.
- **Watering nudges** — weekly reminders during the growing period.
- **Seasonal tasks** — the month's (and next month's) calendar entries.
- **Succession suggestions** — when something is harvested, what to plant next
  in that spot, based on the current month's sow/plant windows.

Results are sorted **now → soon → routine**.

### Static serving
The same FastAPI app mounts `backend/static/` at `/static` and serves
`index.html` at `/`. So the API and UI share one origin and one port — no CORS
needed in the default setup (CORS is opt-in via a `CORS_ORIGINS` env var).

---

## 6. Frontend (`backend/static/`)

A hand-written SPA — no framework, no build tooling. `app.js` holds everything:

- A global state object `S` (gardens, beds, placements, species, settings, zoom,
  current drag, etc.).
- A thin `api` wrapper around `fetch` for the REST calls.
- Tab views: **Garden**, **Tasks**, **Plants**, **Calendar**, **Settings**.

### The garden canvas (the heart of the UI)
Rendered as **SVG**, redrawn from state:
- **Grass** background and **soil** beds use SVG `<pattern>` fills (textured look
  without image assets).
- **Beds** are drawn by click-dragging a rectangle on the canvas; resized by
  typing exact dimensions.
- **Plants** are emoji markers. A placement with quantity *N* renders *N*
  individual icons, each its own draggable element.
- **Drag-and-drop:** drag a species from the palette onto a bed to plant it; drag
  an existing icon to reposition it within the bed (persisted via `x_pos/y_pos`).
  Dragging one icon out of a multi-quantity planting **splits** it into its own
  record.

> Note on caching: because there's no build/hashing step, the script/style tags
> in `index.html` carry a manual `?v=N` query string that's bumped on changes to
> bust browser caches.

---

## 7. Deployment

### Container
`Dockerfile` is a plain `python:3.12-slim`: install `requirements.txt`, copy
`backend/`, run Uvicorn on port **8000** inside the container.

### Compose (`docker-compose.yml`)
- Publishes host **8079 → container 8000**.
- Mounts a host folder to **`/data`** (where `garden.db` lives).
- Sets `DATABASE_URL=sqlite:////data/garden.db`.
- `restart: unless-stopped`.

### Optional: clean URL behind a reverse proxy
The container is fully usable on its own at `http://<host>:8079`. If you want a
tidy hostname with no port (e.g. `http://garden.lan`), put any reverse proxy in
front of it — the typical home-server pattern:
```
Browser ──► Local DNS (hostname → proxy IP)        e.g. router / Pi-hole / AdGuard
             │
             ▼
        Reverse proxy (port 80/443)                e.g. Nginx Proxy Manager, Caddy, Traefik
             │  forwards to
             ▼
        garden-planner container  (host : 8079)
             │
             ▼
        SQLite file on a mounted volume
```
- Point the proxy's upstream at the Docker host's IP and port `8079`.
- Add a local DNS record mapping your chosen hostname to the proxy.
- On Unraid specifically: if the proxy runs on its own IP via a `br0`/macvlan
  network, enable **Settings → Docker → Host access to custom networks**, or the
  proxy won't be able to reach the app on the host IP.

### Configuration (env vars)
| Variable       | Default                     | Purpose                                   |
|----------------|-----------------------------|-------------------------------------------|
| `DATABASE_URL` | `sqlite:////data/garden.db` | DB location (SQLAlchemy URL).             |
| `CORS_ORIGINS` | _(unset)_                   | Comma-separated origins, only if the UI is hosted separately. |

---

## 8. Design choices & trade-offs

- **SQLite over Postgres/MySQL** — single user, low write volume; an embedded
  file DB means zero admin and trivial backups. The ORM is DB-agnostic, so
  switching to Postgres later is mostly a connection-string + driver change.
- **No frontend framework** — the UI is small and SVG-centric; vanilla JS keeps
  it dependency-free and buildless, at the cost of more manual DOM/state code.
- **No authentication** — scoped to a trusted home LAN behind a reverse proxy.
  Don't expose it to the internet as-is.
- **Computed tasks instead of stored** — the to-do list is always derived from
  current plantings, so it can never drift out of sync.

---

## 9. Backup & recovery

The entire application state is **one file**: `data/garden.db`. Back that up
(e.g. Unraid's Appdata Backup plugin) and you can restore the whole app by
dropping it back in place. A human-readable JSON export is also available at
`Settings → Export JSON` (`GET /api/export/json`).
```
