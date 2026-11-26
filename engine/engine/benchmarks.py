"""Reproduction of published results with the engine's own physics.

Each benchmark recomputes a published number with the functions the simulator uses (normal field,
point-mass and sphere potentials, the redshift relation Δf/f₀ = ΔΦ/c²) and compares it with the value
and uncertainty reported in the paper. Rounded published values ("≈ 0.25 m²/s²") are compared with a
tolerance of half a unit in their last digit; values with a stated uncertainty are compared as a
z-score. Nothing here is fitted to the published numbers.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from . import constants as k
from .config import BodyConfig
from .contract import clock_presets
from .geometry import body_geometry
from .physics import body_gz, body_potential, normal_gravity, normal_potential

Z_PASS = 2.0  # |engine − published| / σ below which a benchmark with a stated uncertainty passes


def _sr_frequency() -> float:
    for species in clock_presets()["presets"]:
        if species["id"] == "sr":
            return float(species["reference_frequency_hz"])
    raise KeyError("sr")


def _row(quantity: str, unit: str, engine: float, published: float, sigma: float | None = None,
         tolerance: float | None = None, note: str = "") -> dict[str, Any]:
    diff = engine - published
    if sigma is not None:
        z = diff / sigma
        passed = abs(z) < Z_PASS
        criterion = f"|z| < {Z_PASS:g}"
    else:
        assert tolerance is not None
        z = None
        passed = abs(diff) <= tolerance
        criterion = f"within ±{tolerance:g} {unit} (rounding of the published value)"
    return {"quantity": quantity, "unit": unit, "engine": engine, "published": published,
            "published_sigma": sigma, "difference": diff,
            "relative_difference": diff / published if published else None,
            "z": z, "criterion": criterion, "passed": passed, "note": note}


def _sphere(radius_m: float, density_contrast: float, depth_m: float) -> Any:
    mass = 4.0 / 3.0 * math.pi * radius_m**3 * density_contrast
    return body_geometry(BodyConfig(id="sphere", anomaly_type="dense", geometry="sphere",
                                    density_contrast_kg_m3=density_contrast, mass_kg=mass, depth_m=depth_m,
                                    x_m=0.0, y_m=0.0))


def _origin() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    zero = np.zeros(1)
    return zero, zero.copy(), zero.copy()


def skytree() -> dict[str, Any]:
    """Takamoto et al. 2020: two transportable Sr clocks at Tokyo Skytree, Δh = 452.596(13) m."""
    lat, h_low, dh = 35.7101, 3.6, 452.596
    phi = normal_potential(lat, np.array([h_low, h_low + dh]), "wgs84")
    engine = float((phi[1] - phi[0]) / k.C2)
    geodetic, geodetic_sigma = 49_337.1e-18, 1.4e-18
    alpha, alpha_sigma = 1.4e-5, 9.1e-5  # measured redshift = (1 + α) × geodetic value
    clock, clock_sigma = geodetic * (1.0 + alpha), geodetic * alpha_sigma
    g_normal = float(normal_gravity(lat, np.array([h_low + dh / 2.0]), "wgs84")[0])
    return {
        "id": "skytree-2020",
        "title": "Tokyo Skytree: 450 m redshift with transportable optical lattice clocks",
        "citation": "Takamoto, M. et al. Test of general relativity by a pair of transportable optical lattice "
                    "clocks. Nature Photonics 14, 411–415 (2020); numbers as summarized by Shinkai, Takamoto & "
                    "Katori, arXiv:2502.06104 (2025).",
        "doi": "10.1038/s41566-020-0619-8",
        "what_is_checked": "The engine's WGS84 normal-field potential difference for the clocks' laser-ranged height "
                           "difference, against the redshift the clocks measured and the geodetic value.",
        "rows": [
            _row("Redshift Δf/f₀ vs clock measurement", "", engine, clock, sigma=clock_sigma,
                 note="Clock value (1 + α)·gΔh/c² with α = (1.4 ± 9.1) × 10⁻⁵."),
            _row("Redshift Δf/f₀ vs geodetic gΔh/c²", "", engine, geodetic, sigma=geodetic_sigma,
                 note=f"The paper uses measured local gravity 9.797248 m/s²; the engine uses WGS84 normal gravity "
                      f"({g_normal:.6f} m/s² at mid-height), which here happens to agree to well within 10⁻¹⁸."),
        ],
    }


def modane() -> dict[str, Any]:
    """Grotti et al. 2018: transportable Sr clock in the Fréjus tunnel (LSM) against INRIM, Torino."""
    nu0 = _sr_frequency()
    shift_hz, shift_sigma = 47.92, 0.83
    engine = k.C2 * shift_hz / nu0
    engine_sigma = k.C2 * shift_sigma / nu0
    return {
        "id": "modane-2018",
        "title": "Fréjus tunnel (Modane) to Torino: first chronometric levelling with a transportable clock",
        "citation": "Grotti, J. et al. Geodesy and metrology with a transportable optical clock. Nature Physics 14, "
                    "437–441 (2018); arXiv:1705.04089.",
        "doi": "10.1038/s41567-017-0042-3",
        "what_is_checked": "The engine's redshift relation and Sr reference frequency, converting the measured "
                           "47.92(83) Hz shift to a potential difference, against the paper's clock value and the "
                           "independent geodetic determination.",
        "rows": [
            _row("Potential difference ΔΦ vs paper's clock value", "m²/s²", engine, 10_034.0, tolerance=0.5),
            _row("Uncertainty of ΔΦ vs paper", "m²/s²", engine_sigma, 174.0, tolerance=0.5),
            _row("Potential difference ΔΦ vs geodesy", "m²/s²", engine, 10_032.1, sigma=math.hypot(engine_sigma, 1.6),
                 note="Geodetic value 10 032.1(16) m²/s² from GNSS, levelling and a refined geoid model."),
        ],
    }


def bondarescu() -> dict[str, Any]:
    """Bondarescu et al. 2012: synthetic buried sphere and the clock detection limit."""
    contrast = 0.2 * 2670.0  # 20 % of crustal density
    sphere = _sphere(1500.0, contrast, 2000.0)
    px, py, pz = _origin()
    du = float(-body_potential(px, py, pz, sphere)[0])  # potential perturbation magnitude at the apex
    dg_mgal = float(body_gz(px, py, pz, sphere)[0]) * 1e5
    # Smallest detectable radius at 45 km depth for a clock threshold ΔU_max = 0.2 m²/s².
    threshold, depth = 0.2, 45_000.0
    radius_km = (3.0 * threshold * depth / (4.0 * math.pi * k.G * contrast)) ** (1.0 / 3.0) / 1000.0
    one_cm = float(normal_gravity(45.0, np.array([0.0]), "wgs84")[0]) * 0.01 / k.C2
    return {
        "id": "bondarescu-2012",
        "title": "Buried sphere detectable by clocks (synthetic case)",
        "citation": "Bondarescu, R. et al. Geophysical applicability of atomic clocks: direct continental geoid "
                    "mapping. Geophysical Journal International 191, 78–82 (2012); arXiv:1209.2889.",
        "doi": "10.1111/j.1365-246X.2012.05636.x",
        "what_is_checked": "The engine's sphere potential and gravity for a 1.5 km radius sphere with 20 % density "
                           "contrast (534 kg/m³) centred 2 km deep, and the minimum-radius relation.",
        "rows": [
            _row("Peak potential perturbation ΔU", "m²/s²", du, 0.25, tolerance=0.005),
            _row("Peak gravity anomaly Δg", "mGal", dg_mgal, 12.6, tolerance=0.05),
            _row("Smallest detectable radius at 45 km (ΔU = 0.2 m²/s²)", "km", radius_km, 4.0, tolerance=0.5,
                 note="Published as “a sphere of 4 km radius … down to 45 km depth”."),
            _row("Redshift of 1 cm height", "×10⁻¹⁸", one_cm * 1e18, 1.1, tolerance=0.05,
                 note="g·Δh/c² ≈ 1.1 × 10⁻¹⁸ per cm (also stated by Shinkai, Takamoto & Katori 2025)."),
        ],
    }


def benchmarks() -> dict[str, Any]:
    items = [skytree(), modane(), bondarescu()]
    rows = [row for item in items for row in item["rows"]]
    return {
        "benchmarks": items,
        "passed": sum(1 for r in rows if r["passed"]),
        "total": len(rows),
        "method": "Published values recomputed with the engine's physics functions; no parameter is fitted.",
    }
