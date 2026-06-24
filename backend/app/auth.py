import hashlib
import secrets

from fastapi import Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import User

sessions: dict[str, str] = {}


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    salt, expected = password_hash.split("$", 1)
    return secrets.compare_digest(hash_password(password, salt), f"{salt}${expected}")


def seed_default_user(db: Session) -> None:
    if db.scalar(select(User).where(User.email == "admin@lyftr.local")):
        return
    db.add(
        User(
            email="admin@lyftr.local",
            name="Lyftr Admin",
            role="Operations Manager",
            password_hash=hash_password("admin123"),
        )
    )
    db.commit()


def create_session(user: User) -> str:
    token = secrets.token_urlsafe(32)
    sessions[token] = user.id
    return token


def user_from_token(db: Session, authorization: str | None) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    user_id = sessions.get(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def auth_header(authorization: str | None = Header(default=None)) -> str | None:
    return authorization
