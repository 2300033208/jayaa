"""Relational schema (SQLAlchemy 2.0). SQLite for a single workstation, PostgreSQL for a shared server.

Large numerical documents (measurements, results, uploaded data, elevation grids) are stored as
zlib-compressed JSON or float arrays in binary columns; everything that is queried is a column.
Schema changes are applied by Alembic (``engine/schema``) at start-up.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from sqlalchemy import (JSON, Float, ForeignKey, Index, Integer, LargeBinary, String, UniqueConstraint, create_engine,
                        event)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

ID = String(32)
TIMESTAMP = String(32)  # ISO 8601 UTC with milliseconds and "Z": sorts chronologically as text
HASH = String(64)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # stored lower-case
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[str] = mapped_column(TIMESTAMP)
    password_changed_at: Mapped[str] = mapped_column(TIMESTAMP)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    token_hash: Mapped[str] = mapped_column(HASH, unique=True)  # SHA-256 of the cookie token; the token is never stored
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[float] = mapped_column(Float)  # epoch seconds
    last_seen_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float)  # absolute limit
    user_agent: Mapped[str] = mapped_column(String(200))


class Experiment(Base):
    __tablename__ = "experiments"
    __table_args__ = (UniqueConstraint("owner_id", "code", name="uq_experiment_owner_code"),
                      Index("ix_experiments_owner_updated", "owner_id", "updated_at"))
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[str] = mapped_column(TIMESTAMP)
    updated_at: Mapped[str] = mapped_column(TIMESTAMP)
    version: Mapped[int] = mapped_column(Integer)
    configuration_hash: Mapped[str] = mapped_column(HASH)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    terrain_model_id: Mapped[str | None] = mapped_column(ID, nullable=True, index=True)  # mirrors config, for lookups
    latest_simulation_id: Mapped[str | None] = mapped_column(ID, nullable=True)


class Simulation(Base):
    __tablename__ = "simulations"
    __table_args__ = (Index("ix_simulations_experiment_created", "experiment_id", "created_at"),
                      Index("ix_simulations_experiment_key", "experiment_id", "idempotency_key"))
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    created_at: Mapped[str] = mapped_column(TIMESTAMP)
    status: Mapped[str] = mapped_column(String(16), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON)


class SimulationDocument(Base):
    __tablename__ = "simulation_documents"
    simulation_id: Mapped[str] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)  # zlib-compressed JSON


class Study(Base):
    __tablename__ = "studies"
    __table_args__ = (Index("ix_studies_experiment_created", "experiment_id", "created_at"),)
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    created_at: Mapped[str] = mapped_column(TIMESTAMP)
    status: Mapped[str] = mapped_column(String(16), index=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)  # zlib-compressed JSON of the whole study document


class Dataset(Base):
    """Field measurements uploaded for an experiment's site."""

    __tablename__ = "datasets"
    __table_args__ = (Index("ix_datasets_experiment_created", "experiment_id", "created_at"),)
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    created_at: Mapped[str] = mapped_column(TIMESTAMP)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON)  # name, file name, checksum, row count, options, status
    columns: Mapped[bytes] = mapped_column(LargeBinary)  # zlib-compressed JSON of the parsed columns
    analysis: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # zlib-compressed JSON


class TerrainModel(Base):
    """An uploaded digital elevation model, immutable once stored."""

    __tablename__ = "terrain_models"
    __table_args__ = (Index("ix_terrain_models_owner_created", "owner_id", "created_at"),)
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[str] = mapped_column(TIMESTAMP)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON)  # name, file, checksum, georeference, size, height range
    grid: Mapped[bytes] = mapped_column(LargeBinary)  # zlib-compressed little-endian float32, row-major, NaN = no data


def default_database_url(data_dir: Path) -> str:
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(data_dir / 'engine.db').as_posix()}"


def database_url(data_dir: Path) -> str:
    return os.environ.get("DATABASE_URL") or default_database_url(data_dir)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001 - DB-API connection
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        return engine
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=10)
