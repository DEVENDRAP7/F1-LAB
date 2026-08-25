import { useState } from 'react';

// M4 stint chart: one row per driver, each stint a span across the race
// distance. The x-axis is lap number, so bar length *is* stint length —
// nothing is stacked proportionally or normalised.
//
// Coloured by REAL tyre compound where one is known — the OpenF1 stint
// feed publishes it, and the pipeline attaches it only when a stint
// matches by driver code and lap overlap. Those are the sport's own
// bands, so the colour means exactly what a reader already assumes.
//
// Where no compound could be matched the bar falls back to the
// sequential stint-ordinal ramp it always used, and the legend says so.
// That distinction is the whole point: this project shipped the ordinal
// ramp for months precisely because inventing a compound would have been
// decoration masquerading as data. Colour is never the only channel —
// the compound name is written into the bar and the boundary is carried
// by a 2px surface gap and the pit-lap marker.

const ROW_HEIGHT = 26;
const ROW_GAP = 4;
const AXIS_HEIGHT = 24;
const SEGMENT_GAP_PX = 2;

// Sequential steps for stint ordinal (1st, 2nd, 3rd... stint). One hue,
// light to dark — magnitude encoding, not identity.
const STINT_STEPS = ['var(--stint-1)', 'var(--stint-2)', 'var(--stint-3)', 'var(--stint-4)'];

// The ramp crosses the point where light text stops being readable and
// dark text starts, so the in-bar label flips with it. Measured against
// each step: white on steps 1-2 (7.5:1, 4.9:1), black on steps 3-4
// (6.4:1, 8.9:1) — every one clears 4.5:1 for small text. A single
// label colour for the whole ramp cannot: it fails at one end or the
// other.
const STINT_LABEL_INK = ['#ffffff', '#ffffff', '#000000', '#000000'];

// The sport's compound bands. Hard is a light neutral rather than pure
// white so it still reads as a band on a light surface; intermediate and
// wet are included even though a dry race never shows them, because a
// wet race must not fall back to the ordinal ramp for want of a colour.
const COMPOUND_FILL = {
  SOFT: 'var(--compound-soft)',
  MEDIUM: 'var(--compound-medium)',
  HARD: 'var(--compound-hard)',
  INTERMEDIATE: 'var(--compound-inter)',
  WET: 'var(--compound-wet)',
};

// Ink chosen per band against that band, so the label clears 4.5:1 on
// every one rather than being legible on some and grey mush on others.
const COMPOUND_INK = {
  SOFT: '#ffffff',
  MEDIUM: '#141414',
  HARD: '#141414',
  INTERMEDIATE: '#0d0d0d',
  WET: '#ffffff',
};

export function compoundOf(stint) {
  const c = (stint?.compound || '').toUpperCase();
  return c in COMPOUND_FILL ? c : null;
}

function stepIndex(stintNumber) {
  return Math.min(stintNumber - 1, STINT_STEPS.length - 1);
}

function stintFill(stint) {
  const compound = compoundOf(stint);
  return compound ? COMPOUND_FILL[compound] : STINT_STEPS[stepIndex(stint.stint)];
}

function stintLabelInk(stint) {
  const compound = compoundOf(stint);
  return compound ? COMPOUND_INK[compound] : STINT_LABEL_INK[stepIndex(stint.stint)];
}

export default function StintChart({ stints, totalLaps, driverOrder, onHoverStint, codeFor }) {
  const [hovered, setHovered] = useState(null);

  const byDriver = new Map();
  for (const s of stints) {
    if (!byDriver.has(s.driverId)) byDriver.set(s.driverId, []);
    byDriver.get(s.driverId).push(s);
  }

  const drivers = driverOrder.filter((d) => byDriver.has(d));
  const height = drivers.length * (ROW_HEIGHT + ROW_GAP) + AXIS_HEIGHT;
  const plotWidth = 100; // percent-based so the chart is fluid

  const lapToPct = (lap) => (lap / totalLaps) * plotWidth;

  // Always label the final lap: without it the axis stops at the last
  // round multiple (50 on a 58-lap race) and the bars appear to overrun
  // their own scale. Drop any regular tick within a full step of the end
  // so the two labels cannot collide — at 390px wide, "50" and "58" were
  // overprinting each other.
  const axisTicks = [];
  const tickStep = totalLaps > 60 ? 20 : 10;
  for (let lap = 0; lap < totalLaps; lap += tickStep) {
    if (totalLaps - lap >= tickStep) axisTicks.push(lap);
  }
  axisTicks.push(totalLaps);

  return (
    <div className="stint-chart" style={{ minHeight: height }}>
      <div className="stint-rows">
        {drivers.map((driverId, rowIndex) => {
          const rows = byDriver.get(driverId).slice().sort((a, b) => a.startLap - b.startLap);
          return (
            <div className="stint-row" key={driverId} style={{ height: ROW_HEIGHT }}>
              <span className="stint-row-label mono">
                {codeFor ? codeFor(driverId) : driverId}
              </span>
              <div className="stint-row-track">
                {rows.map((s) => {
                  const left = lapToPct(s.startLap - 1);
                  const width = lapToPct(s.laps);
                  const isHovered =
                    hovered && hovered.driverId === s.driverId && hovered.stint === s.stint;
                  return (
                    <div
                      key={s.stint}
                      className={`stint-seg${isHovered ? ' is-hovered' : ''}`}
                      style={{
                        left: `${left}%`,
                        width: `calc(${width}% - ${SEGMENT_GAP_PX}px)`,
                        background: stintFill(s),
                      }}
                      onMouseEnter={() => {
                        setHovered(s);
                        onHoverStint?.(s);
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                        onHoverStint?.(null);
                      }}
                      tabIndex={0}
                      onFocus={() => setHovered(s)}
                      onBlur={() => setHovered(null)}
                      role="img"
                      aria-label={`${driverId} stint ${s.stint}, ${compoundOf(s) ? `${compoundOf(s).toLowerCase()} tyre, ` : ''}laps ${s.startLap} to ${s.endLap}, ${s.laps} laps`}
                    >
                      {width > 8 && (
                        <span
                          className="stint-seg-label mono"
                          style={{ color: stintLabelInk(s) }}
                        >
                          {compoundOf(s) && width > 14
                            ? `${compoundOf(s).charAt(0)} ${s.laps}`
                            : s.laps}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="stint-axis-wrap">
        {/* The axis title lives in the row-label gutter, which is empty:
            at the right-hand end it overprinted the final-lap tick. */}
        <span className="stint-axis-title">lap</span>
        <div className="stint-axis">
          {axisTicks.map((lap) => (
            <span key={lap} className="stint-tick mono" style={{ left: `${lapToPct(lap)}%` }}>
              {lap}
            </span>
          ))}
        </div>
      </div>

      {hovered && (
        <div className="chart-tooltip" role="status">
          <strong className="mono">{hovered.driverId}</strong> · stint {hovered.stint}
          <br />
          laps <span className="mono">{hovered.startLap}</span>–
          <span className="mono">{hovered.endLap}</span> ({hovered.laps} laps)
          <br />
          <span className="tooltip-note">{hovered.compoundSource}</span>
        </div>
      )}
    </div>
  );
}
