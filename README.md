# Garden Planner

A self-hosted garden planning web app. Runs as a single Docker container with
an embedded SQLite database — no separate database server needed.

The whole app is one FastAPI process that serves both the JSON API and the web
UI (vanilla HTML/CSS/JS, no build step).

> ⚠️ **Security: LAN-only.** This app has **no authentication** — anyone who can
> reach it can read and edit your data. It's designed to run on a trusted home
> network. **Do not expose it directly to the internet.** If you need remote
> access, put it behind a VPN (e.g. WireGuard/Tailscale) or an authenticating
> reverse proxy.

> 🇬🇧 **UK-focused defaults.** The bundled plant data, sowing/harvest windows,
> and seasonal calendar assume a UK climate. Everything is editable in-app, and
> contributions for other regions are very welcome.

## Quick start (any Docker host)

```bash
docker compose up -d --build
```

Then open `http://<host-ip>:8079`. Data is stored in `./data/garden.db`.

## Running on Unraid

### Quick start (Compose Manager plugin — recommended)

1. Install the **Compose Manager** plugin from Community Applications (one-time).
2. Copy this whole folder to your server at `/mnt/user/appdata/garden-planner/`
   (over the network this is `\\<server>\appdata\garden-planner\`).
3. Unraid → **Docker** tab → **Compose Manager** → **Add New Stack** named
   `garden-planner`, then paste the contents of `docker-compose.yml` (already
   uses absolute paths for Unraid).
4. Click **Compose Up**. It builds the image and starts the container.
5. Open `http://<your-unraid-ip>:8080`.

### Alternative: build + add container via the Docker GUI

1. From a terminal on the server:
   ```bash
   cd /mnt/user/appdata/garden-planner
   docker build -t garden-planner:latest .
   ```
2. Unraid → **Docker** → **Add Container** (advanced view):
   - **Name:** `garden-planner`
   - **Repository:** `garden-planner:latest`
   - **Port:** Host `8080` → Container `8000`
   - **Path:** Host `/mnt/user/appdata/garden-planner/data` → Container `/data`
   - **Variable:** `DATABASE_URL` = `sqlite:////data/garden.db`
   - **Restart policy:** `unless-stopped`

### Updating

```bash
docker compose down
docker compose up -d --build
```

Your data in the mounted `data/` folder is untouched during updates.

## Data & backup

The entire database is a single file: **`data/garden.db`** (on Unraid:
`/mnt/user/appdata/garden-planner/data/garden.db`). Back up that one file and
you've backed up everything — include it in the Unraid **Appdata Backup**
plugin, or copy it periodically.

The app also offers a human-readable JSON export at **Settings → Export JSON**
(or `GET /api/export/json`).

## Configuration

Set via environment variables (in `docker-compose.yml`):

| Variable        | Default                        | Purpose                                            |
|-----------------|--------------------------------|----------------------------------------------------|
| `DATABASE_URL`  | `sqlite:////data/garden.db`    | Database location. Leave as-is for the bundled DB. |
| `CORS_ORIGINS`  | _(unset)_                      | Only needed if hosting the UI on a different origin. Comma-separated list. |

## Development (local)

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL=sqlite:///./garden.db uvicorn main:app --reload
```

Open `http://localhost:8000`. The UI is served directly from `backend/static/`
— edit those files and refresh the browser (bump the `?v=N` query string on the
script/style tags in `index.html` to bypass browser caching).

## Features

- **Garden layout editor** — draw raised beds on a grass-textured grid canvas by
  click-and-drag; soil-textured beds.
- **Drag-and-drop planting** — drag plant emoji from the palette onto a bed;
  reposition individual plants within a bed by dragging them.
- **Plant database** — 30 pre-loaded UK plants (veg, herbs, fruit); add/edit
  more via the Plants tab.
- **Task list** — generated from what's planted: harvest windows, feeding
  reminders, watering notes.
- **Seasonal calendar** — editable month-by-month garden tasks.
- **Settings** — grid scale, canvas size, JSON export.

## Project structure

```
gardening_app/
├── Dockerfile            # Packages the FastAPI backend (which serves the UI)
├── docker-compose.yml
├── data/                 # SQLite database lives here (gitignored)
└── backend/
    ├── main.py           # FastAPI app, seed data, static file serving
    ├── database.py       # SQLAlchemy engine/session
    ├── models.py         # SQLAlchemy models
    ├── schemas.py        # Pydantic schemas
    ├── routers/          # gardens, beds, species, tasks, settings
    ├── data/plants.json  # Seed plant data (30 UK plants)
    └── static/           # The web UI (index.html, app.js, style.css)
```

## Contributing

Contributions are welcome — bug fixes, plant data for other regions, plant
icons, and features. Open an issue to discuss larger changes first.

## License

Licensed under the **GNU Affero General Public License v3.0** — see
[`LICENSE`](LICENSE). In short: you're free to use, modify, and self-host it,
but if you run a modified version as a network service, you must make your
source changes available to its users.

Copyright (C) 2026 the Garden Planner contributors.
