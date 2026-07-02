from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Bed, Garden, PlantPlacement
from schemas import BedCreate, BedOut, BedUpdate, PlantPlacementCreate, PlantPlacementOut, PlantPlacementUpdate

router = APIRouter(prefix="/api/beds", tags=["beds"])


@router.post("/{garden_id}", response_model=BedOut)
def create_bed(garden_id: int, data: BedCreate, db: Session = Depends(get_db)):
    garden = db.query(Garden).filter(Garden.id == garden_id).first()
    if not garden:
        raise HTTPException(404, "Garden not found")
    bed = Bed(garden_id=garden_id, **data.model_dump())
    db.add(bed)
    db.commit()
    db.refresh(bed)
    return bed


@router.patch("/{bed_id}", response_model=BedOut)
def update_bed(bed_id: int, data: BedUpdate, db: Session = Depends(get_db)):
    bed = db.query(Bed).filter(Bed.id == bed_id).first()
    if not bed:
        raise HTTPException(404, "Bed not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(bed, k, v)
    db.commit()
    db.refresh(bed)
    return bed


@router.delete("/{bed_id}")
def delete_bed(bed_id: int, db: Session = Depends(get_db)):
    bed = db.query(Bed).filter(Bed.id == bed_id).first()
    if not bed:
        raise HTTPException(404, "Bed not found")
    db.delete(bed)
    db.commit()
    return {"ok": True}


@router.get("/{bed_id}/placements", response_model=list[PlantPlacementOut])
def get_placements(bed_id: int, db: Session = Depends(get_db)):
    placements = db.query(PlantPlacement).filter(PlantPlacement.bed_id == bed_id).all()
    return [
        PlantPlacementOut(
            id=p.id,
            bed_id=p.bed_id,
            species_id=p.species_id,
            species_name=p.species.name,
            species_family=p.species.family,
            planted_date=p.planted_date,
            quantity=p.quantity,
            notes=p.notes,
            harvested_date=p.harvested_date,
            x_pos=p.x_pos,
            y_pos=p.y_pos,
        )
        for p in placements
    ]


@router.post("/{bed_id}/placements", response_model=PlantPlacementOut)
def add_placement(bed_id: int, data: PlantPlacementCreate, db: Session = Depends(get_db)):
    bed = db.query(Bed).filter(Bed.id == bed_id).first()
    if not bed:
        raise HTTPException(404, "Bed not found")
    placement = PlantPlacement(bed_id=bed_id, **data.model_dump())
    db.add(placement)
    db.commit()
    db.refresh(placement)
    return PlantPlacementOut(
        id=placement.id,
        bed_id=placement.bed_id,
        species_id=placement.species_id,
        species_name=placement.species.name,
        species_family=placement.species.family,
        planted_date=placement.planted_date,
        quantity=placement.quantity,
        notes=placement.notes,
        harvested_date=placement.harvested_date,
        x_pos=placement.x_pos,
        y_pos=placement.y_pos,
    )


@router.patch("/placements/{placement_id}", response_model=PlantPlacementOut)
def update_placement(placement_id: int, data: PlantPlacementUpdate, db: Session = Depends(get_db)):
    placement = db.query(PlantPlacement).filter(PlantPlacement.id == placement_id).first()
    if not placement:
        raise HTTPException(404, "Placement not found")
    # exclude_unset (not exclude_none): only touch fields the client sent,
    # and allow explicit nulls — e.g. {"harvested_date": null} to un-harvest
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(placement, k, v)
    db.commit()
    db.refresh(placement)
    return PlantPlacementOut(
        id=placement.id,
        bed_id=placement.bed_id,
        species_id=placement.species_id,
        species_name=placement.species.name,
        species_family=placement.species.family,
        planted_date=placement.planted_date,
        quantity=placement.quantity,
        notes=placement.notes,
        harvested_date=placement.harvested_date,
        x_pos=placement.x_pos,
        y_pos=placement.y_pos,
    )


@router.delete("/placements/{placement_id}")
def delete_placement(placement_id: int, db: Session = Depends(get_db)):
    placement = db.query(PlantPlacement).filter(PlantPlacement.id == placement_id).first()
    if not placement:
        raise HTTPException(404, "Placement not found")
    db.delete(placement)
    db.commit()
    return {"ok": True}
