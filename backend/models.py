from sqlalchemy import Column, Integer, String, Float, Date, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"
    key = Column(String, primary_key=True)
    value = Column(String)


class Garden(Base):
    __tablename__ = "gardens"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    grid_scale_cm = Column(Float, default=30.0)
    width_units = Column(Integer, default=20)
    height_units = Column(Integer, default=15)
    beds = relationship("Bed", back_populates="garden", cascade="all, delete-orphan")


class Bed(Base):
    __tablename__ = "beds"
    id = Column(Integer, primary_key=True, index=True)
    garden_id = Column(Integer, ForeignKey("gardens.id"), nullable=False)
    name = Column(String, nullable=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)
    color = Column(String, default="#4a7c59")
    kind = Column(String, default="raised")  # "raised" (rectangular bed) or "container" (round pot)
    garden = relationship("Garden", back_populates="beds")
    placements = relationship("PlantPlacement", back_populates="bed", cascade="all, delete-orphan")


class PlantSpecies(Base):
    __tablename__ = "plant_species"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    family = Column(String)
    sow_indoor_start = Column(Integer)
    sow_indoor_end = Column(Integer)
    sow_outdoor_start = Column(Integer)
    sow_outdoor_end = Column(Integer)
    plant_out_start = Column(Integer)
    plant_out_end = Column(Integer)
    days_to_harvest_min = Column(Integer)
    days_to_harvest_max = Column(Integer)
    feeding_notes = Column(Text)
    feeding_frequency_days = Column(Integer)
    watering_notes = Column(Text)
    spacing_cm = Column(Integer)
    companion_plants = Column(Text)
    avoid_plants = Column(Text)
    notes = Column(Text)
    is_custom = Column(Boolean, default=False)
    placements = relationship("PlantPlacement", back_populates="species")


class PlantPlacement(Base):
    __tablename__ = "plant_placements"
    id = Column(Integer, primary_key=True, index=True)
    bed_id = Column(Integer, ForeignKey("beds.id"), nullable=False)
    species_id = Column(Integer, ForeignKey("plant_species.id"), nullable=False)
    planted_date = Column(Date, nullable=False)
    quantity = Column(Integer, default=1)
    notes = Column(Text)
    harvested_date = Column(Date, nullable=True)
    x_pos = Column(Float, nullable=True)   # grid units relative to bed origin
    y_pos = Column(Float, nullable=True)
    bed = relationship("Bed", back_populates="placements")
    species = relationship("PlantSpecies", back_populates="placements")


class SeasonalTask(Base):
    __tablename__ = "seasonal_tasks"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    month = Column(Integer)
    is_recurring = Column(Boolean, default=True)
