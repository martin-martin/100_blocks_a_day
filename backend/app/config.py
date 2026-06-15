"""Application configuration, read from environment variables.

All values have sensible local-dev defaults so the app runs out of the box.
For production (e.g. on the VPS) set at least BLOCKS_SECRET_KEY.
"""
import os
from pathlib import Path

# Directory that holds this backend package; the SQLite file lives alongside it
# by default so it survives restarts and is easy to back up.
BASE_DIR = Path(__file__).resolve().parent.parent

# Secret used to sign auth tokens. MUST be overridden in production.
# Generate a strong one with:  python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY = os.environ.get("BLOCKS_SECRET_KEY", "dev-insecure-key-change-me-in-production-0123456789")

# How long a login stays valid.
TOKEN_TTL_HOURS = int(os.environ.get("BLOCKS_TOKEN_TTL_HOURS", "720"))  # 30 days

# SQLAlchemy database URL. Defaults to a local SQLite file.
DATABASE_URL = os.environ.get(
    "BLOCKS_DATABASE_URL", f"sqlite:///{BASE_DIR / 'blocks.db'}"
)

# When true, the auth cookie is only sent over HTTPS. Enable in production.
COOKIE_SECURE = os.environ.get("BLOCKS_COOKIE_SECURE", "false").lower() == "true"

# Set to "false" to disable open self-service registration once your family
# accounts exist (new users would then be created manually / via a script).
ALLOW_REGISTRATION = os.environ.get("BLOCKS_ALLOW_REGISTRATION", "true").lower() == "true"

# Directory containing the built frontend (served by FastAPI as static files).
STATIC_DIR = Path(os.environ.get("BLOCKS_STATIC_DIR", BASE_DIR.parent / "static"))

COOKIE_NAME = "blocks_session"
