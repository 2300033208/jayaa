import type { Data } from "plotly.js-dist-min";
import { useMemo } from "react";
import { useTheme } from "../../app/providers/themeContext";
import { ChartFrame } from "../../components/charts/ChartFrame";
import { axis, baseLayout } from "../../components/charts/chartTheme";
import type { TableModel } from "../../components/charts/DataTable";
import {
  Quantity,
  Readout,
  Readouts,
} from "../../components/scientific/Quantity";
import type { QuantityKind } from "../../utils/units";
import { formatQuantity } from "../../utils/units";
import type {
  Accuracy,
  Proportion,
  RepeatResult,
  SweepResult,
  TimeLapseResult,
} from "../../types/studies";
import styles from "./study.module.css";

/* Sequential single-hue ramp (blue, steps 100 → 700); the anchor flips in dark mode. */
const BLUE_RAMP = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
];

function percent(p: number | null): string {
  return p === null ? "Unavailable" : formatQuantity(p, "ratio_percent");
}

function ProportionText({
  value,
  stacked = false,
}: {
  value: Proportion;
  stacked?: boolean;
}) {
  if (value.rate === null) return <span>Unavailable (no runs)</span>;
  return (
    <span>
      {percent(value.rate)}{" "}
      <span className={stacked ? styles.mutedBlock : styles.muted}>
        ({value.k}/{value.n}; 95 % interval {percent(value.low)}–
        {percent(value.high)})
      </span>
    </span>
  );
}

function SignificanceHistogram({
  values,
  threshold,
  id,
  exportName,
}: {
  values: number[];
  threshold: number;
  id: string;
  exportName: string;
}) {
  const { tokens } = useTheme();
  const built = useMemo(() => {
    const data: Data[] = [
      {
        type: "histogram",
        x: values,
        name: "Runs",
        marker: {
          color: tokens.series1,
          line: { width: 1, color: tokens.surface },
        },
        hovertemplate: "%{x} σ: %{y} runs<extra></extra>",
      },
    ];
    const layout = baseLayout(tokens, {
      xaxis: axis(
        tokens,
        "Detection significance (σ, look-elsewhere corrected)",
        { rangemode: "tozero" },
      ),
      yaxis: axis(tokens, "Runs"),
      shapes: [
        {
          type: "line",
          xref: "x",
          yref: "paper",
          x0: threshold,
          x1: threshold,
          y0: 0,
          y1: 1,
          line: { color: tokens.ink2, width: 1.5, dash: "dash" },
        },
      ],
      annotations: [
        {
          x: threshold,
          y: 1,
          xref: "x",
          yref: "paper",
          yanchor: "bottom",
          text: `${threshold}σ detection threshold`,
          showarrow: false,
          font: { size: 11, color: tokens.ink2 },
        },
      ],
      margin: { l: 56, r: 16, t: 28, b: 48 },
      bargap: 0.04,
      showlegend: false,
      uirevision: id,
    });
    const table: TableModel = {
      caption: "Detection significance of each run.",
      columns: ["Run", "Significance"],
      rowCount: values.length,
      row: (i) => {
        const v = values[i];
        return v === undefined
          ? []
          : [String(i + 1), formatQuantity(v, "sigma")];
      },
    };
    return { data, layout, table };
  }, [values, threshold, id, tokens]);
  return (
    <ChartFrame
      id={id}
      title="Detection significance across runs"
      subtitle="Each run is the same campaign with a new noise realization."
      data={built.data}
      layout={built.layout}
      height={260}
      summary={`Histogram of detection significance over ${values.length} runs, with the detection threshold.`}
      table={built.table}
      exportName={exportName}
      zoomable={false}
    />
  );
}

interface AccuracyRow {
  label: string;
  kind: QuantityKind;
  truth: number;
  all: Accuracy;
  detected: Accuracy;
}

function AccuracyTable({
  rows,
  caption,
}: {
  rows: AccuracyRow[];
  caption: string;
}) {
  return (
    <div className={styles.results}>
      <p className={styles.note}>{caption}</p>
      <div
        className={styles.tableWrap}
        tabIndex={0}
        role="region"
        aria-label="Estimation accuracy (scrollable)"
      >
        <table className={styles.table}>
          <caption>Estimation accuracy against the ground truth</caption>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Ground truth</th>
              <th scope="col">Bias (all runs)</th>
              <th scope="col">RMSE (all runs)</th>
              <th scope="col">Truth inside 95 % interval</th>
              <th scope="col">Bias (detected runs)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="mono">{formatQuantity(r.truth, r.kind)}</td>
                <td className="mono">
                  <Quantity
                    value={r.all.bias}
                    kind={r.kind}
                    unavailableReason="No runs."
                  />
                </td>
                <td className="mono">
                  <Quantity
                    value={r.all.rmse}
                    kind={r.kind}
                    unavailableReason="No runs."
                  />
                </td>
                <td>
                  <ProportionText value={r.all.coverage} />
                </td>
                <td className="mono">
                  <Quantity
                    value={r.detected.bias}
                    kind={r.kind}
                    unavailableReason="No detected runs."
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RepeatView({
  result,
  exportName,
}: {
  result: RepeatResult;
  exportName: string;
}) {
  const rows: AccuracyRow[] = [
    {
      label: "Depth",
      kind: "length",
      truth: result.truth.depth_m,
      all: result.accuracy_all.depth_m,
      detected: result.accuracy_detected.depth_m,
    },
    {
      label: "Mass",
      kind: "mass",
      truth: result.truth.mass_kg,
      all: result.accuracy_all.mass_kg,
      detected: result.accuracy_detected.mass_kg,
    },
    {
      label: "Position x",
      kind: "length",
      truth: result.truth.x_m,
      all: result.accuracy_all.x_m,
      detected: result.accuracy_detected.x_m,
    },
    {
      label: "Position y",
      kind: "length",
      truth: result.truth.y_m,
      all: result.accuracy_all.y_m,
      detected: result.accuracy_detected.y_m,
    },
  ];
  return (
    <div className={styles.results}>
      <Readouts className={styles.cards}>
        <Readout label="Detection rate" provenance="derived" large>
          <ProportionText value={result.detection} stacked />
        </Readout>
        <Readout label="Median significance" provenance="derived" large>
          <Quantity
            value={result.significance.median}
            kind="sigma"
            unavailableReason="No significance available."
          />
        </Readout>
        <Readout label="Runs × stations" provenance="config" large>
          {result.runs} × {result.stations}
        </Readout>
      </Readouts>
      <SignificanceHistogram
        values={result.significance.values}
        threshold={3}
        id="study-significance"
        exportName={`${exportName}-significance`}
      />
      <AccuracyTable
        rows={rows}
        caption={`Estimation accuracy against the ground truth. Intervals are ${result.bootstrap_samples}-sample bootstrap 95 % intervals; a well-calibrated interval contains the truth in about 95 % of runs.`}
      />
    </div>
  );
}

export function SweepView({
  result,
  exportName,
}: {
  result: SweepResult;
  exportName: string;
}) {
  const { tokens, resolved } = useTheme();
  const built = useMemo(() => {
    const ramp = resolved === "dark" ? [...BLUE_RAMP].reverse() : BLUE_RAMP;
    const z = result.detection.map((row) => row.map((c) => c?.rate ?? null));
    const text = result.detection.map((row, i) =>
      row.map((c, j) => {
        const predicted = result.predicted_probability[i]?.[j] ?? null;
        if (c === null) return "Body would reach above the ground";
        return `Observed ${percent(c.rate)} (${c.k}/${c.n}; 95 % ${percent(c.low)}–${percent(c.high)})<br>Predicted ${percent(predicted)}`;
      }),
    );
    const data: Data[] = [
      {
        type: "heatmap",
        x: result.masses_kg.map((m) =>
          formatQuantity(m, "mass", { significant: 2 }),
        ),
        y: result.depths_m.map((d) => formatQuantity(d, "length")),
        z,
        text,
        zmin: 0,
        zmax: 1,
        colorscale: ramp.map((c, i): [number, string] => [
          i / (ramp.length - 1),
          c,
        ]),
        colorbar: {
          title: { text: "Detected", font: { size: 11, color: tokens.ink2 } },
          tickformat: ".0%",
          tickfont: { size: 11, color: tokens.ink2 },
          thickness: 12,
          outlinewidth: 0,
        },
        hovertemplate: "Mass %{x}<br>Depth %{y}<br>%{text}<extra></extra>",
        xgap: 2,
        ygap: 2,
      },
    ];
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, "Mass of the first body", { type: "category" }),
      yaxis: axis(tokens, "Depth of centre", {
        type: "category",
        autorange: "reversed",
      }),
      margin: { l: 72, r: 16, t: 16, b: 56 },
      uirevision: "sweep",
    });
    const cols = result.masses_kg.length;
    const table: TableModel = {
      caption:
        "Observed detection probability per cell (Monte Carlo) and the analytic prediction.",
      columns: ["Depth", "Mass", "Observed", "95 % interval", "Predicted"],
      rowCount: result.depths_m.length * cols,
      row: (i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const depth = result.depths_m[r];
        const mass = result.masses_kg[c];
        const cell = result.detection[r]?.[c];
        if (depth === undefined || mass === undefined || cell === undefined)
          return [];
        const predicted = result.predicted_probability[r]?.[c] ?? null;
        return [
          formatQuantity(depth, "length"),
          formatQuantity(mass, "mass", { significant: 2 }),
          cell === null
            ? "Not simulated (body above ground)"
            : `${percent(cell.rate)} (${cell.k}/${cell.n})`,
          cell === null ? "—" : `${percent(cell.low)}–${percent(cell.high)}`,
          percent(predicted),
        ];
      },
    };
    return { data, layout, table };
  }, [result, tokens, resolved]);
  return (
    <div className={styles.results}>
      <ChartFrame
        id="study-sweep"
        title="Detection probability over mass and depth"
        subtitle={`${result.runs_per_cell} runs per cell, ${result.stations} stations. Hover a cell for the analytic prediction.`}
        data={built.data}
        layout={built.layout}
        height={360}
        summary="Heatmap of the observed probability of detecting the body for each mass and depth."
        table={built.table}
        exportName={`${exportName}-sweep`}
        zoomable={false}
        footnote={result.note}
      />
    </div>
  );
}

export function TimeLapseView({
  result,
  exportName,
}: {
  result: TimeLapseResult;
  exportName: string;
}) {
  const rows: AccuracyRow[] = [
    {
      label: "Mass change",
      kind: "mass",
      truth: result.truth.mass_change_kg,
      all: result.accuracy_all.mass_change_kg,
      detected: result.accuracy_detected.mass_change_kg,
    },
    {
      label: "Depth",
      kind: "length",
      truth: result.truth.depth_m,
      all: result.accuracy_all.depth_m,
      detected: result.accuracy_detected.depth_m,
    },
  ];
  return (
    <div className={styles.results}>
      <Readouts className={styles.cards}>
        <Readout label="Change detected" provenance="derived" large>
          <ProportionText value={result.detection} stacked />
        </Readout>
        <Readout
          label="Predicted detection probability"
          provenance="model"
          large
        >
          {percent(result.predicted_probability)}
        </Readout>
        <Readout label="Mass change rate" provenance="config" large>
          <Quantity
            value={result.mass_change_rate_kg_per_year}
            kind="mass"
            significant={2}
          />
          <span className={styles.unitNote}> per year</span>
        </Readout>
        <Readout
          label="Per-station σ of the difference"
          provenance="model"
          large
        >
          <Quantity
            value={result.sigma_difference}
            kind="fractional"
            significant={2}
          />
          <span className={styles.unitNote}>
            {" "}
            (
            <Quantity
              value={result.sigma_difference_without_benchmarks}
              kind="fractional"
              significant={2}
            />{" "}
            without shared benchmarks)
          </span>
        </Readout>
      </Readouts>
      <SignificanceHistogram
        values={result.significance.values}
        threshold={3}
        id="study-change-significance"
        exportName={`${exportName}-change-significance`}
      />
      <AccuracyTable
        rows={rows}
        caption={`Estimation of the change from the difference of two surveys ${formatQuantity(result.interval_days * 86_400, "duration")} apart (${result.bootstrap_samples}-sample bootstrap intervals).`}
      />
      <p className={styles.note}>{result.note}</p>
    </div>
  );
}
