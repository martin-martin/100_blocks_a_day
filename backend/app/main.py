"""FastAPI application: auth, per-user day plans + settings, and static PWA."""
import json
import re

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import auth, config, schemas
from .database import get_db, init_db
from .models import DayPlan, User

app = FastAPI(title="100 Blocks a Day")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def _valid_date(date: str) -> str:
    if not DATE_RE.match(date):
        raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD")
    return date


def _set_auth_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        key=config.COOKIE_NAME,
        value=auth.create_token(user),
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        max_age=config.TOKEN_TTL_HOURS * 3600,
        path="/",
    )


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
@app.post("/api/auth/register", response_model=schemas.UserOut)
def register(creds: schemas.Credentials, response: Response, db: Session = Depends(get_db)):
    if not config.ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registration is disabled")
    exists = db.scalar(select(User).where(User.username == creds.username))
    if exists:
        raise HTTPException(status_code=409, detail="Username already taken")
    user = User(username=creds.username, password_hash=auth.hash_password(creds.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_auth_cookie(response, user)
    return schemas.UserOut(username=user.username, day_start=user.day_start)


@app.post("/api/auth/login", response_model=schemas.UserOut)
def login(creds: schemas.Credentials, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == creds.username))
    if user is None or not auth.verify_password(creds.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _set_auth_cookie(response, user)
    return schemas.UserOut(username=user.username, day_start=user.day_start)


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(config.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me", response_model=schemas.UserOut)
def me(user: User = Depends(auth.get_current_user)):
    return schemas.UserOut(username=user.username, day_start=user.day_start)


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------
@app.put("/api/settings", response_model=schemas.UserOut)
def update_settings(
    body: schemas.SettingsIn,
    user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    user.day_start = body.day_start
    db.commit()
    return schemas.UserOut(username=user.username, day_start=user.day_start)


# --------------------------------------------------------------------------
# Day plans (history = every saved date)
# --------------------------------------------------------------------------
@app.get("/api/days", response_model=list[schemas.DaySummary])
def list_days(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(DayPlan).where(DayPlan.user_id == user.id).order_by(DayPlan.date.desc())
    ).all()
    out: list[schemas.DaySummary] = []
    for row in rows:
        try:
            blocks = json.loads(row.blocks)
        except (ValueError, TypeError):
            blocks = {}
        if blocks:
            out.append(schemas.DaySummary(date=row.date, count=len(blocks)))
    return out


@app.get("/api/days/{date}", response_model=schemas.PlanOut)
def get_day(
    date: str, user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)
):
    _valid_date(date)
    row = db.scalar(
        select(DayPlan).where(DayPlan.user_id == user.id, DayPlan.date == date)
    )
    blocks = {}
    if row is not None:
        try:
            blocks = json.loads(row.blocks)
        except (ValueError, TypeError):
            blocks = {}
    return schemas.PlanOut(date=date, blocks=blocks)


@app.put("/api/days/{date}", response_model=schemas.PlanOut)
def save_day(
    date: str,
    body: schemas.PlanIn,
    user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    _valid_date(date)
    row = db.scalar(
        select(DayPlan).where(DayPlan.user_id == user.id, DayPlan.date == date)
    )
    payload = json.dumps(body.blocks)
    if row is None:
        row = DayPlan(user_id=user.id, date=date, blocks=payload)
        db.add(row)
    else:
        row.blocks = payload
    db.commit()
    return schemas.PlanOut(date=date, blocks=body.blocks)


# --------------------------------------------------------------------------
# Static frontend (mounted last so /api routes win)
# --------------------------------------------------------------------------
if config.STATIC_DIR.is_dir():
    @app.get("/")
    def index():
        return FileResponse(config.STATIC_DIR / "index.html")

    app.mount("/", StaticFiles(directory=config.STATIC_DIR), name="static")
