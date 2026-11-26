"""Upgrades stored experiment configurations to the current schema.

Fields added for field-campaign realism (performance class, per-station errors, uptime, set-up time)
and site physics (terrain mass, tides) are filled with the values that reproduce the earlier behaviour
exactly: no per-station error, 100 % uptime, no set-up time, no terrain mass, no tides and no
uploaded elevation model.
Measurements, timing and results of stored runs are unchanged, so their configuration hashes can be
carried over to the upgraded configuration.
"""

from __future__ import annotations

import copy
from typing import Any

LEGACY_VALUES: dict[str, dict[str, Any]] = {
    "environment": {"terrain_density_kg_m3": 0.0, "terrain_density_assumed_kg_m3": 0.0, "tides": "off",
                    "terrain_model_id": None},
    "sensor": {"performance_class": "custom", "systematic_uncertainty": 0.0, "uptime_percent": 100.0,
               "reference_distance_km": 0.0},
    "noise": {"station_height_uncertainty_m": 0.0, "tide_residual_percent": 0.0},
    "survey": {"setup_time_s": 0.0, "start_date": "2026-01-01"},
}


def migrate_config(config: Any) -> dict[str, Any] | None:
    """Return an upgraded copy of ``config``, or None when it is already current (or not a config)."""
    if not isinstance(config, dict):
        return None
    upgraded = copy.deepcopy(config)
    changed = False
    for section, values in LEGACY_VALUES.items():
        target = upgraded.get(section)
        if not isinstance(target, dict):
            continue
        for key, value in values.items():
            if key not in target:
                target[key] = value
                changed = True
    return upgraded if changed else None
