from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date, timedelta
from typing import Optional
from database import get_db
from models import PlantPlacement, Bed, SeasonalTask, AppSettings, TaskCompletion
from schemas import TaskItem, SeasonalTaskCreate, SeasonalTaskOut, SeasonalTaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _get_setting(db, key, default=None):
    s = db.query(AppSettings).filter(AppSettings.key == key).first()
    return s.value if s else default


def _latest_completions(db: Session) -> dict:
    """Latest completion date per task key."""
    latest = {}
    for c in db.query(TaskCompletion).order_by(TaskCompletion.completed_date).all():
        latest[c.key] = c.completed_date
    return latest


def _generate_plant_tasks(db: Session, today: date, garden_id: Optional[int], done: dict) -> list[TaskItem]:
    tasks = []

    query = db.query(PlantPlacement).join(Bed)
    if garden_id:
        query = query.filter(Bed.garden_id == garden_id)

    placements = query.filter(PlantPlacement.harvested_date == None).all()

    for p in placements:
        sp = p.species
        bed_name = p.bed.name
        days_since = (today - p.planted_date).days

        # Harvest window
        if sp.days_to_harvest_min and sp.days_to_harvest_max:
            harvest_min = p.planted_date + timedelta(days=sp.days_to_harvest_min)
            harvest_max = p.planted_date + timedelta(days=sp.days_to_harvest_max)
            if today >= harvest_min and today <= harvest_max:
                urgency = "now"
                tasks.append(TaskItem(
                    type="harvest",
                    title=f"Harvest {sp.name}",
                    description=f"Ready to harvest in {bed_name}. Harvest window: {harvest_min.strftime('%d %b')} – {harvest_max.strftime('%d %b')}.",
                    urgency=urgency,
                    placement_id=p.id,
                    bed_name=bed_name,
                    plant_name=sp.name,
                ))
            elif harvest_min > today and (harvest_min - today).days <= 14:
                tasks.append(TaskItem(
                    type="harvest",
                    title=f"Harvest {sp.name} approaching",
                    description=f"{sp.name} in {bed_name} will be ready in {(harvest_min - today).days} days ({harvest_min.strftime('%d %b')}).",
                    urgency="soon",
                    placement_id=p.id,
                    bed_name=bed_name,
                    plant_name=sp.name,
                ))

        # Feeding tasks — scheduled from the last ticked-off feed when there is
        # one, otherwise from 14 days after planting.
        if sp.feeding_frequency_days and sp.feeding_notes:
            feed_key = f"feed:{p.id}"
            last_fed = done.get(feed_key)
            if last_fed:
                next_feed = last_fed + timedelta(days=sp.feeding_frequency_days)
            else:
                next_feed = p.planted_date + timedelta(days=14)
            days_until_feed = (next_feed - today).days
            if days_until_feed <= 0:
                overdue = -days_until_feed
                tasks.append(TaskItem(
                    type="feed",
                    title=f"Feed {sp.name}",
                    description=(f"Overdue by {overdue} days. " if overdue > 0 else "") + f"{sp.feeding_notes} ({bed_name})",
                    urgency="now",
                    placement_id=p.id,
                    bed_name=bed_name,
                    plant_name=sp.name,
                    key=feed_key,
                ))
            # Short heads-up window: must be < the shortest feed frequency,
            # or a just-ticked weekly feed instantly reappears as "soon"
            elif days_until_feed <= 2:
                tasks.append(TaskItem(
                    type="feed",
                    title=f"Feed {sp.name} soon",
                    description=f"Due in {days_until_feed} days. {sp.feeding_notes} ({bed_name})",
                    urgency="soon",
                    placement_id=p.id,
                    bed_name=bed_name,
                    plant_name=sp.name,
                    key=feed_key,
                ))

        # Watering reminders — appears when not ticked off in the last 7 days
        if sp.watering_notes:
            water_key = f"water:{p.id}"
            last_watered = done.get(water_key)
            if not last_watered or (today - last_watered).days >= 7:
                tasks.append(TaskItem(
                    type="water",
                    title=f"Water {sp.name}",
                    description=f"{sp.watering_notes} ({bed_name})",
                    urgency="routine",
                    placement_id=p.id,
                    bed_name=bed_name,
                    plant_name=sp.name,
                    key=water_key,
                ))

    return tasks


@router.get("/", response_model=list[TaskItem])
def get_tasks(
    garden_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    today = date.today()
    done = _latest_completions(db)
    tasks = _generate_plant_tasks(db, today, garden_id, done)

    # Seasonal tasks for this month and next — tickable once per month
    current_month = today.month
    next_month = (current_month % 12) + 1
    next_month_year = today.year + (1 if next_month < current_month else 0)
    seasonal = db.query(SeasonalTask).filter(
        SeasonalTask.month.in_([current_month, next_month])
    ).all()
    for s in seasonal:
        year = today.year if s.month == current_month else next_month_year
        key = f"seasonal:{s.id}:{year}-{s.month:02d}"
        if key in done:
            continue  # already ticked off for this month
        urgency = "now" if s.month == current_month else "soon"
        tasks.append(TaskItem(
            type="seasonal",
            title=s.name,
            description=s.description or "",
            urgency=urgency,
            key=key,
        ))

    # Sort: now → soon → routine
    order = {"now": 0, "soon": 1, "routine": 2}
    tasks.sort(key=lambda t: order.get(t.urgency, 3))
    return tasks


@router.post("/complete")
def complete_task(data: dict, db: Session = Depends(get_db)):
    key = (data or {}).get("key")
    if not key:
        raise HTTPException(400, "key required")
    db.add(TaskCompletion(key=key, completed_date=date.today()))
    db.commit()
    return {"ok": True}


@router.get("/succession/{placement_id}", response_model=list[dict])
def get_succession_suggestions(placement_id: int, db: Session = Depends(get_db)):
    placement = db.query(PlantPlacement).filter(PlantPlacement.id == placement_id).first()
    if not placement:
        raise HTTPException(404, "Placement not found")

    current_month = date.today().month
    current_family = placement.species.family

    from models import PlantSpecies
    candidates = db.query(PlantSpecies).filter(
        PlantSpecies.family != current_family,
        PlantSpecies.family != None,
    ).all()

    suggestions = []
    for sp in candidates:
        # Can sow outdoors this month?
        can_sow_outdoor = (
            sp.sow_outdoor_start and sp.sow_outdoor_end and
            sp.sow_outdoor_start <= current_month <= sp.sow_outdoor_end
        )
        # Can plant out this month?
        can_plant = (
            sp.plant_out_start and sp.plant_out_end and
            sp.plant_out_start <= current_month <= sp.plant_out_end
        )
        # Can sow indoors this month?
        can_sow_indoor = (
            sp.sow_indoor_start and sp.sow_indoor_end and
            sp.sow_indoor_start <= current_month <= sp.sow_indoor_end
        )

        if can_sow_outdoor or can_plant or can_sow_indoor:
            action = "Plant out" if can_plant else ("Sow outdoors" if can_sow_outdoor else "Sow indoors")
            suggestions.append({
                "id": sp.id,
                "name": sp.name,
                "family": sp.family,
                "action": action,
                "notes": sp.notes,
                "days_to_harvest_min": sp.days_to_harvest_min,
                "days_to_harvest_max": sp.days_to_harvest_max,
            })

    return suggestions[:10]


@router.get("/seasonal", response_model=list[SeasonalTaskOut])
def list_seasonal(db: Session = Depends(get_db)):
    return db.query(SeasonalTask).order_by(SeasonalTask.month).all()


@router.post("/seasonal", response_model=SeasonalTaskOut)
def create_seasonal(data: SeasonalTaskCreate, db: Session = Depends(get_db)):
    task = SeasonalTask(**data.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/seasonal/{task_id}", response_model=SeasonalTaskOut)
def update_seasonal(task_id: int, data: SeasonalTaskUpdate, db: Session = Depends(get_db)):
    task = db.query(SeasonalTask).filter(SeasonalTask.id == task_id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(task, k, v)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/seasonal/{task_id}")
def delete_seasonal(task_id: int, db: Session = Depends(get_db)):
    task = db.query(SeasonalTask).filter(SeasonalTask.id == task_id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}
