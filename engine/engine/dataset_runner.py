"""Background analysis of uploaded field datasets: one worker, queued jobs, progress and cancellation."""

from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from .config import ExperimentConfig
from .fielddata import FieldDataError, analyse
from .inversion import InversionCancelled
from .store import Store, utc_now

PROGRESS_STEP = 0.02


class _Job:
    def __init__(self) -> None:
        self.cancel = threading.Event()
        self.progress = 0.0
        self.future: Future[None] | None = None


class DatasetManager:
    def __init__(self, store: Store):
        self.store = store
        store.fail_unfinished_datasets()
        self.jobs: dict[str, _Job] = {}
        self._lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dataset")

    def start(self, meta: dict[str, Any], experiment: dict[str, Any], config: ExperimentConfig) -> dict[str, Any]:
        """Queue an analysis of the dataset with the experiment's current configuration."""
        meta = {**meta, "status": "analysing", "error": None, "progress": 0.0,
                "experiment_version": experiment["version"], "configuration_hash": experiment["configuration_hash"]}
        updated = self.store.update_dataset(meta["id"], meta, clear_analysis=True)
        if updated is None:
            raise KeyError(meta["id"])
        job = _Job()
        with self._lock:
            self.jobs[meta["id"]] = job
        job.future = self.executor.submit(self._run, meta["id"], job, config, dict(meta.get("options") or {}))
        return self.decorate(updated)

    def _run(self, dataset_id: str, job: _Job, config: ExperimentConfig, options: dict[str, Any]) -> None:
        def progress(fraction: float) -> None:
            if fraction - job.progress >= PROGRESS_STEP or fraction >= 1.0:
                job.progress = min(1.0, fraction)

        meta = self.store.get_dataset(dataset_id)
        if meta is None:
            return
        try:
            if job.cancel.is_set():
                raise InversionCancelled()
            columns = self.store.dataset_columns(dataset_id)
            if columns is None:
                return
            doc = analyse(config, columns, options, job.cancel.is_set, progress)
        except InversionCancelled:
            self.store.update_dataset(dataset_id, {**meta, "status": "cancelled", "progress": job.progress,
                                                   "analysed_at": utc_now()})
        except FieldDataError as exc:
            self.store.update_dataset(dataset_id, {**meta, "status": "failed", "progress": job.progress,
                                                   "analysed_at": utc_now(),
                                                   "error": {"code": "analysis_rejected", "message": str(exc)}})
        except Exception as exc:  # noqa: BLE001 - reported to the user with the actual reason
            self.store.update_dataset(dataset_id, {**meta, "status": "failed", "progress": job.progress,
                                                   "analysed_at": utc_now(),
                                                   "error": {"code": "analysis_failed",
                                                             "message": f"{type(exc).__name__}: {exc}"}})
        else:
            summary = doc["summary"]
            self.store.update_dataset(dataset_id, {
                **meta, "status": "ready", "progress": 1.0, "analysed_at": utc_now(), "error": None,
                "summary": {"anomaly_detected": summary["anomaly_detected"],
                            "detection_significance_sigma": summary["detection_significance_sigma"],
                            "fit_quality": summary["fit_quality"]},
            }, analysis=doc)
        finally:
            with self._lock:
                if self.jobs.get(dataset_id) is job:
                    self.jobs.pop(dataset_id, None)

    def decorate(self, meta: dict[str, Any]) -> dict[str, Any]:
        """Stored metadata with the live progress of a running analysis."""
        with self._lock:
            job = self.jobs.get(meta["id"])
        if job is not None and meta.get("status") == "analysing":
            return {**meta, "progress": job.progress}
        return meta

    def active(self, dataset_id: str) -> bool:
        with self._lock:
            return dataset_id in self.jobs

    def cancel(self, dataset_id: str) -> None:
        with self._lock:
            job = self.jobs.get(dataset_id)
        if job is not None:
            job.cancel.set()

    def shutdown(self) -> None:
        with self._lock:
            jobs = list(self.jobs.values())
        for job in jobs:
            job.cancel.set()
        self.executor.shutdown(wait=True, cancel_futures=False)

    def reset(self) -> None:
        """Cancel everything and wait (test hook)."""
        with self._lock:
            jobs = list(self.jobs.values())
        for job in jobs:
            job.cancel.set()
        for job in jobs:
            if job.future is not None:
                job.future.result(timeout=60)
