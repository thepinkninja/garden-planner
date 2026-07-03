from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models import HarvestLog, PlantPlacement, Bed
from schemas import HarvestLogCreate, HarvestLogOut

router = APIRouter(prefix="/api/harvests", tags=["harvests"])


def _out(h: HarvestLog) -> HarvestLogOut:
    return HarvestLogOut(
        id=h.id,
        placement_id=h.placement_id,
        date=h.date,
        quantity=h.quantity,
        unit=h.unit,
        notes=h.notes,
        species_name=h.placement.species.name,
        variety=h.placement.variety,
        bed_name=h.placement.bed.name,
    )


@router.get("/", response_model=list[HarvestLogOut])
def list_harvests(garden_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    q = db.query(HarvestLog).join(PlantPlacement).join(Bed)
    if garden_id:
        q = q.filter(Bed.garden_id == garden_id)
    logs = q.order_by(HarvestLog.date.desc(), HarvestLog.id.desc()).all()
    return [_out(h) for h in logs]


@router.post("/{placement_id}", response_model=HarvestLogOut)
def log_harvest(placement_id: int, data: HarvestLogCreate, db: Session = Depends(get_db)):
    placement = db.query(PlantPlacement).filter(PlantPlacement.id == placement_id).first()
    if not placement:
        raise HTTPException(404, "Placement not found")
    log = HarvestLog(
        placement_id=placement_id,
        date=data.date,
        quantity=data.quantity,
        unit=data.unit,
        notes=data.notes,
    )
    db.add(log)
    if data.finished:
        placement.harvested_date = data.date
    db.commit()
    db.refresh(log)
    return _out(log)


@router.delete("/{harvest_id}")
def delete_harvest(harvest_id: int, db: Session = Depends(get_db)):
    log = db.query(HarvestLog).filter(HarvestLog.id == harvest_id).first()
    if not log:
        raise HTTPException(404, "Harvest not found")
    db.delete(log)
    db.commit()
    return {"ok": True}
