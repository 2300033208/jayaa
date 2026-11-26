"""Loads the shared frontend/engine contract (field limits, presets, defaults)."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _contract_dir() -> Path:
    override = os.environ.get("ENGINE_CONTRACT_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "contract"


def _load(name: str) -> dict[str, Any]:
    with open(_contract_dir() / name, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise RuntimeError(f"Contract file {name} must contain a JSON object")
    return data


@lru_cache(maxsize=1)
def limits() -> dict[str, Any]:
    return _load("config-limits.json")


@lru_cache(maxsize=1)
def clock_presets() -> dict[str, Any]:
    return _load("clock-presets.json")


@lru_cache(maxsize=1)
def default_config() -> dict[str, Any]:
    return _load("default-config.json")


def field_spec(path: str) -> dict[str, Any]:
    """Return the limit spec for a concrete field path such as ``bodies.0.depth_m``."""
    fields = limits()["fields"]
    if path in fields:
        return fields[path]
    parts = path.split(".")
    if len(parts) == 3 and parts[0] == "bodies":
        wildcard = f"bodies.*.{parts[2]}"
        if wildcard in fields:
            return fields[wildcard]
    raise KeyError(path)


@lru_cache(maxsize=1)
def scenarios() -> dict[str, Any]:
    return _load("scenarios.json")


def preset_by_id(species: str) -> dict[str, Any] | None:
    for preset in clock_presets()["presets"]:
        if preset["id"] == species:
            return preset
    return None


def performance_values(species: str, performance_class: str) -> dict[str, Any] | None:
    """Stability, systematic uncertainty and uptime of a clock species in a performance class."""
    preset = preset_by_id(species)
    if preset is None:
        return None
    values = preset.get("performance", {}).get(performance_class)
    return values if isinstance(values, dict) else None
