"""Exports: CSV measurements, JSON bundle and a self-contained HTML scientific report."""

from __future__ import annotations

import base64
import html
import io
from typing import Any

from . import ENGINE_VERSION
from .validation import format_limit

CSV_UNITS = {
    "index": ("", "Measurement sequence number"),
    "timestamp_s": ("s", "Mid-integration time since survey start"),
    "x_m": ("m", "Sensor position east"),
    "y_m": ("m", "Sensor position north"),
    "z_m": ("m", "Sensor elevation above the survey datum"),
    "along_track_m": ("m", "Cumulative path length"),
    "line_index": ("", "Survey line"),
    "potential_m2_s2": ("m²/s²", "Forward model: potential difference to reference (noise-free)"),
    "gravity_m_s2": ("m/s²", "Forward model: total gravity (noise-free)"),
    "gravity_anomaly_m_s2": ("m/s²", "Forward model: gravity anomaly (noise-free)"),
    "fractional_shift": ("1", "Forward model: gravitational fractional frequency shift (noise-free)"),
    "absolute_shift_hz": ("Hz", "Forward model: absolute frequency shift (noise-free)"),
    "ai_phase_rad": ("rad", "Forward model: equivalent atom-interferometer phase anomaly"),
    "raw": ("1", "Simulated measurement: fractional frequency including noise and drift"),
    "noise": ("1", "Simulator internal: injected stochastic noise"),
    "z_score": ("σ", "Quick-look deviation from survey baseline"),
    "filtered": ("1", "Processed: offset/drift removed, smoothed (display)"),
    "residual": ("1", "Processed: measurement minus inversion model"),
    "model_prediction": ("1", "Inversion model prediction in measurement space"),
}


def _fmt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return format(value, ".17g")
    return str(value)


def export_csv(meta: dict[str, Any], measurements: dict[str, Any], signals: dict[str, Any] | None) -> str:
    cols: dict[str, list] = dict(measurements.get("columns") or {})
    if signals and cols:
        n = int(measurements["count"])
        for name in ("filtered", "residual", "model_prediction"):
            cols[name] = signals[name][:n]
    lines = [
        "# Atomic Gravity Simulator export",
        f"# engine_version: {ENGINE_VERSION}",
        f"# simulation_id: {meta['id']}",
        f"# status: {meta['status']}" + (" (partial dataset)" if meta["status"] != "completed" else ""),
        f"# configuration_hash: {meta['configuration_hash']}",
    ]
    for name in cols:
        unit, desc = CSV_UNITS.get(name, ("", ""))
        lines.append(f"# {name} [{unit or 'dimensionless'}]: {desc}")
    if not cols:
        lines.append("# No measurements were recorded.")
        return "\n".join(lines) + "\n"
    names = list(cols.keys())
    lines.append(",".join(names))
    count = len(cols[names[0]])
    for i in range(count):
        lines.append(",".join(_fmt(cols[name][i]) for name in names))
    return "\n".join(lines) + "\n"


def export_json(meta: dict[str, Any], exp: dict[str, Any] | None, measurements: dict[str, Any],
                sections: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": "atomic-gravity-simulator/export",
        "format_version": 1,
        "engine_version": ENGINE_VERSION,
        "simulation": {k: v for k, v in meta.items() if k != "idempotency_key"},
        "experiment": exp,
        "partial": meta["status"] != "completed",
        "measurements": measurements,
        "results": sections or None,
    }


# ---------------------------------------------------------------------------- HTML report


def _png(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _figures(measurements: dict[str, Any], sections: dict[str, Any]) -> list[tuple[str, str]]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    figs: list[tuple[str, str]] = []
    cols = measurements["columns"]
    along = np.asarray(cols["along_track_m"]) / 1000.0
    raw = np.asarray(cols["raw"])
    model = np.asarray(cols["fractional_shift"])
    pred = np.asarray(sections["signals"]["model_prediction"])
    fig, ax = plt.subplots(figsize=(8, 3))
    ax.plot(along, raw * 1e18, ".", ms=2, color="#6b7280", label="Simulated measurement")
    ax.plot(along, model * 1e18, "-", lw=1, color="#111827", label="Noise-free forward model")
    ax.plot(along, pred * 1e18, "-", lw=1, color="#2563eb", label="Inversion model estimate")
    ax.set_xlabel("Along-track distance (km)")
    ax.set_ylabel("Δf/f₀ (×10⁻¹⁸)")
    ax.legend(fontsize=7, frameon=False)
    ax.set_title("Fractional frequency shift", fontsize=9)
    figs.append(("Fractional frequency shift along the survey path", _png(fig)))
    plt.close(fig)

    amap = sections.get("anomaly_map") or {}
    if amap.get("available"):
        x = np.asarray(amap["x_m"]) / 1000.0
        y = np.asarray(amap["y_m"]) / 1000.0
        true = np.asarray(amap["layers"]["gravity_anomaly_true"]) / 1e-8
        est = np.asarray(amap["layers"]["gravity_anomaly_estimated"]) / 1e-8
        lim = float(np.max(np.abs(np.concatenate([true.ravel(), est.ravel()])))) or 1.0
        fig, axes = plt.subplots(1, 2, figsize=(8, 3.4), sharey=True)
        for ax, data, title in ((axes[0], true, "Forward model (ground truth)"),
                                (axes[1], est, "Model estimate (inversion)")):
            mesh = ax.pcolormesh(x, y, data, cmap="RdBu_r", vmin=-lim, vmax=lim, shading="nearest")
            ax.contour(x, y, data, colors="k", linewidths=0.4, levels=8)
            ax.set_title(title, fontsize=9)
            ax.set_xlabel("X (km)")
            ax.set_aspect("equal")
        axes[0].set_ylabel("Y (km)")
        fig.colorbar(mesh, ax=axes, label="Δg (µGal)", shrink=0.9)
        figs.append(("Gravity anomaly map", _png(fig)))
        plt.close(fig)

    unc = sections["uncertainty"]["sources"]
    if unc:
        params = unc[0]["parameters"]
        fig, axes = plt.subplots(1, 2, figsize=(8, 2.8))
        for ax, name, unit in ((axes[0], "depth_m", "m"), (axes[1], "mass_kg", "kg")):
            p = params[name]
            if p["histogram"]:
                edges = np.asarray(p["histogram"]["bin_edges"])
                counts = np.asarray(p["histogram"]["counts"])
                ax.stairs(counts, edges, fill=True, color="#cbd5e1")
                ax.axvline(p["estimate"], color="#2563eb", lw=1.2, label="Estimate")
                ax.axvspan(p["ci_low"], p["ci_high"], color="#2563eb", alpha=0.08, label="95 % interval")
            ax.set_xlabel(f"{name.split('_')[0].capitalize()} ({unit})")
            ax.set_ylabel("Bootstrap samples")
        axes[0].legend(fontsize=7, frameon=False)
        figs.append(("Bootstrap uncertainty (primary source)", _png(fig)))
        plt.close(fig)
    return figs


def _q(value: float | None, unit: str) -> str:
    if value is None:
        return "Unavailable"
    return html.escape(f"{format_limit(value)} {unit}".strip())


def render_report(meta: dict[str, Any], exp: dict[str, Any] | None, measurements: dict[str, Any] | None,
                  sections: dict[str, Any]) -> str:
    e = html.escape
    name = exp["name"] if exp else "Experiment"
    code = exp["code"] if exp else ""
    summary = sections["summary"]
    inversion = sections["inversion"]
    comparison = sections["comparison"]
    truth = sections["ground_truth"]["bodies"]
    budget = sections["noise_budget"]["components"]

    source_rows = "".join(
        f"<tr><td>{e(s['id'])}</td><td>{_q(s['mass_kg']['estimate'], 'kg')}</td>"
        f"<td>{_q(s['x_m']['estimate'], 'm')}</td><td>{_q(s['y_m']['estimate'], 'm')}</td>"
        f"<td>{_q(s['depth_m']['estimate'], 'm')}</td>"
        f"<td>{_q(s['mass_significance_sigma'], 'σ')}</td></tr>"
        for s in inversion["sources"]
    )
    truth_rows = "".join(
        f"<tr><td>{e(t['id'])}</td><td>{e(t['anomaly_type'])} {e(t['geometry'])}</td>"
        f"<td>{_q(t['mass_kg'], 'kg')}</td><td>{_q(t['x_m'], 'm')}</td><td>{_q(t['y_m'], 'm')}</td>"
        f"<td>{_q(t['depth_m'], 'm')}</td></tr>"
        for t in truth
    )
    match_rows = "".join(
        f"<tr><td>{e(m['truth_id'])} ↔ {e(m['source_id'])}</td><td>{_q(m['depth_error_m'], 'm')}</td>"
        f"<td>{_q(m['mass_error_percent'], '%')}</td><td>{_q(m['horizontal_error_m'], 'm')}</td>"
        f"<td>{', '.join(k for k, v in m['truth_within_ci'].items() if v) or 'none'}</td></tr>"
        for m in comparison["matches"]
    )
    budget_rows = "".join(
        f"<tr><td>{e(c['label'])}</td><td>{_q(c['sigma'], '')}</td><td>{e(c['kind'])}</td>"
        f"<td>{e(c['description'])}</td></tr>"
        for c in budget
    )
    figures = ""
    if measurements and measurements.get("columns"):
        figures = "".join(
            f"<figure><img alt='{e(title)}' src='data:image/png;base64,{data}'/><figcaption>{e(title)}</figcaption>"
            f"</figure>"
            for title, data in _figures(measurements, sections)
        )
    detected = "Anomaly detected" if summary["anomaly_detected"] else "No significant anomaly detected"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{e(code)} report</title>
<style>
body{{font-family:system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#111827}}
h1{{font-size:22px;margin:0}} h2{{font-size:15px;margin-top:32px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}}
table{{border-collapse:collapse;width:100%;font-size:13px}} td,th{{border-bottom:1px solid #f1f5f9;padding:6px 8px;text-align:left}}
td{{font-variant-numeric:tabular-nums}} .muted{{color:#6b7280;font-size:12px}} figure{{margin:16px 0}} img{{max-width:100%}}
figcaption{{font-size:12px;color:#6b7280}}
</style></head><body>
<p class="muted">Atomic Gravity Simulator · Scientific report · engine {e(ENGINE_VERSION)}</p>
<h1>{e(code)} — {e(name)}</h1>
<p class="muted">Simulation {e(meta['id'])} · completed {e(str(meta['completed_at']))} ·
configuration {e(meta['configuration_hash'][:12])}</p>
<h2>Simulation estimate</h2>
<p><strong>{e(detected)}</strong> at {_q(summary['detection_significance_sigma'], 'σ')} —
{e(summary['detection_description'])}.</p>
<table><tr><th>Source</th><th>Mass</th><th>X</th><th>Y</th><th>Depth</th><th>Mass / σ</th></tr>{source_rows}</table>
<h2>Ground truth (configured bodies)</h2>
<table><tr><th>Body</th><th>Type</th><th>Mass</th><th>X</th><th>Y</th><th>Depth</th></tr>{truth_rows}</table>
<h2>Ground truth vs estimate</h2>
<table><tr><th>Pair</th><th>Depth error</th><th>Mass error</th><th>Position error</th><th>Truth inside 95 % interval</th></tr>{match_rows}</table>
<p class="muted">Field RMSE {_q(comparison['field_rmse_fractional'], '')} (fractional) ·
SNR {_q(comparison['snr'], '')} — {e(comparison['snr_definition'])}.</p>
<h2>Noise budget (per measurement, fractional frequency)</h2>
<table><tr><th>Component</th><th>σ</th><th>Kind</th><th>Model</th></tr>{budget_rows}</table>
<h2>Figures</h2>{figures or '<p>No measurement data.</p>'}
<p class="muted">All values were produced by the simulation engine. Estimates are model projections from simulated
data, not real-world predictions.</p>
</body></html>"""
