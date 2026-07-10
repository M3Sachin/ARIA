import logging
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import User, WsTicket, get_db

logger = logging.getLogger(__name__)


def create_access_token(username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return {"username": payload["sub"], "role": payload["role"]}
    except JWTError:
        return None


async def seed_users(db: AsyncSession) -> None:
    accounts = [
        (settings.admin_username, settings.admin_password, "admin"),
        (settings.user_username, settings.user_password, "user"),
    ]
    for username, password, role in accounts:
        if not password:
            logger.warning("Password not configured for %s — account disabled", username)
            continue
        existing = await db.scalar(select(User).where(User.username == username, User.role == role))
        if existing:
            continue
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        db.add(User(username=username, password_hash=hashed, role=role))
    await db.commit()
    logger.info("Users seeded.")


async def authenticate_user(username: str, password: str, db: AsyncSession) -> dict | None | str:
    user = await db.scalar(select(User).where(User.username == username))
    if not user:
        return None

    now = datetime.now(timezone.utc)
    if user.locked_until and user.locked_until > now:
        remaining = int((user.locked_until - now).total_seconds() // 60) + 1
        return f"locked:{remaining}"

    if not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
        user.failed_attempts += 1
        if user.failed_attempts >= settings.max_login_attempts:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            logger.warning("Account locked: %s (too many failed attempts)", username)
        await db.commit()
        return None

    user.failed_attempts = 0
    user.locked_until = None
    await db.commit()
    return {
        "username": user.username,
        "role": user.role,
        "token": create_access_token(user.username, user.role),
    }


async def issue_ws_ticket(username: str, role: str, db: AsyncSession) -> str:
    ticket = secrets.token_urlsafe(settings.ws_ticket_token_bytes)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.ticket_expire_seconds)
    db.add(WsTicket(ticket=ticket, username=username, role=role, expires_at=expires_at))
    await db.commit()
    return ticket


async def consume_ws_ticket(ticket: str, db: AsyncSession) -> dict | None:
    stmt = (
        update(WsTicket)
        .where(WsTicket.ticket == ticket, WsTicket.used.is_(False), WsTicket.expires_at > func.now())
        .values(used=True)
        .returning(WsTicket.username, WsTicket.role)
    )
    result = await db.execute(stmt)
    await db.commit()
    row = result.one_or_none()
    return {"username": row.username, "role": row.role} if row else None


def get_current_user(request: Request) -> dict:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user = decode_access_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user
