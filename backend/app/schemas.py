from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ExcludedDay(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    message: str


class ExcludedDays(BaseModel):
    days: list[ExcludedDay] = []


class SMBConfigIn(BaseModel):
    timezone: str
    duration: int = Field(ge=5, le=240)
    start_time: str = Field(pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    end_time: str = Field(pattern=r"^\d{2}:\d{2}(:\d{2})?$")
    days: list[int] = Field(min_length=1)
    excluded_days: ExcludedDays = ExcludedDays()


class SMBConfigOut(SMBConfigIn):
    model_config = ConfigDict(from_attributes=True)

    smb_id: str


class SlotOut(BaseModel):
    slot_start: datetime
    slot_end: datetime
    local_date: str
    local_start: str
    local_end: str


class AppointmentCreate(BaseModel):
    smb_id: str
    lead_name: str = Field(min_length=1, max_length=120)
    lead_id: str | None = None
    slot_start: datetime


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    smb_id: str
    lead_id: str
    status: Literal["ACTIVE", "CANCELLED"]
    slot_start: datetime
    slot_end: datetime
    lead_name: str


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: str
    role: str


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
