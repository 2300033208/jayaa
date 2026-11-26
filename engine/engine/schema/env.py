"""Alembic environment: migrations run on the connection handed over by ``engine.schema.upgrade``."""

from __future__ import annotations

from alembic import context

from engine.db import Base

connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Run migrations through engine.schema.upgrade (python -m engine.manage migrate).")

context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True,
                  compare_type=True)
with context.begin_transaction():
    context.run_migrations()
