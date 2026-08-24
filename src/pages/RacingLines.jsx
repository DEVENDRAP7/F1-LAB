import { useEffect, useMemo, useState } from 'react';
import { dataPath } from '../lib/dataPath.js';
import { deltaTrace } from '../lib/delta.js';
import { lineToMapPoints, loadManifest, loadRacingLine } from '../lib/racingLine.js';
import { driverColor } from '../theme/palette.js';
import EmptyState from '../components/EmptyState.jsx';
import TelemetryTrace from '../components/TelemetryTrace.jsx';
import TrackMap from '../components/TrackMap.jsx';

// M3 — Racing Lines. Real driven lines only, decoded from the pipeline's
// Int16 .bin exports; the crosshair index is the single piece of shared
// state binding map, telemetry traces, and delta chart into one
// instrument (docs/SPEC.md section 5). Distance is the x-axis everywhere.

const SPACING_M = 2; // fixed resample spacing, pipeline/common.py
const MAX_DRIVERS = 4;
const SESSIONS = ['FP1', 'FP2', 'FP3', 'Q', 'S', 'R'];

export default function RacingLines() {
  const [season, setSeason] = useState({ status: 'loading', data: null });
  const [round, setRound] = useState('');
  const [session, setSession] = useState('Q');
  const [manifest, setManifest] = useState({ status: 'idle', data: null, error: null });
  const [selected, setSelected] = useState([]);
  const [lines, setLines] = useState({});
  const [crosshair, setCrosshair] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(dataPath('season.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setSeason({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setSeason({ status: 'empty', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!round) return;
    let cancelled = false;
    setManifest({ status: 'loading', data: null, error: null });
    setSelected([]);
    setLines({});
    loadManifest(round, session)
      .then((data) => {
        if (!cancelled) setManifest({ status: 'ready', data, error: null });
      })
      .catch((error) => {
        if (!cancelled) setManifest({ status: 'empty', data: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, [round, session]);

  useEffect(() => {
    if (manifest.status !== 'ready') return;
    let cancelled = false;
    const missing = selected.filter((code) => !(code in lines));
    Promise.all(
      missing.map((code) =>
        loadRacingLine(round, session, code, manifest.data).then((channels) => [code, channels]),
      ),
    )
      .then((loaded) => {
        if (!cancelled && loaded.length > 0) {
          setLines((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
        }
      })
      .catch(() => {
        // Per-driver degradation: a failed line is simply absent, and the
        // manifest listing below tells the user which laps exist.
      });
    return () => {
      cancelled = true;
    };
  }, [selected, manifest, round, session, lines]);

  const active = selected.filter((code) => code in lines);

  const mapLines = useMemo(
    () =>
      active.map((code, i) => ({
        code,
        color: driverColor(i),
        points: lineToMapPoints(lines[code], manifest.data.scale),
      })),
    [active, lines, manifest.data],
  );

  const speedSeries = active.map((code, i) => ({
    code,
    color: driverColor(i),
    values: lines[code].speed,
  }));
  const throttleSeries = active.map((code, i) => ({
    code,
    color: driverColor(i),
    values: lines[code].throttle,
  }));

  const deltaSeries = useMemo(() => {
    if (active.length < 2) return [];
    const ref = lines[active[0]].speed;
    return active.slice(1).map((code, i) => ({
      code: `${code} vs ${active[0]}`,
      color: driverColor(i + 1),
      values: deltaTrace(ref, lines[code].speed, SPACING_M),
    }));
  }, [active, lines]);

  if (season.status === 'loading') {
    return <EmptyState title="Loading calendar…" reason="Fetching public/data/season.json." />;
  }
  if (season.status === 'empty') {
    return (
      <EmptyState
        title="No session data published yet"
        reason="Racing lines are decoded from Int16 .bin artifacts that pipeline/export.py writes per session. Nothing has been ingested yet — the first real data lands when the refresh-data workflow runs on GitHub Actions."
      />
    );
  }

  const availableDrivers = manifest.status === 'ready' ? Object.keys(manifest.data.drivers) : [];

  return (
    <section>
      <h1>Racing Lines</h1>
      <div className="controls-row">
        <label>
          Round{' '}
          <select value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="">—</option>
            {season.data.calendar.map((r) => (
              <option key={r.round} value={r.round}>
                {r.round} · {r.raceName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Session{' '}
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {SESSIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!round && (
        <EmptyState
          title="Pick a round and session"
          reason="Only laps the pipeline has exported are explorable — per driver, the fastest lap of each session plus any incident-flagged lap. The driver list below shows exactly what's available."
        />
      )}

      {round && manifest.status === 'loading' && (
        <EmptyState title="Loading session…" reason="Fetching the line manifest for this session." />
      )}

      {round && manifest.status === 'empty' && (
        <EmptyState
          title={`No lines exported for round ${round} ${session}`}
          reason="This session either hasn't happened yet, hasn't been ingested by the refresh-data workflow, or had no usable position telemetry. Sessions appear here after the pipeline exports them."
        />
      )}

      {manifest.status === 'ready' && (
        <>
          <div className="driver-picker">
            {availableDrivers.map((code) => (
              <label key={code} className="driver-chip">
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  disabled={!selected.includes(code) && selected.length >= MAX_DRIVERS}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                    )
                  }
                />
                <span className="mono">{code}</span>
              </label>
            ))}
          </div>

          {active.length === 0 ? (
            <EmptyState
              title="Select up to 4 drivers"
              reason="Each selection decodes that driver's exported fastest lap from its .bin artifact."
            />
          ) : (
            <div className="lines-layout">
              <TrackMap
                outline={mapLines[0].points}
                lines={mapLines}
                marker={
                  crosshair < mapLines[0].points.length ? mapLines[0].points[crosshair] : null
                }
                width={520}
                height={520}
              />
              <div className="traces-column">
                <TelemetryTrace
                  label="Speed"
                  unit=" km/h"
                  series={speedSeries}
                  spacingM={SPACING_M}
                  crosshairIndex={crosshair}
                  onCrosshair={setCrosshair}
                  formatValue={(v) => (v / 10).toFixed(0)}
                />
                <TelemetryTrace
                  label="Throttle"
                  unit=" %"
                  series={throttleSeries}
                  spacingM={SPACING_M}
                  crosshairIndex={crosshair}
                  onCrosshair={setCrosshair}
                  height={80}
                />
                {deltaSeries.length > 0 && (
                  <TelemetryTrace
                    label={`Delta to ${active[0]} (s) — integrated speed difference over distance`}
                    unit=" s"
                    series={deltaSeries}
                    spacingM={SPACING_M}
                    crosshairIndex={crosshair}
                    onCrosshair={setCrosshair}
                    formatValue={(v) => v.toFixed(3)}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
