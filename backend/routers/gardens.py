from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Garden, Bed, PlantPlacement
from schemas import GardenCreate, GardenOut, GardenUpdate, BedOut, PlantPlacementOut

router = APIRouter(prefix="/api/gardens", tags=["gardens"])


@router.get("/", response_model=list[GardenOut])
def list_gardens(db: Session = Depends(get_db)):
    return db.query(Garden).all()


@router.post("/", response_model=GardenOut)
def create_garden(data: GardenCreate, db: Session = Depends(get_db)):
    garden = Garden(**data.model_dump())
    db.add(garden)
    db.commit()
    db.refresh(garden)
    return garden


@router.get("/{garden_id}", response_model=GardenOut)
def get_garden(garden_id: int, db: Session = Depends(get_db)):
    garden = db.query(Garden).filter(Garden.id == garden_id).first()
    if not garden:
        raise HTTPException(404, "Garden not found")
    return garden


@router.patch("/{garden_id}", response_model=GardenOut)
def update_garden(garden_id: int, data: GardenUpdate, db: Session = Depends(get_db)):
    garden = db.query(Garden).filter(Garden.id == garden_id).first()
    if not garden:
        raise HTTPException(404, "Garden not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(garden, k, v)
    db.commit()
    db.refresh(garden)
    return garden


@router.delete("/{garden_id}")
def delete_garden(garden_id: int, db: Session = Depends(get_db)):
    garden = db.query(Garden).filter(Garden.id == garden_id).first()
    if not garden:
        raise HTTPException(404, "Garden not found")
    db.delete(garden)
    db.commit()
    return {"ok": True}


@router.get("/{garden_id}/beds", response_model=list[BedOut])
def get_beds(garden_id: int, db: Session = Depends(get_db)):
    return db.query(Bed).filter(Bed.garden_id == garden_id).all()


@router.get("/{garden_id}/placements", response_model=list[PlantPlacementOut])
def get_all_placements(garden_id: int, db: Session = Depends(get_db)):
    beds = db.query(Bed).filter(Bed.garden_id == garden_id).all()
    bed_ids = [b.id for b in beds]
    placements = db.query(PlantPlacement).filter(PlantPlacement.bed_id.in_(bed_ids)).all()
    return [
        PlantPlacementOut(
            id=p.id,
            bed_id=p.bed_id,
            species_id=p.species_id,
            species_name=p.species.name,
            species_family=p.species.family,
            planted_date=p.planted_date,
            quantity=p.quantity,
            variety=p.variety,
            notes=p.notes,
            harvested_date=p.harvested_date,
            x_pos=p.x_pos,
            y_pos=p.y_pos,
        )
        for p in placements
    ]
