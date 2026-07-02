from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import PlantSpecies
from schemas import PlantSpeciesCreate, PlantSpeciesOut, PlantSpeciesUpdate

router = APIRouter(prefix="/api/species", tags=["species"])


@router.get("/", response_model=list[PlantSpeciesOut])
def list_species(db: Session = Depends(get_db)):
    return db.query(PlantSpecies).order_by(PlantSpecies.name).all()


@router.post("/", response_model=PlantSpeciesOut)
def create_species(data: PlantSpeciesCreate, db: Session = Depends(get_db)):
    species = PlantSpecies(**data.model_dump())
    db.add(species)
    db.commit()
    db.refresh(species)
    return species


@router.get("/{species_id}", response_model=PlantSpeciesOut)
def get_species(species_id: int, db: Session = Depends(get_db)):
    s = db.query(PlantSpecies).filter(PlantSpecies.id == species_id).first()
    if not s:
        raise HTTPException(404, "Species not found")
    return s


@router.patch("/{species_id}", response_model=PlantSpeciesOut)
def update_species(species_id: int, data: PlantSpeciesUpdate, db: Session = Depends(get_db)):
    s = db.query(PlantSpecies).filter(PlantSpecies.id == species_id).first()
    if not s:
        raise HTTPException(404, "Species not found")
    # exclude_unset (not exclude_none): only touch fields the client sent,
    # and allow explicitly sending null to clear a field
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{species_id}")
def delete_species(species_id: int, db: Session = Depends(get_db)):
    s = db.query(PlantSpecies).filter(PlantSpecies.id == species_id).first()
    if not s:
        raise HTTPException(404, "Species not found")
    if s.placements:
        raise HTTPException(400, "Cannot delete species with existing placements")
    db.delete(s)
    db.commit()
    return {"ok": True}
