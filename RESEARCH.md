# Can optical clocks find buried mass? A simulation study

This document states the research question, what the literature has already done, what this project adds, how the
results were validated, and what they show. Every number here is produced by the engine and can be regenerated
(see [Reproducing the results](#reproducing-the-results)).

## 1. Research question

> **With today's and foreseeable optical clocks, can a multi-station clock survey detect and characterize a buried
> mass anomaly, and does it add information to a conventional gravimeter survey of the same stations?**

Sub-questions:

1. What is the smallest buried mass a realistic clock campaign can detect, as a function of depth, clock
   performance class and fieldwork time? (*Detectability study*, *Survey design assistant*, *Monte Carlo studies*.)
2. How well can the mass, position and depth be recovered, and how honest are the stated uncertainties?
   (*Inversion*, *bootstrap*, *coverage* in the repeat study.)
3. Would a gravimeter on the same stations do better, and does a joint clock + gravimeter survey improve the depth
   estimate, as proposed by Bondarescu et al. (2012)? (*Clock vs gravimeter* comparison, new in this project.)

## 2. What has been done before

| Study | What it did | Gap this project addresses |
|---|---|---|
| Bondarescu et al. 2012 [1] | Forward models of a buried sphere: a body is called "detectable" when its potential perturbation exceeds a clock threshold (ΔU ≈ 0.1–0.2 m²/s²). Proposed joint clock + relative-gravimeter surveys because the two observables have different depth sensitivities. | No noise model, no survey logistics, no detection statistics, no inversion, and no quantitative comparison with the gravimeter it proposes to combine with. |
| Bondarescu et al. 2015 [2] | Clocks as monitors of vertical surface motion (volcano uplift). | Time-variable uplift, not static buried mass. |
| Lion et al. 2017 [3] | Synthetic study: adding a few clock points to gravimetry improves a regional geopotential (geoid) model by least-squares collocation. | Targets the geoid, not a localized source; does not estimate source parameters. |
| Mehlstäubler et al. 2018 [4]; Delva et al. [5] | Reviews of chronometric geodesy: 10⁻¹⁸ ↔ 1 cm, clock requirements, applications. | Reviews; no end-to-end simulation of a subsurface survey. |
| Grotti et al. 2018 [6] | First chronometric levelling with a transportable Sr clock (Modane tunnel vs Torino, ~1000 m): ΔU = 10 034(174) m²/s², geodesy 10 032.1(16) m²/s². | Two fixed sites, no subsurface target. |
| Takamoto et al. 2020 [7] (summarized in [8]) | Two transportable Sr clocks at Tokyo Skytree (Δh = 452.6 m), redshift confirmed to α = (1.4 ± 9.1) × 10⁻⁵; clock height resolution ≈ 5 cm. | Two fixed sites, no subsurface target. |
| Yuan et al. 2024 [9] | Chronometric levelling with compact transportable Ca⁺ clocks at the 10 cm level. | Instrument demonstration. |
| Schröder et al. 2021 [10] | Simulated a European clock network for hydrology and satellite-gravity validation. | Continental scale, time-variable signals. |

**Gap.** No published work combines (i) a realistic clock error model including per-set-up systematics, station-height
errors, environmental noise and drift, (ii) field logistics, (iii) a calibrated detection test, (iv) inversion with
honest uncertainties, and (v) a like-for-like comparison with gravimetry, for the subsurface-mass problem. The joint
clock + gravimeter survey proposed in 2012 has never been tested quantitatively.

## 3. Contributions of this project

1. **An end-to-end, reproducible simulator** of clock-based subsurface surveys (engine + interactive interface), in
   which every displayed number is engine-computed and traced in [SCIENTIFIC_AUDIT.md](SCIENTIFIC_AUDIT.md).
2. **Calibrated detection.** A matched-filter scan with a Monte Carlo look-elsewhere correction, so "detected" means a
   stated false-alarm probability, not merely "signal above the clock threshold" as in [1].
3. **Realistic clock performance classes** (field-demonstrated, laboratory, projected) tied to the literature, with
   per-station errors that do not average down and campaign durations in weeks.
4. **The first quantitative test of joint clock + gravimeter surveying** (module `engine/engine/instruments.py`): the
   same stations, the same body, the same station-height errors entering both instruments (g·δh/c² for the clock and
   3.086 µGal/cm × δh for the gravimeter), each instrument with its own offset and drift. Cramér–Rao bounds for clock
   only, gravimeter only and joint surveys, verified by Monte Carlo nonlinear fits, plus sweeps over clock accuracy and
   source depth.
5. **Reproduction of published results** with the engine's own physics (module `engine/engine/benchmarks.py`, Validation
   page): 9 of 9 checks agree.

## 4. Validation against published results

| Benchmark | Quantity | Engine | Published | Agreement |
|---|---|---|---|---|
| Tokyo Skytree [7, 8] | Redshift for Δh = 452.596 m (WGS84 normal field) | 4.93370 × 10⁻¹⁴ | clocks 4.93378(45) × 10⁻¹⁴; geodesy 4.93371(14) × 10⁻¹⁴ | z = −0.18; z = −0.07 |
| Modane–Torino [6] | ΔU from the measured 47.92(83) Hz shift | 10 033.9 ± 173.8 m²/s² | 10 034(174) m²/s²; geodesy 10 032.1(16) | within rounding; z = 0.01 |
| Bondarescu 2012 [1] | Peak ΔU of 1.5 km sphere, 20 % contrast, 2 km deep | 0.2519 m²/s² | ≈ 0.25 | within rounding |
| | Peak Δg of the same sphere | 12.60 mGal | ≈ 12.6 | within rounding |
| | Smallest radius detectable at 45 km (ΔU = 0.2 m²/s²) | 3.92 km | "4 km" | within rounding |
| | Redshift of 1 cm height | 1.091 × 10⁻¹⁸ | ≈ 1.1 × 10⁻¹⁸ | within rounding |

The engine's internal physics is additionally tested against closed-form and numerical references (prism closed form
against quadrature, WGS84 normal gravity reference values, potential gradient against gravity, far-field continuity);
see `engine/tests/test_physics.py`.

## 5. Results

### 5.1 Clocks alone (built-in research scenarios)

| Scenario | Clock class | Outcome with clocks |
|---|---|---|
| Regional density anomaly, 6.4 × 10¹⁴ kg at 10 km | field (today) | detected, about 4–5σ |
| Ore body, 5 × 10¹² kg at 1.5 km | field (today) | not detectable |
| Ore body | laboratory state of the art | marginal |
| Ore body | projected (not yet demonstrated) | > 20σ |
| Aquifer, 1.4 × 10¹¹ kg at 600 m | projected | below sensitivity |

These outcomes are checked over eight noise seeds each in the test suite.

### 5.2 Clock vs gravimeter on the same stations (new)

Expected matched-filter SNR at the true source position, field relative gravimeter at 5 µGal per station (plus
3.1 µGal from the 1 cm station-height uncertainty), the same 1σ station-height error for both instruments:

| Scenario | Stations | Clock σ per station | Clock SNR | Gravimeter SNR (5 µGal) | Gravimeter SNR (pessimistic 50 µGal) | Clock σ needed to match the 5 µGal gravimeter |
|---|---|---|---|---|---|---|
| Regional, field clocks | 81 | 1.2 × 10⁻¹⁷ | 5.5 | 12 700 | 1 490 | 5.3 × 10⁻²¹ |
| Ore body, field clocks | 81 | 1.2 × 10⁻¹⁷ | 0.29 | 3 770 | 442 | 9.5 × 10⁻²² |
| Ore body, laboratory clocks | 81 | 1.7 × 10⁻¹⁸ | 2.2 | 3 770 | 442 | 9.5 × 10⁻²² |
| Ore body, projected clocks | 1089 | 5.3 × 10⁻¹⁹ | 25 | 17 100 | 1 720 | 7.7 × 10⁻²² |
| Aquifer, projected clocks | 961 | 5.3 × 10⁻¹⁹ | 1.5 | 1 830 | 183 | 4.4 × 10⁻²² |

Findings:

- **For compact bodies within a survey area, a gravimeter on the same stations is 690–13 000× more sensitive than
  the clock**, and still 69–1 500× more sensitive when its error is assumed ten times worse than its specification.
- **The joint survey proposed in [1] adds no measurable depth information with any clock that exists or is
  projected.** Adding the clock changes the gravimeter's depth uncertainty by a factor of 0.999999–1.000000 in every
  scenario. The joint survey improves the depth bound by 10 % only for clocks at 0.8–9 × 10⁻²¹ per station, which is
  about three orders of magnitude beyond today's best laboratory clocks (≈ 8 × 10⁻¹⁹).
- **Mass and depth are strongly correlated (ρ ≈ 0.87–0.96) for every instrument.** Combining the instruments does not
  break this degeneracy at realistic clock accuracy.
- The clock's relative standing improves with depth (potential falls as 1/r, gravity as z/r³), but within 200 km depth
  the clock never overtakes the gravimeter for these survey sizes (clock/gravimeter SNR ≤ 0.07 at 200 km).
- The Cramér–Rao bounds agree with Monte Carlo nonlinear fits to within 30 % wherever the SNR is high (tested in
  `engine/tests/test_instruments.py`). At low clock SNR the fits are nonlinear and bounded, and the empirical scatter
  differs from the bound; both are reported.

### 5.3 Interpretation

The claim that a buried body is "detectable by clocks" when its potential exceeds the clock threshold [1] is true but
incomplete: the same body is detected thousands of times more strongly by an instrument that already exists. A clock
measures the potential, which is smoother than gravity. That makes clocks valuable where the potential itself is
wanted, such as height-system unification, geoid determination over long baselines and continuous monitoring [3, 4, 10].
It does not make them a better tool for finding compact buried bodies. This project quantifies how far clocks would
have to improve (≈ 10⁻²¹) before that changes.

## 6. Threats to validity

- **Point-source model.** The comparison treats the first body as a point mass. Extended bodies change both signals
  similarly away from the body; very shallow, extended bodies favour gravimetry further.
- **Independent white errors.** Both instruments are given independent per-station errors. Correlated clock noise is
  folded into its nominal σ; gravimeter tares and terrain-correction errors are represented only through the
  pessimistic 50 µGal case.
- **Same stations.** Both instruments occupy the same stations. A gravimeter survey is far faster (minutes rather than
  hours per station), so a fair-cost comparison would favour gravimetry further.
- **Terrain and Bouguer reductions** affect gravity more than potential; the pessimistic case bounds this, and the
  result does not change.
- **Synthetic data.** No real multi-station clock survey exists yet, so the scenarios are synthetic; the physics is
  validated against the published two-site experiments in Section 4.

## 7. Future work

- Long-baseline, fibre-linked surveys in which the absolute potential difference to a distant reference is retained
  (no offset estimated) — the regime where clocks are expected to have an advantage.
- Time-lapse monitoring (groundwater, magma), where continuous clock operation and benchmark-tied heights matter
  (the time-lapse study already models this for clocks alone).
- Extended-body joint inversion and real elevation models for terrain reductions.

## Reproducing the results

```bash
cd engine
python -m pytest tests/test_instruments.py      # Cramér–Rao vs Monte Carlo, benchmarks, API
python -c "from engine.benchmarks import benchmarks; print(benchmarks()['passed'])"
```

In the interface: open any experiment, scroll to **Clock, gravimeter or both?** on the Experiment page; open
**Validation** in the sidebar for the published benchmarks.

## References

1. Bondarescu, R., Bondarescu, M., Hetényi, G., Boschi, L., Jetzer, P., Balakrishna, J. Geophysical applicability of
   atomic clocks: direct continental geoid mapping. *Geophys. J. Int.* **191**, 78–82 (2012).
   doi:10.1111/j.1365-246X.2012.05636.x; arXiv:1209.2889.
2. Bondarescu, R. et al. Ground-based optical atomic clocks as a tool to monitor vertical surface motion.
   *Geophys. J. Int.* **202**, 1770–1774 (2015). doi:10.1093/gji/ggv246.
3. Lion, G. et al. Determination of a high spatial resolution geopotential model using atomic clock comparisons.
   *J. Geod.* (2017). doi:10.1007/s00190-016-0986-6; arXiv:1612.03833.
4. Mehlstäubler, T. E., Grosche, G., Lisdat, C., Schmidt, P. O., Denker, H. Atomic clocks for geodesy.
   *Rep. Prog. Phys.* **81**, 064401 (2018). doi:10.1088/1361-6633/aab409.
5. Delva, P., Denker, H., Lion, G. Chronometric geodesy: methods and applications. arXiv:1804.09506.
6. Grotti, J. et al. Geodesy and metrology with a transportable optical clock. *Nature Physics* **14**, 437–441 (2018).
   doi:10.1038/s41567-017-0042-3; arXiv:1705.04089.
7. Takamoto, M. et al. Test of general relativity by a pair of transportable optical lattice clocks.
   *Nature Photonics* **14**, 411–415 (2020). doi:10.1038/s41566-020-0619-8.
8. Shinkai, H., Takamoto, M., Katori, H. Transportable optical lattice clocks and general relativity.
   arXiv:2502.06104 (2025).
9. Yuan, Y. et al. Demonstration of chronometric leveling using transportable optical clocks beyond laser coherence
   limit. *Phys. Rev. Applied* **21**, 044052 (2024). doi:10.1103/PhysRevApplied.21.044052; arXiv:2310.08835.
10. Schröder, S. et al. Potential and scientific requirements of optical clock networks for validating satellite
    gravity missions. arXiv:2012.02618.
11. Nagy, D., Papp, G., Benedek, J. The gravitational potential and its derivatives for the prism. *J. Geod.* **74**,
    552–560 (2000).
