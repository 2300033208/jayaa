"""Simulation lifecycle: phases, paced measurement streaming, pause/resume/cancel, events."""

from __future__ import annotations

import asyncio
import math
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .analysis import build_results, run_inversion
from .config import ExperimentConfig
from .geometry import BodyGeometry, body_geometry
from .inversion import InversionCancelled
from .sensor import MeasurementSet, simulate_measurements
from .serialization import measurement_columns
from .store import Store, utc_now
from .survey import SurveyPlan, plan_survey, terrain_grid

PHASES = (
    "initializing_earth_model",
    "generating_subsurface_field",
    "initializing_sensor",
    "running_survey",
    "processing_measurements",
    "performing_inversion",
    "calculating_uncertainty",
    "complete",
)
STAGE_OF_PHASE = {
    "initializing_earth_model": "setup",
    "generating_subsurface_field": "setup",
    "initializing_sensor": "sensor",
    "running_survey": "measurement",
    "processing_measurements": "analysis",
    "performing_inversion": "analysis",
    "calculating_uncertainty": "analysis",
    "complete": "complete",
}
PHASE_SPAN = {
    "initializing_earth_model": (0.0, 0.01),
    "generating_subsurface_field": (0.01, 0.02),
    "initializing_sensor": (0.02, 0.03),
    "running_survey": (0.03, 0.85),
    "processing_measurements": (0.85, 0.87),
    "performing_inversion": (0.87, 0.9),
    "calculating_uncertainty": (0.9, 1.0),
    "complete": (1.0, 1.0),
}
PLAYBACK = {
    "normal": {"stream_s": 30.0, "per_point_max_s": 0.5, "phase_s": 0.6},
    "fast": {"stream_s": 8.0, "per_point_max_s": 0.15, "phase_s": 0.2},
    "instant": {"stream_s": 0.0, "per_point_max_s": 0.0, "phase_s": 0.0},
}
TERMINAL = frozenset({"completed", "failed", "cancelled"})
ACTIVE = frozenset({"starting", "running", "paused", "cancelling"})
TICK_S = 0.05
PROGRESS_INTERVAL_S = 0.2
INSTANT_BATCH = 2000
SUBSCRIBER_QUEUE_SIZE = 2000
MAX_BATCH = 5000
KEEP_TERMINAL_RUNS = 5


def plan_document(config: ExperimentConfig, plan: SurveyPlan, bodies: list[BodyGeometry],
                  simulation_id: str | None) -> dict[str, Any]:
    """Survey plan and configured geometry for visualization (bodies are the configured ground truth)."""
    reference = (
        {"x_m": plan.reference_x, "y_m": plan.reference_y, "z_m": plan.reference_z}
        if config.sensor.mode == "local_reference" else None
    )
    return {
        "simulation_id": simulation_id,
        "pattern": plan.pattern,
        "nx": plan.nx,
        "ny": plan.ny,
        "point_count": plan.count,
        "duration_s": plan.duration_s,
        "sensor_mode": config.sensor.mode,
        "reference": reference,
        "bounds": {"width_m": config.survey.width_m, "length_m": config.survey.length_m},
        "sensor_height_m": config.survey.sensor_height_m,
        "path": {"x_m": plan.x.tolist(), "y_m": plan.y.tolist(), "z_m": plan.z.tolist()},
        "terrain": terrain_grid(config.environment, config.survey),
        "bodies": [
            {
                "id": b.id,
                "anomaly_type": b.anomaly_type,
                "geometry": b.geometry,
                "mass_kg": b.signed_mass_kg,
                "x_m": b.x_m,
                "y_m": b.y_m,
                "depth_m": b.depth_m,
                "size_x_m": 2 * b.half_x_m,
                "size_y_m": 2 * b.half_y_m,
                "size_z_m": 2 * b.half_z_m,
            }
            for b in bodies
        ],
    }


class ConflictError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class TestHooks:
    """Failure injection, enabled only when ENGINE_TEST_HOOKS=1."""

    fail_phase: str | None = None


@dataclass(eq=False)
class Subscriber:
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE))
    overflowed: bool = False
    closed: asyncio.Event = field(default_factory=asyncio.Event)


class SimulationRun:
    def __init__(self, manager: "SimulationManager", experiment: dict[str, Any], config: ExperimentConfig,
                 playback: str, idempotency_key: str | None, fail_phase: str | None):
        self.manager = manager
        self.store = manager.store
        self.id = uuid.uuid4().hex
        self.experiment_id: str = experiment["id"]
        self.experiment_version: int = experiment["version"]
        self.configuration_hash: str = experiment["configuration_hash"]
        self.config = config
        self.playback = playback
        self.idempotency_key = idempotency_key
        self._fail_phase = fail_phase
        self.status = "starting"
        self.phase = PHASES[0]
        self.progress = 0.0
        self.seq = 0
        self.created_at = utc_now()
        self.updated_at = self.created_at
        self.completed_at: str | None = None
        self.error: dict[str, str] | None = None
        self.results_available = False
        self.subscribers: set[Subscriber] = set()
        self.bodies: list[BodyGeometry] = [body_geometry(b) for b in config.bodies]
        self.plan: SurveyPlan = plan_survey(config.survey, config.environment, config.sensor)
        self.measurements: MeasurementSet | None = None
        self.emitted = 0
        self.running_snr: float | None = None
        self._resume = asyncio.Event()
        self._resume.set()
        self._cancel_requested = False
        self.task: asyncio.Task | None = None

    # ------------------------------------------------------------------ representation

    @property
    def total(self) -> int:
        return self.plan.count

    def status_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "experiment_id": self.experiment_id,
            "experiment_version": self.experiment_version,
            "configuration_hash": self.configuration_hash,
            "status": self.status,
            "phase": self.phase,
            "stage": STAGE_OF_PHASE[self.phase],
            "progress": self.progress,
            "measurements_completed": self.emitted,
            "measurements_total": self.total,
            "running_snr": self.running_snr,
            "playback": self.playback,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
            "error": self.error,
            "results_available": self.results_available,
            "last_seq": self.seq,
        }

    def plan_json(self) -> dict[str, Any]:
        return plan_document(self.config, self.plan, self.bodies, self.id)

    def meta_json(self) -> dict[str, Any]:
        meta = self.status_json()
        meta["idempotency_key"] = self.idempotency_key
        return meta

    # ------------------------------------------------------------------ events

    def _event(self, type_: str, **payload: Any) -> dict[str, Any]:
        self.seq += 1
        return {"type": type_, "simulation_id": self.id, "seq": self.seq, **payload}

    def _broadcast(self, event: dict[str, Any]) -> None:
        for sub in list(self.subscribers):
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                sub.overflowed = True
                sub.closed.set()
                self.subscribers.discard(sub)

    def subscribe(self) -> Subscriber:
        sub = Subscriber()
        self.subscribers.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        self.subscribers.discard(sub)

    def drop_connections(self) -> None:
        for sub in list(self.subscribers):
            sub.closed.set()
        self.subscribers.clear()

    def inject(self, raw: str) -> None:
        for sub in list(self.subscribers):
            try:
                sub.queue.put_nowait({"__raw__": raw})
            except asyncio.QueueFull:
                sub.overflowed = True
                sub.closed.set()

    def batch_event(self, start: int, end: int, replay_seq: int | None = None) -> dict[str, Any]:
        """Measurement event for [start, end). Replayed backlog reuses the snapshot's seq so that
        live status events, which may interleave with the replay, keep strictly larger numbers."""
        assert self.measurements is not None
        cols = measurement_columns(self.measurements.columns, start, end)

        def make(type_: str, **payload: Any) -> dict[str, Any]:
            if replay_seq is None:
                return self._event(type_, **payload)
            return {"type": type_, "simulation_id": self.id, "seq": replay_seq, **payload}

        if end - start == 1:
            row = {name: values[0] for name, values in cols.items()}
            measurement = {
                "index": row["index"],
                "timestamp_s": row["timestamp_s"],
                "position": {"x": row["x_m"], "y": row["y_m"], "z": row["z_m"]},
                **{k: v for k, v in row.items() if k not in ("index", "timestamp_s", "x_m", "y_m", "z_m")},
            }
            return make("measurement", measurement=measurement)
        return make("measurement_batch", start_index=start, count=end - start, columns=cols)

    def snapshot_event(self) -> dict[str, Any]:
        return self._event("snapshot", simulation=self.status_json())

    # ------------------------------------------------------------------ state changes

    def _touch(self, persist: bool = True) -> None:
        self.updated_at = utc_now()
        if persist:
            self.store.save_sim_meta(self.meta_json())

    def _set_progress(self, phase_fraction: float) -> None:
        lo, hi = PHASE_SPAN[self.phase]
        self.progress = lo + (hi - lo) * min(max(phase_fraction, 0.0), 1.0)

    def _emit_progress(self) -> None:
        self._broadcast(self._event(
            "simulation_progress",
            progress=self.progress,
            phase=self.phase,
            measurements_completed=self.emitted,
            measurements_total=self.total,
            running_snr=self.running_snr,
        ))

    async def _enter_phase(self, phase: str) -> None:
        self._check_cancel()
        self.phase = phase
        self._set_progress(0.0)
        self._touch()
        self._broadcast(self._event("phase_changed", phase=phase, stage=STAGE_OF_PHASE[phase],
                                    progress=self.progress))
        if self._fail_phase == phase:
            raise RuntimeError("Injected failure (test hook)")
        pause = PLAYBACK[self.playback]["phase_s"]
        if pause > 0:
            await asyncio.sleep(pause)
        self._check_cancel()

    def _check_cancel(self) -> None:
        if self._cancel_requested:
            raise asyncio.CancelledError()

    # ------------------------------------------------------------------ control

    def pause(self) -> None:
        if self.status == "paused":
            return
        if self.status != "running" or self.phase != "running_survey":
            raise ConflictError("invalid_transition", "Pause is only available while the survey is running.")
        self.status = "paused"
        self._resume.clear()
        self._touch()
        self._broadcast(self._event("simulation_paused", simulation=self.status_json()))

    def resume(self) -> None:
        if self.status == "running":
            return
        if self.status != "paused":
            raise ConflictError("invalid_transition", "Only a paused simulation can be resumed.")
        self.status = "running"
        self._resume.set()
        self._touch()
        self._broadcast(self._event("simulation_resumed", simulation=self.status_json()))

    def cancel(self) -> None:
        if self.status in ("cancelling", "cancelled"):
            return
        if self.status in TERMINAL:
            raise ConflictError("invalid_transition", "The simulation has already finished.")
        self._cancel_requested = True
        self.status = "cancelling"
        self._resume.set()
        self._touch()
        self._broadcast(self._event("simulation_cancelling", simulation=self.status_json()))

    # ------------------------------------------------------------------ main task

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            self.status = "running"
            self._touch()
            self._broadcast(self._event("simulation_started", simulation=self.status_json()))

            await self._enter_phase("initializing_earth_model")
            await self._enter_phase("generating_subsurface_field")
            await self._enter_phase("initializing_sensor")
            self.measurements = await asyncio.to_thread(simulate_measurements, self.config, self.plan, self.bodies)
            self._check_cancel()

            await self._enter_phase("running_survey")
            await self._stream()

            await self._enter_phase("processing_measurements")
            self._check_cancel()
            await self._enter_phase("performing_inversion")

            def on_bootstrap_start() -> None:
                loop.call_soon_threadsafe(self._begin_uncertainty_phase)

            last = [0.0]

            def on_progress(fraction: float) -> None:
                now = time.monotonic()
                if now - last[0] >= PROGRESS_INTERVAL_S or fraction >= 1.0:
                    last[0] = now
                    loop.call_soon_threadsafe(self._uncertainty_progress, fraction)

            inv = await asyncio.to_thread(
                run_inversion, self.config, self.plan, self.measurements, on_progress,
                lambda: self._cancel_requested, on_bootstrap_start,
            )
            self._check_cancel()
            if self._fail_phase == "calculating_uncertainty":
                raise RuntimeError("Injected failure (test hook)")
            docs = await asyncio.to_thread(build_results, self.config, self.plan, self.measurements, self.bodies, inv)
            await asyncio.to_thread(self._persist, docs)
            self._check_cancel()

            self.phase = "complete"
            self.progress = 1.0
            self.status = "completed"
            self.results_available = True
            self.completed_at = utc_now()
            self._touch()
            self._broadcast(self._event("phase_changed", phase="complete", stage="complete", progress=1.0))
            self._broadcast(self._event("simulation_completed", simulation=self.status_json(),
                                        summary=docs["summary"]))
        except (asyncio.CancelledError, InversionCancelled):
            await self._finish_cancelled()
        except Exception as exc:  # noqa: BLE001 - every failure is reported to the client
            self.status = "failed"
            self.error = {
                "code": "simulation_error",
                "phase": self.phase,
                "message": f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__,
            }
            self.completed_at = utc_now()
            await asyncio.to_thread(self._persist_measurements)
            self._touch()
            self._broadcast(self._event("simulation_failed", simulation=self.status_json(), error=self.error))
        finally:
            self.manager.on_run_finished(self)

    async def _finish_cancelled(self) -> None:
        self.status = "cancelled"
        self.completed_at = utc_now()
        await asyncio.to_thread(self._persist_measurements)
        self._touch()
        self._broadcast(self._event("simulation_cancelled", simulation=self.status_json()))

    def _begin_uncertainty_phase(self) -> None:
        if self.status in TERMINAL or self._cancel_requested:
            return
        self.phase = "calculating_uncertainty"
        self._set_progress(0.0)
        self._touch()
        self._broadcast(self._event("phase_changed", phase=self.phase, stage=STAGE_OF_PHASE[self.phase],
                                    progress=self.progress))

    def _uncertainty_progress(self, fraction: float) -> None:
        if self.status in TERMINAL or self.phase != "calculating_uncertainty":
            return
        self._set_progress(fraction)
        self._emit_progress()

    async def _stream(self) -> None:
        cfg = PLAYBACK[self.playback]
        total = self.total
        duration = min(cfg["stream_s"], cfg["per_point_max_s"] * total)
        active = 0.0
        last_progress = 0.0
        assert self.measurements is not None
        z = self.measurements.columns["z_score"]
        while self.emitted < total:
            await self._resume.wait()
            self._check_cancel()
            if duration <= 0:
                due = min(total, self.emitted + INSTANT_BATCH)
                await asyncio.sleep(0)
            else:
                started = time.monotonic()
                await asyncio.sleep(TICK_S)
                active += time.monotonic() - started
                # Measurements become due uniformly over the playback duration (none may be due this tick).
                due = min(total, int(math.floor(active / duration * total)))
            self._check_cancel()
            if self.status == "paused" or due <= self.emitted:
                continue
            while self.emitted < due:
                end = min(due, self.emitted + MAX_BATCH)
                event = self.batch_event(self.emitted, end)
                self.emitted = end
                self._broadcast(event)
            window = z[: self.emitted]
            finite = window[np.isfinite(window)]
            self.running_snr = float(np.max(np.abs(finite))) if finite.size else None
            self._set_progress(self.emitted / total)
            now = time.monotonic()
            if now - last_progress >= PROGRESS_INTERVAL_S or self.emitted == total:
                last_progress = now
                self._emit_progress()

    # ------------------------------------------------------------------ persistence

    def _persist_measurements(self) -> None:
        if self.measurements is None:
            self.store.save_sim_doc(self.id, "measurements", {"count": 0, "columns": None})
            return
        self.store.save_sim_doc(self.id, "measurements", {
            "count": self.emitted,
            "columns": measurement_columns(self.measurements.columns, 0, self.emitted),
        })

    def _persist(self, docs: dict[str, Any]) -> None:
        self._persist_measurements()
        self.store.save_sim_doc(self.id, "plan", self.plan_json())
        for name, doc in docs.items():
            self.store.save_sim_doc(self.id, name, doc)


class SimulationManager:
    def __init__(self, store: Store):
        self.store = store
        self.runs: dict[str, SimulationRun] = {}
        self.idempotency: dict[tuple[str, str], str] = {}
        self.hooks = TestHooks()
        self._recover()

    def _recover(self) -> None:
        self.store.fail_unfinished_simulations(ACTIVE)

    def get(self, sim_id: str) -> SimulationRun | None:
        return self.runs.get(sim_id)

    def active_for(self, exp_id: str) -> SimulationRun | None:
        for run in self.runs.values():
            if run.experiment_id == exp_id and run.status in ACTIVE:
                return run
        return None

    def existing_for_key(self, exp_id: str, key: str) -> str | None:
        return self.idempotency.get((exp_id, key)) or self.store.simulation_for_key(exp_id, key)

    def start(self, experiment: dict[str, Any], config: ExperimentConfig, playback: str,
              idempotency_key: str | None) -> SimulationRun:
        fail_phase = self.hooks.fail_phase
        self.hooks.fail_phase = None
        run = SimulationRun(self, experiment, config, playback, idempotency_key, fail_phase)
        self.runs[run.id] = run
        if idempotency_key:
            self.idempotency[(run.experiment_id, idempotency_key)] = run.id
        self.store.save_sim_meta(run.meta_json())
        self.store.save_sim_doc(run.id, "plan", run.plan_json())
        self.store.set_latest_simulation(run.experiment_id, run.id)
        run.task = asyncio.get_running_loop().create_task(run.run())
        return run

    def on_run_finished(self, run: SimulationRun) -> None:
        terminal = [r for r in self.runs.values() if r.status in TERMINAL and r is not run]
        terminal.sort(key=lambda r: r.updated_at)
        while len(terminal) >= KEEP_TERMINAL_RUNS:
            old = terminal.pop(0)
            if not old.subscribers:
                self.runs.pop(old.id, None)

    async def shutdown(self) -> None:
        for run in list(self.runs.values()):
            # A run may be terminal while its task is still persisting results; only active runs are cancelled.
            if run.task and not run.task.done() and run.status in ACTIVE:
                run.cancel()
        tasks = [r.task for r in self.runs.values() if r.task and not r.task.done()]
        if tasks:
            await asyncio.wait(tasks, timeout=5)
