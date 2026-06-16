from pydantic import BaseModel
from typing import Optional
from datetime import date


class AppSettingSchema(BaseModel):
    key: str
    value: str


class GardenCreate(BaseModel):
    name: str
    grid_scale_cm: float = 30.0
    width_units: int = 20
    height_units: int = 15


class GardenUpdate(BaseModel):
    name: Optional[str] = None
    grid_scale_cm: Optional[float] = None
    width_units: Optional[int] = None
    height_units: Optional[int] = None


class GardenOut(BaseModel):
    id: int
    name: str
    grid_scale_cm: float
    width_units: int
    height_units: int

    class Config:
        from_attributes = True


class BedCreate(BaseModel):
    name: str
    x: float
    y: float
    width: float
    height: float
    color: str = "#4a7c59"
    kind: str = "raised"


class BedUpdate(BaseModel):
    name: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    color: Optional[str] = None
    kind: Optional[str] = None


class BedOut(BaseModel):
    id: int
    garden_id: int
    name: str
    x: float
    y: float
    width: float
    height: float
    color: str
    kind: str = "raised"

    class Config:
        from_attributes = True


class PlantSpeciesCreate(BaseModel):
    name: str
    family: Optional[str] = None
    sow_indoor_start: Optional[int] = None
    sow_indoor_end: Optional[int] = None
    sow_outdoor_start: Optional[int] = None
    sow_outdoor_end: Optional[int] = None
    plant_out_start: Optional[int] = None
    plant_out_end: Optional[int] = None
    days_to_harvest_min: Optional[int] = None
    days_to_harvest_max: Optional[int] = None
    feeding_notes: Optional[str] = None
    feeding_frequency_days: Optional[int] = None
    watering_notes: Optional[str] = None
    spacing_cm: Optional[int] = None
    companion_plants: Optional[str] = None
    avoid_plants: Optional[str] = None
    notes: Optional[str] = None
    is_custom: bool = True


class PlantSpeciesOut(BaseModel):
    id: int
    name: str
    family: Optional[str]
    sow_indoor_start: Optional[int]
    sow_indoor_end: Optional[int]
    sow_outdoor_start: Optional[int]
    sow_outdoor_end: Optional[int]
    plant_out_start: Optional[int]
    plant_out_end: Optional[int]
    days_to_harvest_min: Optional[int]
    days_to_harvest_max: Optional[int]
    feeding_notes: Optional[str]
    feeding_frequency_days: Optional[int]
    watering_notes: Optional[str]
    spacing_cm: Optional[int]
    companion_plants: Optional[str]
    avoid_plants: Optional[str]
    notes: Optional[str]
    is_custom: bool

    class Config:
        from_attributes = True


class PlantPlacementCreate(BaseModel):
    species_id: int
    planted_date: date
    quantity: int = 1
    notes: Optional[str] = None
    x_pos: Optional[float] = None
    y_pos: Optional[float] = None


class PlantPlacementUpdate(BaseModel):
    planted_date: Optional[date] = None
    quantity: Optional[int] = None
    notes: Optional[str] = None
    harvested_date: Optional[date] = None
    x_pos: Optional[float] = None
    y_pos: Optional[float] = None


class PlantPlacementOut(BaseModel):
    id: int
    bed_id: int
    species_id: int
    species_name: str
    species_family: Optional[str]
    planted_date: date
    quantity: int
    notes: Optional[str]
    harvested_date: Optional[date]
    x_pos: Optional[float]
    y_pos: Optional[float]

    class Config:
        from_attributes = True


class SeasonalTaskCreate(BaseModel):
    name: str
    description: Optional[str] = None
    month: Optional[int] = None
    is_recurring: bool = True


class SeasonalTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    month: Optional[int] = None
    is_recurring: Optional[bool] = None


class SeasonalTaskOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    month: Optional[int]
    is_recurring: bool

    class Config:
        from_attributes = True


class TaskItem(BaseModel):
    type: str
    title: str
    description: str
    urgency: str
    placement_id: Optional[int] = None
    bed_name: Optional[str] = None
    plant_name: Optional[str] = None
