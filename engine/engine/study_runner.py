"""Background execution of Monte Carlo studies: one worker, queued jobs, progress and cancellation."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from .config import ExperimentConfig
from .store import Store, utc_now
from .studies import StudyCancelled, StudyRequest, run_study

ACTIVE_STUDY = frozenset({"queued", "running"})
PROGRESS_STEP = 0.01  # in-memory progress is updated at most every 1 %


class StudyJob:
    def __init__(self, doc: dict[str, Any], config: ExperimentConfig, request: StudyRequest):
        self.doc = doc
        self.config = config
        self.request = request
        self.cancel_requested = threading.Event()
        self.future: Future[None] | None = None
        self._lock = threading.Lock()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return dict(self.doc)

    def update(self, **changes: Any) -> None:
        with self._lock:
            self.doc = {**self.doc, **changes}


class StudyManager:
    def __init__(self, store: Store):
        self.store = store
        store.fail_unfinished_studies()
        self.jobs: dict[str, StudyJob] = {}
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="study")

    def start(self, experiment: dict[str, Any], config: ExperimentConfig, request: StudyRequest) -> dict[str, Any]:
        doc = {
            "id": uuid.uuid4().hex,
            "experiment_id": experiment["id"],
            "experiment_version": experiment["version"],
            "configuration_hash": experiment["configuration_hash"],
            "kind": request.kind,
            "request": request.model_dump(mode="json"),
            "status": "queued",
            "progress": 0.0,
            "created_at": utc_now(),
            "completed_at": None,
            "error": None,
            "result": None,
        }
        job = StudyJob(doc, config, request)
        self.jobs[doc["id"]] = job
        self.store.save_study(doc)
        job.future = self.executor.submit(self._run, job)
        return job.snapshot()

    def _run(self, job: StudyJob) -> None:
        if job.cancel_requested.is_set():
            self._finish(job, "cancelled")
            return
        job.update(status="running")
        last = [0.0]

        def progress(fraction: float) -> None:
            if fraction - last[0] >= PROGRESS_STEP or fraction >= 1.0:
                last[0] = fraction
                job.update(progress=min(1.0, fraction))

        try:
            result = run_study(job.config, job.request, progress, job.cancel_requested.is_set)
        except StudyCancelled:
            self._finish(job, "cancelled")
        except Exception as exc:  # noqa: BLE001 - reported to the user with the actual reason
            self._finish(job, "failed", error={"code": "study_failed", "message": f"{type(exc).__name__}: {exc}"})
        else:
            self._finish(job, "completed", result=result, progress=1.0)

    def _finish(self, job: StudyJob, status: str, **changes: Any) -> None:
        job.update(status=status, completed_at=utc_now(), **changes)
        if self.store.experiment_exists(job.doc["experiment_id"]):  # not deleted meanwhile
            self.store.save_study(job.snapshot())

    def get(self, study_id: str) -> dict[str, Any] | None:
        job = self.jobs.get(study_id)
        if job is not None and job.snapshot()["status"] in ACTIVE_STUDY:
            return job.snapshot()
        return self.store.get_study(study_id)

    def cancel(self, study_id: str) -> dict[str, Any] | None:
        job = self.jobs.get(study_id)
        if job is None:
            return self.store.get_study(study_id)
        job.cancel_requested.set()
        return job.snapshot()

    def active_for(self, exp_id: str) -> list[str]:
        return [j.doc["id"] for j in self.jobs.values()
                if j.doc["experiment_id"] == exp_id and j.snapshot()["status"] in ACTIVE_STUDY]

    def shutdown(self, wait: bool = True) -> None:
        for job in self.jobs.values():
            job.cancel_requested.set()
        self.executor.shutdown(wait=wait, cancel_futures=False)

    def reset(self) -> None:
        """Cancel everything and wait (test hook)."""
        for job in list(self.jobs.values()):
            job.cancel_requested.set()
        for job in list(self.jobs.values()):
            if job.future is not None:
                job.future.result(timeout=30)
        self.jobs.clear()
