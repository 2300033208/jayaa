"""Database schema migrations (Alembic), applied programmatically at start-up."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Engine

SCRIPT_LOCATION = Path(__file__).resolve().parent


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(SCRIPT_LOCATION))
    return cfg


def upgrade(engine: Engine) -> None:
    """Bring the database to the newest schema revision."""
    cfg = alembic_config()
    with engine.begin() as connection:
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, "head")
