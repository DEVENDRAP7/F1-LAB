import { compoundSwatch } from '../lib/compounds.js';
import {
  addStop,
  lapsCovered,
  removeStint,
  setCompound,
  setLaps,
} from '../lib/strategyEdit.js';

// Editing the strategy is the whole point of the module, so the editor
// enforces the one rule the model cannot bend: the stints have to add up
// to the race distance. A strategy that covers 47 laps of a 44-lap race
// is not a what-if, it is a different race, and the model rejects it
// rather than silently truncating.

export default function StrategyEditor({ strategy, totalLaps, compounds, onChange, labelFor }) {
  const covered = lapsCovered(strategy);

  return (
    <div className="strategy-editor">
      <ol className="stint-editor-list">
        {strategy.map((stint, i) => (
          <li key={i} className="stint-editor-row">
            <span className="stint-editor-number mono">{i + 1}</span>
            <label className="field">
              <span className="field-label">Compound</span>
              <select
                value={stint.compound}
                onChange={(e) => onChange(setCompound(strategy, i, e.target.value))}
              >
                {compounds.map((c) => (
                  <option key={c} value={c}>
                    {labelFor ? labelFor(c) : c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Laps</span>
              <input
                type="number"
                min="1"
                max={totalLaps}
                value={stint.laps}
                onChange={(e) => onChange(setLaps(strategy, i, Number(e.target.value)))}
              />
            </label>
            <span
              className="stint-editor-swatch"
              style={{ background: compoundSwatch(stint.compound) }}
              aria-hidden="true"
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => onChange(removeStint(strategy, i))}
              disabled={strategy.length <= 1}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      <div className="strategy-editor-foot">
        <button type="button" className="ghost-button" onClick={() => onChange(addStop(strategy))}>
          Add a stop
        </button>
        <span className={`mono ${covered === totalLaps ? 'covered-ok' : 'covered-bad'}`}>
          {covered} / {totalLaps} laps
        </span>
      </div>
      {covered !== totalLaps && (
        <p className="panel-note">
          The stints have to add up to the race distance before the model will run: this
          strategy covers {covered} of {totalLaps} laps.
        </p>
      )}
    </div>
  );
}
