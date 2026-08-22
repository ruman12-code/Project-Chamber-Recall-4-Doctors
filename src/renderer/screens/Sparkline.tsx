// ===================================================================
// The vitals trends.
// ===================================================================
// A doctor cannot hold eighteen months of blood pressure readings in
// his head. These three little charts are one of the strongest
// arguments for the whole system, so they are drawn to be read from
// across a desk rather than studied.
//
// Decisions worth knowing:
//
//   Blood pressure is drawn as ONE measurement with a range, not as two
//   coloured lines. Systolic and diastolic are the top and bottom of
//   the same thing; giving them competing colours makes a 44-pixel-tall
//   chart into a puzzle. A shaded band with two thin edges reads as
//   "blood pressure" at a glance.
//
//   Only the most recent value is labelled. A number on every point is
//   noise at this size, and the exact recent figures are in the vitals
//   panel beside these charts.
//
//   No axes, no gridlines, no legend. The heading names the measurement
//   and the caption gives the span of time. Everything else is ink
//   spent on the shape, which is the only thing being asked of it.
//
//   Every point carries a plain-text tooltip with its date and value,
//   and the same numbers appear as text in the panels around it, so
//   nothing here is available only by colour or only by shape.

const INK = '#1f4e9c';
const PAD = 5;

/**
 * Two sizes. 'card' is the dense one on the Recall Card; 'patient' is
 * for the screen turned towards the patient, where the whole point is
 * that someone reads it from the far side of a desk while it is
 * explained to them.
 */
export type SparkSize = 'card' | 'patient';
const SIZES = {
  card: { w: 254, h: 44, reserve: 54, label: 13 },
  patient: { w: 430, h: 104, reserve: 82, label: 20 },
} as const;

interface Extent { min: number; max: number }

function project(value: number, extent: Extent, h: number): number {
  if (extent.max === extent.min) return h / 2;
  return h - PAD - ((value - extent.min) / (extent.max - extent.min)) * (h - PAD * 2);
}

function xAt(index: number, count: number, w: number, reserve: number): number {
  if (count <= 1) return w / 2;
  // The right-hand strip is reserved for the current value, which is
  // the number actually read. "128/84" needs all of it.
  return PAD + (index / (count - 1)) * (w - PAD * 2 - reserve);
}

function Empty({ label }: { label: string }) {
  return (
    <div className="spark">
      <div className="spark-head">{label}</div>
      <div className="spark-empty">no readings recorded</div>
    </div>
  );
}

function span(dates: string[]): string {
  if (dates.length === 0) return '';
  const first = dates[0]!.slice(0, 7);
  const last = dates[dates.length - 1]!.slice(0, 7);
  return first === last ? first : `${first} → ${last}`;
}

export function BpSparkline(
  { points, size = 'card', label = 'Blood pressure' }:
  { points: Array<{ date: string; systolic: number; diastolic: number }>; size?: SparkSize; label?: string },
) {
  if (points.length === 0) return <Empty label={label} />;
  const { w: W, h: H, reserve, label: labelSize } = SIZES[size];

  const values = points.flatMap((p) => [p.systolic, p.diastolic]);
  const extent: Extent = { min: Math.min(...values), max: Math.max(...values) };
  const last = points[points.length - 1]!;

  const top = points.map((p, i) => `${xAt(i, points.length, W, reserve)},${project(p.systolic, extent, H)}`);
  const bottom = points.map((p, i) => `${xAt(i, points.length, W, reserve)},${project(p.diastolic, extent, H)}`).reverse();

  return (
    <div className="spark">
      <div className="spark-head">{label} <span>{span(points.map((p) => p.date))}</span></div>
      <svg width={W} height={H} role="img" aria-label={`Blood pressure over ${points.length} visits, most recently ${last.systolic} over ${last.diastolic}`}>
        <polygon points={[...top, ...bottom].join(' ')} fill={INK} opacity="0.16" />
        <polyline points={top.join(' ')} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <polyline points={points.map((p, i) => `${xAt(i, points.length, W, reserve)},${project(p.diastolic, extent, H)}`).join(' ')}
                  fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" opacity="0.65" />
        {points.map((p, i) => (
          <g key={p.date + i}>
            <title>{`${p.date}: ${p.systolic}/${p.diastolic}`}</title>
            <circle cx={xAt(i, points.length, W, reserve)} cy={project(p.systolic, extent, H)} r="5" fill="transparent" />
          </g>
        ))}
        <circle cx={xAt(points.length - 1, points.length, W, reserve)} cy={project(last.systolic, extent, H)} r="4" fill={INK} stroke="#fff" strokeWidth="2" />
        <circle cx={xAt(points.length - 1, points.length, W, reserve)} cy={project(last.diastolic, extent, H)} r="4" fill={INK} stroke="#fff" strokeWidth="2" opacity="0.7" />
        <text x={W - reserve + 4} y={H / 2 + 5} className="spark-label" style={{ fontSize: labelSize }}>{last.systolic}/{last.diastolic}</text>
      </svg>
    </div>
  );
}

export function ValueSparkline(
  { label, unit, points, decimals = 0, size = 'card' }:
  { label: string; unit: string; points: Array<{ date: string; value: number }>; decimals?: number; size?: SparkSize },
) {
  if (points.length === 0) return <Empty label={label} />;
  const { w: W, h: H, reserve, label: labelSize } = SIZES[size];

  const extent: Extent = { min: Math.min(...points.map((p) => p.value)), max: Math.max(...points.map((p) => p.value)) };
  const last = points[points.length - 1]!;
  const line = points.map((p, i) => `${xAt(i, points.length, W, reserve)},${project(p.value, extent, H)}`);

  return (
    <div className="spark">
      <div className="spark-head">{label} <span>{span(points.map((p) => p.date))}</span></div>
      <svg width={W} height={H} role="img" aria-label={`${label} over ${points.length} visits, most recently ${last.value} ${unit}`}>
        <polyline points={line.join(' ')} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.date + i}>
            <title>{`${p.date}: ${p.value.toFixed(decimals)} ${unit}`}</title>
            <circle cx={xAt(i, points.length, W, reserve)} cy={project(p.value, extent, H)} r="5" fill="transparent" />
          </g>
        ))}
        <circle cx={xAt(points.length - 1, points.length, W, reserve)} cy={project(last.value, extent, H)} r="4" fill={INK} stroke="#fff" strokeWidth="2" />
        <text x={W - reserve + 4} y={H / 2 + 5} className="spark-label" style={{ fontSize: labelSize }}>{last.value.toFixed(decimals)}</text>
      </svg>
    </div>
  );
}
