# Scientific integrity audit

For every quantity the interface displays: where it comes from, which computation produces it,
its unit, what kind of value it is, and what the frontend does to it. The frontend never computes
physics; its only transformations are unit scaling for display, formatting, and the geometric
helpers listed at the end.

Kinds: **Measurement** (simulated, noisy observation) · **Model** (noise-free forward model — ground
truth physics) · **Estimate** (inversion output) · **Uncertainty** · **Truth** (configured bodies) ·
**Derived** (computed by the engine from the above). The UI tags each value with its kind.

## Streamed per measurement (`engine/sensor.py → simulate_measurements`)

| Quantity | Shown in | Computation | Stored unit → display | Kind |
|---|---|---|---|---|
| Δf/f₀ measured (`raw`) | Signal chart, sensor panel, map "raw" layer | (Φ_sensor − Φ_ref)/c² + white noise + Gauss–Markov noise + drift | 1 → ×10ⁿ axis scale | Measurement |
| Δf/f₀ gravitational (`fractional_shift`) | Chart overlay "noise-free model", signal chain | ΔΦ/c² | 1 → ×10ⁿ | Model |
| Potential ΔΦ (`potential_m2_s2`) | Sensor panel, chart | normal potential difference + body potentials (`physics.py`) | m²/s² | Model |
| Gravity g (`gravity_m_s2`) | Chart | WGS84/spherical normal gravity + Δg | m/s² (7 decimals) | Model |
| Gravity anomaly Δg | Sensor panel, metrics, chart | sphere: point mass; prism: Nagy closed form | m/s² → µGal (×10⁸) or mGal (×10⁵) | Model |
| Absolute shift Δf | Chart | f₀·ΔΦ/c² | Hz → mHz/µHz/nHz | Model |
| Atom-interferometer phase Δφ | Chart | k_eff·Δg·T² (Rb, T = 0.1 s) | rad | Model |
| Injected noise | "Noise" chart | stochastic noise realization | 1 | Simulator internal (labelled as unobservable) |
| Deviation from baseline (z) | 3D point colors, pulse, sensor panel | (y − causal baseline median)/nominal σ; null for the first 4 points | σ | Derived (observables only) |
| Running SNR | Metrics strip | max \|z\| so far (`runner.py`) | ratio | Derived |

## Results (`engine/analysis.py`, `engine/inversion.py`)

| Quantity | Computation | Unit | Kind |
|---|---|---|---|
| Estimated mass, x, y, depth | Bounded least squares, point masses + offset + drift (observables only) | kg, m | Estimate |
| Standard error | Linearized covariance (JᵀJ)⁻¹·s² | same | Uncertainty |
| 95 % interval, bootstrap σ, histogram | Moving-block residual bootstrap, percentiles | same | Uncertainty |
| Detection significance | Matched-filter scan: max χ² reduction of one trial point source over offset + drift (nominal σ), look-elsewhere corrected by Monte Carlo; detected if ≥ 3 | σ | Derived (observables + instrument σ) |
| Mass constraint | \|M̂\| / σ_M (bootstrap); not the detection test | σ | Derived |
| Resolution limit | Half the station spacing; lower bound on estimated depth | m | Derived (survey geometry) |
| Filtered / drift-corrected / residual / model prediction | Data minus fitted offset and drift; Gaussian smoothing (display only); data − model | 1 | Derived / Estimate |
| Estimated Δg map | Forward model of estimated point sources | m/s² → µGal/mGal | Estimate |
| True Δg map | Forward model of configured bodies | m/s² → µGal/mGal | Model (truth) |
| Depth, mass, position errors | estimate − truth after optimal assignment | m, %, m | Derived (vs truth) |
| Truth inside interval | truth ∈ [low, high] | yes/no | Derived (vs truth) |
| Field RMSE, gravity RMSE | RMS(estimated − true noise-free signal) | 1, m/s² | Derived (vs truth) |
| SNR | peak-to-peak noise-free anomaly ÷ RMS injected noise | ratio | Derived (vs truth) |
| Noise budget σ | `build_noise_model`: σᵧ√2/√τ, per-set-up systematic, readout, BBR·ΔT, g·δz/c², station height g·δh/c², environmental, drift×duration | 1 | Model |
| Reduced χ², residual RMS | fit statistics against nominal sensor σ | ratio, 1 | Derived |

Ground truth enters only `analysis._compare` and the `ground_truth` section. `inversion.py` receives
positions, times, measured values, the reference location and the analyst's source count, and
nothing else. `tests/test_inversion.py::test_inversion_is_independent_of_ground_truth` runs the inversion
twice on identical measurements with different configured bodies and requires identical estimates.

## Studies, design and comparison

| Quantity | Computation | Kind |
|---|---|---|
| Detection rate, coverage | Count over runs with a 95 % Wilson score interval (`studies.wilson`) | Derived (Monte Carlo) |
| Bias, RMSE | Mean and RMS of (estimate − ground truth) over runs; per run the estimate comes from the observables-only inversion | Derived (vs truth) |
| Sweep detection probability | Fraction of runs where the look-elsewhere-corrected scan reaches 3σ; predicted value: P = Φ(√λ − √q₃) + Φ(−√λ − √q₃) with λ the projected signal power | Derived / Model |
| Time-lapse σ of the difference | √2 × RSS of the errors drawn again each survey (clock instability and set-up systematic, readout, thermal, vibration, environmental); station height excluded (same benchmark) | Model |
| Design candidates | Duration from the survey plan, σ from the noise model, detection probability as for the sweep prediction | Derived |
| Comparison values | The engine values of each experiment (validation, detectability, latest results); the frontend only places them side by side and marks differing rows | Display |

## Configuration page

| Quantity | Origin | Kind |
|---|---|---|
| Points, duration, noise σ, forward-model peak signal, per-point SNR | Engine `POST /experiments/validate` → `derived` | Derived / Model |
| Detectability grid, minimum detectable mass, verdict | Engine `POST /experiments/detectability` (`detectability.py`): expected significance of the same scan for a noise-free point source | Derived (Model) |
| Performance-class values and their basis | `contract/clock-presets.json` (shared by engine and frontend); the engine rejects values that differ from the selected class | Configuration |
| Scenario summaries and expected outcomes | `contract/scenarios.json`; outcomes verified by `tests/test_realism.py` | Configuration |
| Body radius / size / top depth, grid "nx × ny" hint | Frontend `features/experiment/geometry.ts` — the same volume = mass ÷ density and grid-count formulas as the engine, used for instant validation; the engine re-validates and remains authoritative | Derived (configuration geometry, no physics) |

## Frontend transformations (all display-only, never written back)

- Unit scaling in `utils/units.ts` only (µGal/mGal, Hz prefixes, ×10ⁿ axis scales, km for long distances, d/h durations).
- Formatting: significant figures, superscript exponents, true minus sign; non-finite or missing values render as "Unavailable" with a reason, never as 0.
- Rendering reduction: min/max envelope decimation above 20 000 points per series, disclosed on the chart; the table view and exports keep every value.
- Summary aggregation: "peak |Δg|" and "peak |ΔΦ|" in the analysis signal chain are maxima of engine values.
- Geometry for drawing: interval bars and the 3D uncertainty ellipsoid are placed from the engine's interval bounds; the scene uses one uniform scale so proportions stay true, and the 2D sections state any vertical exaggeration.

## Evaluation of correctness (realism update)

Checks run with the engine, with eight noise seeds per scenario unless stated:

| Check | Result |
|---|---|
| Pure noise (negligible mass), 60 seeds | No detection ≥ 3σ; about 10 % exceed the one-sided 90 % level, as calibrated |
| Regional anomaly, field clocks | Detected in 7 of 8 seeds (median 4.7σ); mass/σ ≈ 0, which the previous mass-based criterion would have reported as "not detected" |
| Ore body, field clocks | Not detected (median 0.0σ); the per-station error is about five times the peak signal |
| Ore body, laboratory-grade clocks | Marginal: 0–2.6σ, never ≥ 3σ |
| Ore body, projected clocks | Detected (22–25σ); the true depth lies inside the 95 % interval in 8 of 8 seeds |
| Aquifer, projected clocks | Not detected (one seed at the 3.0σ boundary); the previous criterion reported mass/σ ≥ 3 in 3 of 8 seeds from spurious 1 m-deep fits |
| Detectability study vs runs | Predicted 4.6σ / 24.6σ / 0σ against observed medians 4.7σ / 23.5σ / 0σ |

Defects found and fixed during this evaluation:

1. **Optimizer start.** All starting points sat at the extremum of the median-centred data. For a broad
   anomaly measured against a corner reference, that extremum lies at the opposite survey corner, and
   the fit converged to a spurious shallow source (χ² 85.6 against 61.0 for the true source). A coarse
   grid search, linear in mass for each trial position and depth, now supplies the starts
   (`test_fit_reaches_global_minimum_for_broad_anomaly`).
2. **Detection criterion.** Mass/σ confounds detection with mass–depth degeneracy: it missed clearly
   present anomalies and produced false detections from single-station fits. Replaced by the
   look-elsewhere-corrected matched-filter scan (`test_detection_scan_false_positive_rate_under_pure_noise`,
   `test_regional_anomaly_is_detected_although_mass_is_degenerate`).
3. **Unresolvable depths.** Sources shallower than half the station spacing could fit a single noisy
   station (depth → 1 m). Estimated depth is now bounded by that resolution limit, and the UI says when
   an estimate sits on it (`test_estimates_respect_the_resolution_limit`).
4. **Idealised instrument.** The previous default (σᵧ(1 s) = 10⁻¹⁷, no per-station error, no set-up
   time) exceeded the best demonstrated laboratory clocks. Defaults are now field-demonstrated values,
   and undemonstrated classes carry a warning.

## Evaluation of the upgrades

| Check | Result |
|---|---|
| Tide spectrum | Dominant period 12.42 h (M2); equatorial amplitude consistent with (1 + k₂ − h₂) × the lunar and solar tidal potentials |
| Tide averaging | One-day averaging windows reduce the tide's standard deviation below a quarter |
| Terrain prisms | Exact prism potential agrees with the point-mass sum at 15 km within 0.2 % |
| Correction consistency | With correct density and no loading residual, corrected data equal the no-terrain, no-tide case to rounding; a 10 % density error leaves 10 % of the terrain signal |
| Distant reference | An 800 km reference sees more than 20× the tidal residual of a local reference |
| Sweep vs prediction | Observed detection probability follows the analytic prediction (e.g. 1.00 vs 0.98; 0.03 vs 0.03), slightly higher in marginal cells where the scan can also catch a noise peak |
| Repeat-study coverage | Projected-clock ore body: depth intervals contain the truth in all runs checked; regional field scenario: about 83 %, i.e. the bootstrap intervals under-cover when mass and depth are degenerate — a finding only the Monte Carlo study reveals |
| Design assistant | No faster design than the recommended one reaches 90 % detection (`test_design_assistant_finds_the_fastest_reliable_design`) |

## Clock vs gravimeter and published benchmarks

| Quantity | Shown in | Computation | Unit | Kind |
|---|---|---|---|---|
| Clock σ per station | Experiment → Clock, gravimeter or both? | nominal σ of the noise model (as in the detectability study) | 1 | Derived |
| Gravimeter σ per station | same | √(reading σ² + (3.086 × 10⁻⁶ s⁻² × δh)²) | m/s² → µGal | Derived |
| Expected SNR (clock, gravimeter, joint) | same | ‖P⊥ s‖ / σ: source signal at the true position after removing each instrument's offset and drift; joint = √(clock² + gravimeter²) | ratio | Derived |
| Mass, depth, position uncertainty | same | Cramér–Rao bound: inverse Fisher matrix of the whitened point-source Jacobians (`instruments.py`) | kg, m | Uncertainty |
| Mass–depth correlation | same | off-diagonal of the same covariance | ratio | Uncertainty |
| Monte Carlo depth scatter | same | standard deviation of nonlinear least-squares fits to noisy synthetic data, started at the truth | m | Uncertainty |
| Clock accuracy and depth sweeps | same (charts) | the same bounds and SNR re-evaluated over clock σ (10⁻²³–10⁻¹⁵) and source depth | m, ratio | Derived |
| Benchmark engine values | Validation page | engine physics functions (`benchmarks.py`) applied to the published configurations | as published | Model |
| Benchmark published values | Validation page | copied from the cited papers with their stated uncertainty | as published | Truth (literature) |

