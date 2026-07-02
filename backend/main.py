import json
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import database
import models
from routers import gardens, beds, species, tasks, settings as settings_router


def seed_plants(db):
    existing = db.query(models.PlantSpecies).count()
    if existing > 0:
        return
    data_path = os.path.join(os.path.dirname(__file__), "data", "plants.json")
    with open(data_path, encoding="utf-8") as f:  # explicit: Windows defaults to cp1252
        plants = json.load(f)
    for p in plants:
        db.add(models.PlantSpecies(**p, is_custom=False))
    db.commit()


def seed_seasonal_tasks(db):
    existing = db.query(models.SeasonalTask).count()
    if existing > 0:
        return
    tasks_data = [
        ("January", 1, "Order seeds", "Browse catalogues and order seeds for the coming season. Check what you have left over."),
        ("January", 1, "Service tools", "Clean, sharpen, and oil garden tools. Check for damage."),
        ("February", 2, "Check overwintering crops", "Inspect brassicas, roots left in ground, and any stored produce for rot or pest damage."),
        ("February", 2, "Start chitting potatoes", "Set seed potatoes in a cool bright place to develop chits before planting."),
        ("March", 3, "Apply mulch", "Top-dress beds with compost or well-rotted manure before the season gets going."),
        ("March", 3, "Check supports and structures", "Inspect canes, netting, frames, and greenhouse glazing before the growing season."),
        ("April", 4, "Harden off seedlings", "Move seedlings started indoors to a cold frame or sheltered spot to acclimatise before planting out."),
        ("April", 4, "Protect from late frosts", "Have fleece on hand — UK April frosts are common. Cover tender plants overnight if forecast."),
        ("May", 5, "Watch for pests", "Aphids, slugs, and caterpillars ramp up in May. Check plants regularly and act early."),
        ("June", 6, "Succession sow salads", "Sow another batch of lettuce, radish, and spinach for continuous harvest through summer."),
        ("July", 7, "Summer watering regime", "Water deeply 2–3 times per week rather than lightly daily. Morning watering reduces disease."),
        ("August", 8, "Harvest and store", "Harvest regularly to keep plants producing. Start thinking about storing onions, garlic, and squash."),
        ("September", 9, "Sow overwintering crops", "Sow spring onions, spinach, and winter lettuce for autumn and spring harvest."),
        ("September", 9, "Order garlic and onion sets", "Place orders for autumn-planted garlic and onion sets ready for October planting."),
        ("October", 10, "Plant garlic", "Plant garlic cloves into prepared beds this month or next for a July harvest."),
        ("October", 10, "Clear spent crops", "Remove finished summer crops, add to compost, and dig over or plant a green manure."),
        ("November", 11, "Protect tender plants", "Wrap vulnerable plants (banana, tree ferns, tender perennials) with fleece or straw."),
        ("November", 11, "Clean greenhouse", "Wash glass to let in maximum winter light. Clean pots, staging, and disinfect against pests."),
        ("December", 12, "Rest and plan", "Review the growing year. Note what worked and what didn't. Plan next year's rotation."),
        ("December", 12, "Winter prune fruit trees", "Prune apples and pears while dormant. Avoid pruning cherries and plums until summer."),
    ]
    for (month_name, month_num, name, desc) in tasks_data:
        db.add(models.SeasonalTask(name=name, description=desc, month=month_num, is_recurring=True))
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    data_dir = os.path.dirname(os.getenv("DATABASE_URL", "sqlite:////data/garden.db").replace("sqlite:///", ""))
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)
    models.Base.metadata.create_all(bind=database.engine)
    # Lightweight migrations: add columns if an older DB predates them.
    # SQLite has no "ADD COLUMN IF NOT EXISTS", so each is wrapped in try/except.
    from sqlalchemy import text
    migrations = [
        ("plant_placements", "x_pos REAL"),
        ("plant_placements", "y_pos REAL"),
        ("beds", "kind TEXT DEFAULT 'raised'"),
    ]
    with database.engine.connect() as conn:
        for table, col in migrations:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col}"))
                conn.commit()
            except Exception:
                pass  # column already exists
    db = database.SessionLocal()
    try:
        seed_plants(db)
        seed_seasonal_tasks(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Garden Planner", lifespan=lifespan)

# The UI is served same-origin, so CORS is not needed by default. If you ever
# host the frontend separately, set CORS_ORIGINS to a comma-separated list of
# allowed origins (e.g. "http://localhost:5173,https://garden.example.com").
_cors = os.getenv("CORS_ORIGINS", "").strip()
if _cors:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _cors.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(gardens.router)
app.include_router(beds.router)
app.include_router(species.router)
app.include_router(tasks.router)
app.include_router(settings_router.router)



@app.get("/api/export/json")
def export_json():
    db = database.SessionLocal()
    try:
        gardens_data = db.query(models.Garden).all()
        result = {"gardens": [], "species": [], "seasonal_tasks": []}
        for g in gardens_data:
            gd = {"id": g.id, "name": g.name, "grid_scale_cm": g.grid_scale_cm,
                  "width_units": g.width_units, "height_units": g.height_units, "beds": []}
            for b in g.beds:
                bd = {"id": b.id, "name": b.name, "x": b.x, "y": b.y,
                      "width": b.width, "height": b.height, "color": b.color,
                      "kind": b.kind, "placements": []}
                for p in b.placements:
                    bd["placements"].append({
                        "id": p.id, "species_id": p.species_id,
                        "species_name": p.species.name,
                        "planted_date": str(p.planted_date),
                        "quantity": p.quantity, "notes": p.notes,
                        "harvested_date": str(p.harvested_date) if p.harvested_date else None,
                        "x_pos": p.x_pos, "y_pos": p.y_pos,
                    })
                gd["beds"].append(bd)
            result["gardens"].append(gd)
        for s in db.query(models.PlantSpecies).all():
            result["species"].append({
                "name": s.name, "family": s.family,
                "is_custom": s.is_custom,
                "notes": s.notes,
            })
        for t in db.query(models.SeasonalTask).all():
            result["seasonal_tasks"].append({
                "name": t.name, "description": t.description,
                "month": t.month, "is_recurring": t.is_recurring,
            })
        return result
    finally:
        db.close()


# Serve static files — check local ./static first, then /app/static (Docker)
_here = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(_here, "static")
if not os.path.exists(static_dir):
    static_dir = "/app/static"
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    from fastapi.responses import FileResponse, HTMLResponse
    import re

    @app.get("/", include_in_schema=False)
    def serve_root():
        # Inject each asset's modification time as its cache-bust version, so
        # browsers always fetch fresh JS/CSS after an edit — no manual ?v=N bumps.
        with open(os.path.join(static_dir, "index.html"), encoding="utf-8") as f:
            html = f.read()
        for fname in ("app.js", "style.css"):
            path = os.path.join(static_dir, fname)
            if os.path.exists(path):
                v = str(int(os.path.getmtime(path)))
                html = re.sub(
                    rf"/static/{re.escape(fname)}(\?v=\w+)?",
                    f"/static/{fname}?v={v}",
                    html,
                )
        return HTMLResponse(html)

    @app.get("/sw.js", include_in_schema=False)
    def serve_sw():
        # Service worker must be served from the root so its scope covers "/"
        return FileResponse(os.path.join(static_dir, "sw.js"), media_type="application/javascript")
