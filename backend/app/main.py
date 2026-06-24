import os
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .auth import auth_header, create_session, seed_default_user, user_from_token, verify_password
from .models import Appointment, SMBConfig, User
from .schemas import AppointmentCreate, AppointmentOut, LoginIn, LoginOut, SMBConfigIn, SMBConfigOut, SlotOut, UserOut
from .services import apply_config, config_to_dict, create_appointment, generate_slots, install_indexes, seed_default_config

Base.metadata.create_all(bind=engine)
install_indexes()

app = FastAPI(title="Multi-Timezone Appointment Booking API")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_user(
    authorization: str | None = Depends(auth_header),
    db: Session = Depends(get_db),
) -> User:
    return user_from_token(db, authorization)


@app.post("/api/auth/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    seed_default_user(db)
    user = db.scalar(select(User).where(User.email == payload.email.lower().strip()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": create_session(user), "user": user}


@app.get("/api/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@app.get("/api/booking/config", response_model=SMBConfigOut)
def get_config(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return config_to_dict(seed_default_config(db))


@app.put("/api/booking/config", response_model=SMBConfigOut)
def update_config(payload: SMBConfigIn, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    config = seed_default_config(db)
    apply_config(config, payload)
    db.commit()
    db.refresh(config)
    return config_to_dict(config)


@app.get("/api/booking/slots", response_model=list[SlotOut])
def slots(
    smb_id: str,
    min_start_time: datetime = Query(...),
    max_end_time: datetime = Query(...),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = db.get(SMBConfig, smb_id)
    if not config:
        raise HTTPException(status_code=404, detail="Business configuration not found")
    return generate_slots(db, config, min_start_time, max_end_time)


@app.post("/api/booking/appointments", response_model=AppointmentOut, status_code=201)
def book_appointment(payload: AppointmentCreate, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    config = db.get(SMBConfig, payload.smb_id)
    if not config:
        raise HTTPException(status_code=404, detail="Business configuration not found")
    return create_appointment(db, config, payload)


@app.get("/api/booking/appointments", response_model=list[AppointmentOut])
def appointments(smb_id: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(Appointment)
            .where(Appointment.smb_id == smb_id)
            .order_by(Appointment.slot_start.asc())
        )
    )


@app.patch("/api/booking/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(appointment_id: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    appointment = db.get(Appointment, appointment_id)
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appointment.status = "CANCELLED"
    db.commit()
    db.refresh(appointment)
    return appointment
