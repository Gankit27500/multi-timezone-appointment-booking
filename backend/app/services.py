import json
import sqlite3
import threading
import uuid
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import and_, select, text
from sqlalchemy.orm import Session

from .database import engine
from .models import Appointment, SMBConfig
from .schemas import AppointmentCreate, ExcludedDays, SMBConfigIn, SlotOut

booking_lock = threading.Lock()


def normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise HTTPException(status_code=422, detail="Datetime values must include a timezone")
    return value.astimezone(UTC)


def parse_clock(value: str) -> time:
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        parts.append(0)
    return time(parts[0], parts[1], parts[2])


def config_to_dict(config: SMBConfig) -> dict:
    return {
        "smb_id": config.smb_id,
        "timezone": config.timezone,
        "duration": config.duration,
        "start_time": config.start_time,
        "end_time": config.end_time,
        "days": [int(day) for day in config.days.split(",") if day],
        "excluded_days": json.loads(config.excluded_days),
    }


def apply_config(config: SMBConfig, payload: SMBConfigIn) -> SMBConfig:
    try:
        ZoneInfo(payload.timezone)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Unknown IANA timezone") from exc

    if any(day < 1 or day > 7 for day in payload.days):
        raise HTTPException(status_code=422, detail="Weekdays must use 1=Monday through 7=Sunday")

    if parse_clock(payload.start_time) >= parse_clock(payload.end_time):
        raise HTTPException(status_code=422, detail="Business start_time must be before end_time")

    config.timezone = payload.timezone
    config.duration = payload.duration
    config.start_time = payload.start_time if len(payload.start_time) == 8 else f"{payload.start_time}:00"
    config.end_time = payload.end_time if len(payload.end_time) == 8 else f"{payload.end_time}:00"
    config.days = ",".join(str(day) for day in sorted(set(payload.days)))
    config.excluded_days = payload.excluded_days.model_dump_json()
    return config


def seed_default_config(db: Session) -> SMBConfig:
    config = db.scalar(select(SMBConfig).limit(1))
    if config:
        return config
    config = SMBConfig()
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def active_overlap_query(smb_id: str, slot_start: datetime, slot_end: datetime):
    return select(Appointment).where(
        Appointment.smb_id == smb_id,
        Appointment.status == "ACTIVE",
        Appointment.slot_start < slot_end,
        Appointment.slot_end > slot_start,
    )


def is_holiday(config: SMBConfig, local_date: str) -> bool:
    excluded = ExcludedDays.model_validate(json.loads(config.excluded_days))
    return any(day.day == local_date for day in excluded.days)


def validate_slot(db: Session, config: SMBConfig, slot_start: datetime) -> tuple[datetime, datetime]:
    slot_start = normalize_utc(slot_start)
    slot_end = slot_start + timedelta(minutes=config.duration)
    zone = ZoneInfo(config.timezone)
    local_start = slot_start.astimezone(zone)
    local_end = slot_end.astimezone(zone)

    if local_start.isoformat() < datetime.now(zone).isoformat():
        raise HTTPException(status_code=409, detail="Cannot book a slot in the past")
    if local_start.isoweekday() not in [int(day) for day in config.days.split(",") if day]:
        raise HTTPException(status_code=409, detail="Slot is on a non-working weekday")
    if is_holiday(config, local_start.date().isoformat()):
        raise HTTPException(status_code=409, detail="Slot is on a configured holiday")
    if local_start.date() != local_end.date():
        raise HTTPException(status_code=409, detail="Slot must fit inside one business day")
    if local_start.time() < parse_clock(config.start_time) or local_end.time() > parse_clock(config.end_time):
        raise HTTPException(status_code=409, detail="Slot is outside business hours")
    if db.scalar(active_overlap_query(config.smb_id, slot_start, slot_end)):
        raise HTTPException(status_code=409, detail="Slot is already booked")

    return slot_start, slot_end


def generate_slots(db: Session, config: SMBConfig, min_start: datetime, max_end: datetime) -> list[SlotOut]:
    min_start = normalize_utc(min_start)
    max_end = normalize_utc(max_end)
    if min_start >= max_end:
        raise HTTPException(status_code=422, detail="min_start_time must be before max_end_time")

    slots: list[SlotOut] = []
    step = timedelta(minutes=config.duration)
    zone = ZoneInfo(config.timezone)
    local_day = min_start.astimezone(zone).date()
    final_day = max_end.astimezone(zone).date()
    active_days = [int(day) for day in config.days.split(",") if day]
    business_start = parse_clock(config.start_time)
    business_end = parse_clock(config.end_time)

    while local_day <= final_day:
        if local_day.isoweekday() not in active_days or is_holiday(config, local_day.isoformat()):
            local_day += timedelta(days=1)
            continue

        local_cursor = datetime.combine(local_day, business_start, tzinfo=zone)
        while local_cursor.date() == local_day and local_cursor.time() < business_end:
            slot_start = local_cursor.astimezone(UTC)
            slot_end = slot_start + step
            if slot_end > max_end or slot_start >= max_end:
                break
            if slot_start >= min_start:
                try:
                    validated_start, validated_end = validate_slot(db, config, slot_start)
                except HTTPException:
                    local_cursor += step
                    continue

                local_start = validated_start.astimezone(zone)
                local_end = validated_end.astimezone(zone)
                slots.append(
                    SlotOut(
                        slot_start=validated_start,
                        slot_end=validated_end,
                        local_date=local_start.date().isoformat(),
                        local_start=local_start.strftime("%H:%M"),
                        local_end=local_end.strftime("%H:%M"),
                    )
                )
            local_cursor += step
        local_day += timedelta(days=1)

    return slots


def create_appointment(db: Session, config: SMBConfig, payload: AppointmentCreate) -> Appointment:
    with booking_lock:
        try:
            db.execute(text("BEGIN IMMEDIATE"))
        except sqlite3.OperationalError as exc:
            raise HTTPException(status_code=409, detail="Booking system is busy; retry in a moment") from exc

        slot_start, slot_end = validate_slot(db, config, payload.slot_start)
        appointment = Appointment(
            smb_id=config.smb_id,
            lead_id=payload.lead_id or str(uuid.uuid4()),
            lead_name=payload.lead_name.strip(),
            slot_start=slot_start,
            slot_end=slot_end,
        )
        db.add(appointment)
        db.commit()
        db.refresh(appointment)
        return appointment


def install_indexes() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_active_exact_slot "
                "ON appointments (smb_id, slot_start) WHERE status = 'ACTIVE'"
            )
        )
