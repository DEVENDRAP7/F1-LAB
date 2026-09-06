import { flagTones } from '../lib/flags.js';

/* A race-control flag: the flag drawn as a swatch, then its name.
 *
 * The name is always present, and that is load-bearing rather than
 * decorative. Measured with the dataviz validator, the sport's own
 * signal set cannot be pulled apart by hue: red against orange is ΔE
 * 12.2 under normal vision and 8.1 under deuteranopia, and every step
 * that separates those two collapses orange into yellow instead. Red,
 * orange and yellow sit adjacent in hue because that is what the flags
 * are. So the colour recalls the flag and the label states it. */
export default function TrackFlag({ flag, detail, swatchOnly = false }) {
  const tones = flagTones(flag);
  // In the message lists the sentence beside this already reads "WAVED
  // BLUE FLAG FOR CAR 23", so a chip spelling out BLUE says the word
  // twice. The swatch alone is enough there — the message is the label.
  if (swatchOnly) {
    return (
      <span
        className={`flag-swatch is-inline${tones ? '' : ' is-unknown'}`}
        role="img"
        aria-label={`${flag} flag`}
        style={
          tones
            ? {
              '--f1': `var(--flag-${tones.tone})`,
              '--f2': `var(--flag-${tones.second ?? tones.tone})`,
            }
            : undefined
        }
      />
    );
  }
  return (
    <span className="track-flag">
      <span
        className={`flag-swatch${tones ? '' : ' is-unknown'}`}
        aria-hidden="true"
        style={
          tones
            ? {
              '--f1': `var(--flag-${tones.tone})`,
              '--f2': `var(--flag-${tones.second ?? tones.tone})`,
            }
            : undefined
        }
      />
      <span className="mono">{flag}</span>
      {detail ? <span className="flag-detail">{detail}</span> : null}
    </span>
  );
}
