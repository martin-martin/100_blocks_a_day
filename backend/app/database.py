"""Database engine / session setup (SQLAlchemy 2.0 + SQLite)."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import config

# check_same_thread=False is required for SQLite when used across FastAPI's
# threadpool; each request still gets its own session via get_db().
connect_args = {"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(config.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that yields a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create tables if they don't exist yet."""
    from . import models  # noqa: F401  (ensure models are registered)
    Base.metadata.create_all(bind=engine)
