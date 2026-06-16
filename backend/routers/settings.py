from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import AppSettings
from schemas import AppSettingSchema

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULTS = {
    "last_frost_date": "2025-04-15",
    "first_frost_date": "2025-10-31",
    "region": "UK",
    "grid_px_per_unit": "40",
}


@router.get("/")
def get_settings(db: Session = Depends(get_db)) -> dict:
    rows = db.query(AppSettings).all()
    result = dict(DEFAULTS)
    for r in rows:
        result[r.key] = r.value
    return result


@router.post("/")
def set_setting(data: AppSettingSchema, db: Session = Depends(get_db)):
    existing = db.query(AppSettings).filter(AppSettings.key == data.key).first()
    if existing:
        existing.value = data.value
    else:
        db.add(AppSettings(key=data.key, value=data.value))
    db.commit()
    return {"ok": True}


@router.post("/bulk")
def set_settings_bulk(data: dict, db: Session = Depends(get_db)):
    for key, value in data.items():
        existing = db.query(AppSettings).filter(AppSettings.key == key).first()
        if existing:
            existing.value = str(value)
        else:
            db.add(AppSettings(key=key, value=str(value)))
    db.commit()
    return {"ok": True}
