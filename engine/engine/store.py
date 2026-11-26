"""Database-backed persistence for accounts, experiments, simulations, studies, field data and terrain."""

from __future__ import annotations

import json
import re
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from pydantic import ValidationError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from . import db
from .config import ExperimentConfig, configuration_hash
from .migrations import migrate_config
from .schema import upgrade
from .serialization import dumps

_ID_RE = re.compile(r"^[0-9a-f]{32}$")
COMPRESSION_LEVEL = 1  # measurement floats compress little; favour speed
CODE_ATTEMPTS = 5
GUEST_USER_ID = "00000000000000000000000000000001"
GUEST_EMAIL = "guest@simulator.local"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def valid_id(value: str) -> bool:
    return bool(_ID_RE.match(value))


def new_id() -> str:
    return uuid.uuid4().hex


def pack(value: Any) -> bytes:
    return zlib.compress(dumps(value).encode("utf-8"), COMPRESSION_LEVEL)


def unpack(blob: bytes) -> Any:
    return json.loads(zlib.decompress(blob).decode("utf-8"))


class EmailTaken(Exception):
    pass


def _experiment_dict(row: db.Experiment) -> dict[str, Any]:
    return {
        "id": row.id,
        "owner_id": row.owner_id,
        "code": row.code,
        "name": row.name,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "version": row.version,
        "configuration_hash": row.configuration_hash,
        "config": row.config,
        "latest_simulation_id": row.latest_simulation_id,
    }


def _user_dict(row: db.User) -> dict[str, Any]:
    return {"id": row.id, "email": row.email, "display_name": row.display_name, "password_hash": row.password_hash,
            "created_at": row.created_at, "password_changed_at": row.password_changed_at}


def _terrain_model_id(config: dict[str, Any]) -> str | None:
    env = config.get("environment")
    value = env.get("terrain_model_id") if isinstance(env, dict) else None
    return value if isinstance(value, str) else None


class Store:
    def __init__(self, url: str):
        self.engine = db.make_engine(url)
        upgrade(self.engine)

    def close(self) -> None:
        self.engine.dispose()

    def _session(self) -> DbSession:
        return DbSession(self.engine, expire_on_commit=False)

    # ------------------------------------------------------------------ users and sessions

    def create_user(self, email: str, display_name: str, password_hash: str) -> dict[str, Any]:
        now = utc_now()
        row = db.User(id=new_id(), email=email, display_name=display_name, password_hash=password_hash,
                      created_at=now, password_changed_at=now)
        try:
            with self._session() as s, s.begin():
                s.add(row)
        except IntegrityError as exc:
            raise EmailTaken(email) from exc
        return _user_dict(row)

    def user_by_email(self, email: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.scalar(select(db.User).where(db.User.email == email))
            return _user_dict(row) if row else None

    def user_by_id(self, user_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.get(db.User, user_id)
            return _user_dict(row) if row else None

    def get_or_create_guest_user(self) -> dict[str, Any]:
        with self._session() as s:
            row = s.get(db.User, GUEST_USER_ID)
            if row is not None:
                return _user_dict(row)
        now = utc_now()
        row = db.User(id=GUEST_USER_ID, email=GUEST_EMAIL, display_name="Guest User", password_hash="none",
                      created_at=now, password_changed_at=now)
        try:
            with self._session() as s, s.begin():
                s.merge(row)
        except Exception:
            pass
        with self._session() as s:
            row = s.get(db.User, GUEST_USER_ID)
            if row is not None:
                return _user_dict(row)
        return {"id": GUEST_USER_ID, "email": GUEST_EMAIL, "display_name": "Guest User", "password_hash": "none",
                "created_at": now, "password_changed_at": now}

    def set_password(self, user_id: str, password_hash: str) -> None:
        with self._session() as s, s.begin():
            s.execute(update(db.User).where(db.User.id == user_id)
                      .values(password_hash=password_hash, password_changed_at=utc_now()))

    def create_session(self, user_id: str, token_hash: str, now: float, expires_at: float, user_agent: str) -> str:
        session_id = new_id()
        with self._session() as s, s.begin():
            s.add(db.Session(id=session_id, token_hash=token_hash, user_id=user_id, created_at=now, last_seen_at=now,
                             expires_at=expires_at, user_agent=user_agent[:200]))
        return session_id

    def session_by_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.scalar(select(db.Session).where(db.Session.token_hash == token_hash))
            if row is None:
                return None
            return {"id": row.id, "user_id": row.user_id, "created_at": row.created_at,
                    "last_seen_at": row.last_seen_at, "expires_at": row.expires_at}

    def touch_session(self, session_id: str, now: float) -> None:
        with self._session() as s, s.begin():
            s.execute(update(db.Session).where(db.Session.id == session_id).values(last_seen_at=now))

    def delete_session(self, session_id: str) -> None:
        with self._session() as s, s.begin():
            s.execute(delete(db.Session).where(db.Session.id == session_id))

    def delete_sessions_for(self, user_id: str, keep: str | None = None) -> None:
        with self._session() as s, s.begin():
            query = delete(db.Session).where(db.Session.user_id == user_id)
            if keep is not None:
                query = query.where(db.Session.id != keep)
            s.execute(query)

    def purge_sessions(self, now: float, idle_limit_s: float) -> None:
        with self._session() as s, s.begin():
            s.execute(delete(db.Session).where((db.Session.expires_at <= now)
                                               | (db.Session.last_seen_at <= now - idle_limit_s)))

    def expire_all_sessions(self) -> None:
        """Test hook: every session becomes expired (the rows remain, so the expiry is reported)."""
        with self._session() as s, s.begin():
            s.execute(update(db.Session).values(expires_at=0.0))

    # ------------------------------------------------------------------ experiments

    def _next_code(self, s: DbSession, owner_id: str) -> str:
        codes = s.scalars(select(db.Experiment.code).where(db.Experiment.owner_id == owner_id)).all()
        numbers = [int(c.split("-")[1]) for c in codes if re.fullmatch(r"EXP-\d+", c)]
        return f"EXP-{(max(numbers) + 1 if numbers else 1):05d}"

    def create_experiment(self, owner_id: str, config: dict[str, Any], config_hash: str) -> dict[str, Any]:
        for attempt in range(CODE_ATTEMPTS):
            now = utc_now()
            try:
                with self._session() as s, s.begin():
                    row = db.Experiment(id=new_id(), owner_id=owner_id, code=self._next_code(s, owner_id),
                                        name=config["name"], created_at=now, updated_at=now, version=1,
                                        configuration_hash=config_hash, config=config,
                                        terrain_model_id=_terrain_model_id(config), latest_simulation_id=None)
                    s.add(row)
                return _experiment_dict(row)
            except IntegrityError:
                if attempt == CODE_ATTEMPTS - 1:
                    raise  # a concurrent create took the same code every time
        raise AssertionError("unreachable")

    def get_experiment(self, exp_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.get(db.Experiment, exp_id)
            if row is None:
                return None
            exp = _experiment_dict(row)
        upgraded = self._upgrade_config(exp)
        return upgraded or exp

    def _upgrade_config(self, exp: dict[str, Any]) -> dict[str, Any] | None:
        """Upgrade a configuration saved with an older schema (see migrations.py). Runs of the unchanged
        configuration stay current; runs of earlier versions stay out of date."""
        upgraded = migrate_config(exp.get("config"))
        if upgraded is None:
            return None
        try:
            new_hash = configuration_hash(ExperimentConfig.model_validate(upgraded))
        except ValidationError:
            return None  # not a readable configuration; left for the API to report
        old_hash = exp["configuration_hash"]
        with self._session() as s, s.begin():
            s.execute(update(db.Experiment).where(db.Experiment.id == exp["id"])
                      .values(config=upgraded, configuration_hash=new_hash))
            for row in s.scalars(select(db.Simulation).where(db.Simulation.experiment_id == exp["id"])):
                if row.meta.get("configuration_hash") == old_hash:
                    row.meta = {**row.meta, "configuration_hash": new_hash}
        return {**exp, "config": upgraded, "configuration_hash": new_hash}

    def experiment_exists(self, exp_id: str) -> bool:
        with self._session() as s:
            return s.get(db.Experiment, exp_id) is not None

    def update_experiment(self, exp_id: str, config: dict[str, Any], config_hash: str) -> dict[str, Any]:
        with self._session() as s, s.begin():
            row = s.get(db.Experiment, exp_id, with_for_update=True)
            if row is None:
                raise KeyError(exp_id)
            if config_hash != row.configuration_hash:
                row.version = row.version + 1
            row.config = config
            row.name = config["name"]
            row.configuration_hash = config_hash
            row.terrain_model_id = _terrain_model_id(config)
            row.updated_at = utc_now()
            return _experiment_dict(row)

    def set_latest_simulation(self, exp_id: str, sim_id: str) -> None:
        with self._session() as s, s.begin():
            s.execute(update(db.Experiment).where(db.Experiment.id == exp_id).values(latest_simulation_id=sim_id))

    def delete_experiment(self, exp_id: str) -> None:
        with self._session() as s, s.begin():
            # Children are removed explicitly as well as by ON DELETE CASCADE, so deletion does not depend
            # on the database enforcing foreign keys.
            sim_ids = s.scalars(select(db.Simulation.id).where(db.Simulation.experiment_id == exp_id)).all()
            if sim_ids:
                s.execute(delete(db.SimulationDocument).where(db.SimulationDocument.simulation_id.in_(sim_ids)))
            s.execute(delete(db.Simulation).where(db.Simulation.experiment_id == exp_id))
            s.execute(delete(db.Study).where(db.Study.experiment_id == exp_id))
            s.execute(delete(db.Dataset).where(db.Dataset.experiment_id == exp_id))
            s.execute(delete(db.Experiment).where(db.Experiment.id == exp_id))

    def list_experiments(self, owner_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        with self._session() as s:
            query = (select(db.Experiment).where(db.Experiment.owner_id == owner_id)
                     .order_by(db.Experiment.updated_at.desc()))
            if limit is not None:
                query = query.limit(limit)
            rows = [_experiment_dict(r) for r in s.scalars(query)]
        return [self._upgrade_config(e) or e for e in rows]

    def experiment_ids(self, owner_id: str | None = None) -> list[str]:
        with self._session() as s:
            query = select(db.Experiment.id)
            if owner_id is not None:
                query = query.where(db.Experiment.owner_id == owner_id)
            return list(s.scalars(query))

    def experiments_using_terrain(self, terrain_id: str) -> list[str]:
        with self._session() as s:
            return list(s.scalars(select(db.Experiment.code).where(db.Experiment.terrain_model_id == terrain_id)
                                  .order_by(db.Experiment.code)))

    # ------------------------------------------------------------------ simulations

    def save_sim_meta(self, meta: dict[str, Any]) -> bool:
        """Insert or update a run's status. Returns False (and stores nothing) if the experiment was deleted
        while the run finished."""
        with self._session() as s, s.begin():
            row = s.get(db.Simulation, meta["id"])
            if row is None:
                if s.get(db.Experiment, meta["experiment_id"]) is None:
                    return False
                s.add(db.Simulation(id=meta["id"], experiment_id=meta["experiment_id"], created_at=meta["created_at"],
                                    status=meta["status"], idempotency_key=meta.get("idempotency_key"), meta=meta))
            else:
                row.status = meta["status"]
                row.meta = meta
        return True

    def get_simulation(self, sim_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.get(db.Simulation, sim_id)
            return dict(row.meta) if row else None

    def simulations_for(self, exp_id: str) -> list[dict[str, Any]]:
        with self._session() as s:
            rows = s.scalars(select(db.Simulation).where(db.Simulation.experiment_id == exp_id)
                             .order_by(db.Simulation.created_at.desc()))
            return [dict(r.meta) for r in rows]

    def simulation_for_key(self, exp_id: str, key: str) -> str | None:
        with self._session() as s:
            return s.scalar(select(db.Simulation.id).where(db.Simulation.experiment_id == exp_id,
                                                          db.Simulation.idempotency_key == key))

    def fail_unfinished_simulations(self, active: Iterable[str]) -> int:
        """Runs that were active when the engine stopped cannot resume; they are marked failed."""
        count = 0
        with self._session() as s, s.begin():
            for row in s.scalars(select(db.Simulation).where(db.Simulation.status.in_(list(active)))):
                row.status = "failed"
                row.meta = {**row.meta, "status": "failed", "error": {
                    "code": "engine_restarted", "phase": row.meta.get("phase", ""),
                    "message": "The simulation engine restarted before this simulation finished."}}
                count += 1
        return count

    def save_sim_doc(self, sim_id: str, name: str, doc: Any) -> bool:
        """Store a run's document. Returns False if the run was deleted with its experiment meanwhile."""
        blob = pack(doc)
        with self._session() as s, s.begin():
            if s.get(db.Simulation, sim_id) is None:
                return False
            row = s.get(db.SimulationDocument, (sim_id, name))
            if row is None:
                s.add(db.SimulationDocument(simulation_id=sim_id, name=name, content=blob))
            else:
                row.content = blob
        return True

    def load_sim_doc(self, sim_id: str, name: str) -> Any | None:
        with self._session() as s:
            blob = s.scalar(select(db.SimulationDocument.content).where(db.SimulationDocument.simulation_id == sim_id,
                                                                         db.SimulationDocument.name == name))
        return unpack(blob) if blob is not None else None

    # ------------------------------------------------------------------ studies

    def save_study(self, study: dict[str, Any]) -> bool:
        """Insert or update a study. Returns False if its experiment was deleted meanwhile."""
        blob = pack(study)
        with self._session() as s, s.begin():
            row = s.get(db.Study, study["id"])
            if row is None:
                if s.get(db.Experiment, study["experiment_id"]) is None:
                    return False
                s.add(db.Study(id=study["id"], experiment_id=study["experiment_id"], created_at=study["created_at"],
                               status=study["status"], content=blob))
            else:
                row.status = study["status"]
                row.content = blob
        return True

    def get_study(self, study_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            blob = s.scalar(select(db.Study.content).where(db.Study.id == study_id))
        return unpack(blob) if blob is not None else None

    def studies_for(self, exp_id: str) -> list[dict[str, Any]]:
        with self._session() as s:
            blobs = s.scalars(select(db.Study.content).where(db.Study.experiment_id == exp_id)
                              .order_by(db.Study.created_at.desc())).all()
        return [unpack(b) for b in blobs]

    def fail_unfinished_studies(self) -> None:
        with self._session() as s, s.begin():
            for row in s.scalars(select(db.Study).where(db.Study.status.in_(["queued", "running"]))):
                doc = unpack(row.content)
                # The engine stopped while the study ran; its partial work is gone.
                doc = {**doc, "status": "failed", "error": {
                    "code": "engine_restarted", "message": "The engine restarted before the study finished. Start it again."}}
                row.status = "failed"
                row.content = pack(doc)

    # ------------------------------------------------------------------ field datasets

    def create_dataset(self, exp_id: str, meta: dict[str, Any], columns: dict[str, Any]) -> dict[str, Any]:
        dataset_id = new_id()
        now = utc_now()
        meta = {**meta, "id": dataset_id, "experiment_id": exp_id, "created_at": now, "updated_at": now}
        with self._session() as s, s.begin():
            s.add(db.Dataset(id=dataset_id, experiment_id=exp_id, created_at=now, meta=meta, columns=pack(columns),
                             analysis=None))
        return meta

    def get_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.get(db.Dataset, dataset_id)
            return dict(row.meta) if row else None

    def dataset_columns(self, dataset_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            blob = s.scalar(select(db.Dataset.columns).where(db.Dataset.id == dataset_id))
        return unpack(blob) if blob is not None else None

    def dataset_analysis(self, dataset_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            blob = s.scalar(select(db.Dataset.analysis).where(db.Dataset.id == dataset_id))
        return unpack(blob) if blob is not None else None

    def update_dataset(self, dataset_id: str, meta: dict[str, Any], analysis: dict[str, Any] | None = None,
                       clear_analysis: bool = False) -> dict[str, Any] | None:
        """Replace the dataset's metadata (and its analysis, when given). Returns None if it was deleted."""
        with self._session() as s, s.begin():
            row = s.get(db.Dataset, dataset_id)
            if row is None:
                return None
            row.meta = {**meta, "updated_at": utc_now()}
            if analysis is not None:
                row.analysis = pack(analysis)
            elif clear_analysis:
                row.analysis = None
            return dict(row.meta)

    def datasets_for(self, exp_id: str) -> list[dict[str, Any]]:
        with self._session() as s:
            rows = s.scalars(select(db.Dataset).where(db.Dataset.experiment_id == exp_id)
                             .order_by(db.Dataset.created_at.desc()))
            return [dict(r.meta) for r in rows]

    def delete_dataset(self, dataset_id: str) -> None:
        with self._session() as s, s.begin():
            s.execute(delete(db.Dataset).where(db.Dataset.id == dataset_id))

    def fail_unfinished_datasets(self) -> None:
        with self._session() as s, s.begin():
            for row in s.scalars(select(db.Dataset)):
                if row.meta.get("status") == "analysing":
                    row.meta = {**row.meta, "status": "failed", "error": {
                        "code": "engine_restarted",
                        "message": "The engine restarted before the analysis finished. Analyse it again."}}

    # ------------------------------------------------------------------ terrain models

    def create_terrain_model(self, owner_id: str, meta: dict[str, Any], grid: bytes) -> dict[str, Any]:
        terrain_id = new_id()
        now = utc_now()
        meta = {**meta, "id": terrain_id, "created_at": now}
        with self._session() as s, s.begin():
            s.add(db.TerrainModel(id=terrain_id, owner_id=owner_id, created_at=now, meta=meta,
                                  grid=zlib.compress(grid, 6)))
        return {**meta, "owner_id": owner_id}

    def get_terrain_model(self, terrain_id: str) -> dict[str, Any] | None:
        with self._session() as s:
            row = s.get(db.TerrainModel, terrain_id)
            return {**row.meta, "owner_id": row.owner_id} if row else None

    def terrain_grid(self, terrain_id: str) -> bytes | None:
        with self._session() as s:
            blob = s.scalar(select(db.TerrainModel.grid).where(db.TerrainModel.id == terrain_id))
        return zlib.decompress(blob) if blob is not None else None

    def terrain_models_for(self, owner_id: str) -> list[dict[str, Any]]:
        with self._session() as s:
            rows = s.scalars(select(db.TerrainModel).where(db.TerrainModel.owner_id == owner_id)
                             .order_by(db.TerrainModel.created_at.desc()))
            return [{**r.meta, "owner_id": r.owner_id} for r in rows]

    def delete_terrain_model(self, terrain_id: str) -> None:
        with self._session() as s, s.begin():
            s.execute(delete(db.TerrainModel).where(db.TerrainModel.id == terrain_id))

    # ------------------------------------------------------------------ test support

    def delete_all_content(self) -> None:
        """Remove every experiment and terrain model; accounts and sessions stay (test hook)."""
        for exp_id in self.experiment_ids():
            self.delete_experiment(exp_id)
        with self._session() as s, s.begin():
            s.execute(delete(db.TerrainModel))

    def counts(self) -> dict[str, int]:
        with self._session() as s:
            return {name: int(s.scalar(select(func.count()).select_from(model)) or 0)
                    for name, model in (("users", db.User), ("experiments", db.Experiment),
                                        ("simulations", db.Simulation), ("studies", db.Study))}

    # ------------------------------------------------------------------ import of the earlier file store

    def import_legacy_files(self, root: Path, owner_id: str) -> dict[str, int]:
        """Copy experiments, runs and studies saved by the file-based store (≤ 1.x) into ``owner_id``'s
        account. Configurations are upgraded to the current schema; files are only read. Records whose id
        already exists are skipped, so the import can be repeated safely."""
        imported = {"experiments": 0, "simulations": 0, "studies": 0, "skipped": 0}
        exp_dir, sim_dir, study_dir = root / "experiments", root / "simulations", root / "studies"
        known_ids: set[str] = set()
        for path in sorted(exp_dir.glob("*.json")) if exp_dir.is_dir() else []:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                exp_id = data["id"]
                if not valid_id(exp_id):
                    raise ValueError("bad id")
            except (OSError, ValueError, KeyError):
                imported["skipped"] += 1
                continue
            if self.experiment_exists(exp_id):
                known_ids.add(exp_id)
                imported["skipped"] += 1
                continue
            config = migrate_config(data.get("config")) or data.get("config")
            old_hash = data.get("configuration_hash")
            try:
                new_hash = configuration_hash(ExperimentConfig.model_validate(config))
            except ValidationError:
                imported["skipped"] += 1
                continue
            with self._session() as s, s.begin():
                code = data.get("code") if isinstance(data.get("code"), str) else None
                taken = code is None or s.scalar(select(db.Experiment.id).where(
                    db.Experiment.owner_id == owner_id, db.Experiment.code == code)) is not None
                s.add(db.Experiment(
                    id=exp_id, owner_id=owner_id, code=self._next_code(s, owner_id) if taken else code,
                    name=str(data.get("name", config.get("name", "")))[:120], created_at=data["created_at"],
                    updated_at=data["updated_at"], version=int(data["version"]), configuration_hash=new_hash,
                    config=config, terrain_model_id=_terrain_model_id(config),
                    latest_simulation_id=data.get("latest_simulation_id")))
            known_ids.add(exp_id)
            imported["experiments"] += 1
            for meta_path in sorted(sim_dir.glob("*/meta.json")) if sim_dir.is_dir() else []:
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if meta.get("experiment_id") != exp_id or self.get_simulation(meta.get("id", "")) is not None:
                    continue
                if meta.get("configuration_hash") == old_hash:
                    meta = {**meta, "configuration_hash": new_hash}
                self.save_sim_meta(meta)
                for doc_path in meta_path.parent.glob("*.json"):
                    if doc_path.name != "meta.json":
                        self.save_sim_doc(meta["id"], doc_path.stem, json.loads(doc_path.read_text(encoding="utf-8")))
                imported["simulations"] += 1
        for path in sorted(study_dir.glob("*.json")) if study_dir.is_dir() else []:
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if doc.get("experiment_id") not in known_ids or self.get_study(doc.get("id", "")) is not None:
                continue
            if doc.get("status") in ("queued", "running"):
                doc = {**doc, "status": "failed", "error": {
                    "code": "engine_restarted", "message": "The engine restarted before the study finished. Start it again."}}
            self.save_study(doc)
            imported["studies"] += 1
        return imported
