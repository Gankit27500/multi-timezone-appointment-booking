import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class SMBConfig(Base):
    __tablename__ = "smb_booking_config"

    smb_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    timezone: Mapped[str] = mapped_column(String, nullable=False, default="America/New_York")
    duration: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    start_time: Mapped[str] = mapped_column(String, nullable=False, default="09:00:00")
    end_time: Mapped[str] = mapped_column(String, nullable=False, default="18:00:00")
    days: Mapped[str] = mapped_column(String, nullable=False, default="1,2,3,4,5")
    excluded_days: Mapped[str] = mapped_column(Text, nullable=False, default='{"days":[]}')


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, default="Admin")
    password_hash: Mapped[str] = mapped_column(String, nullable=False)


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    smb_id: Mapped[str] = mapped_column(String, ForeignKey("smb_booking_config.smb_id"), nullable=False)
    lead_id: Mapped[str] = mapped_column(String, nullable=False, default=lambda: str(uuid.uuid4()))
    status: Mapped[str] = mapped_column(String, nullable=False, default="ACTIVE")
    slot_start: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    slot_end: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    lead_name: Mapped[str] = mapped_column(String, nullable=False)
