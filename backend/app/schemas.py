"""Pydantic request/response schemas."""
from typing import Dict

from pydantic import BaseModel, Field, field_validator


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("username")
    @classmethod
    def strip_username(cls, v: str) -> str:
        return v.strip()


class UserOut(BaseModel):
    username: str
    day_start: str


class SettingsIn(BaseModel):
    day_start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class PlanIn(BaseModel):
    # block index ("0".."99") -> category id
    blocks: Dict[str, str]


class PlanOut(BaseModel):
    date: str
    blocks: Dict[str, str]


class DaySummary(BaseModel):
    date: str
    count: int  # number of filled blocks
