"""ORM models.

A user owns many day plans (one per calendar date). Each plan stores the
block -> category mapping as JSON. Per-user settings (currently just the day
start time) live on the user row so they sync across devices.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Stored as "HH:MM"; defines where the 100-block waking window starts.
    day_start: Mapped[str] = mapped_column(String(5), default="06:00")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    plans: Mapped[list["DayPlan"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class DayPlan(Base):
    __tablename__ = "day_plans"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_user_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # Calendar date as "YYYY-MM-DD" (the user's local date).
    date: Mapped[str] = mapped_column(String(10), index=True)
    # JSON object mapping block index ("0".."99") -> category id.
    blocks: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="plans")
