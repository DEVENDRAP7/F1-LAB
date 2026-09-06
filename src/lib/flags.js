// Race-control flags, and the colours they are actually waved in.
//
// The feed publishes a flag by name — YELLOW, DOUBLE YELLOW, BLUE,
// BLACK AND WHITE — and every one of them was rendering as the same grey
// chip, so the one piece of colour language every viewer of this sport
// already reads was being thrown away.
//
// `tone` is the swatch fill. `second` is set only for the flags that are
// genuinely two-tone, and they are drawn split rather than blended: a
// black-and-white flag is not grey.
//
// Anything the feed sends that is not listed here keeps the neutral chip
// rather than being guessed at — the rule about not inventing detail
// applies to a flag's colour as much as to a lap time.
const FLAGS = {
  'YELLOW': { tone: 'yellow' },
  'DOUBLE YELLOW': { tone: 'yellow', second: 'yellow' },
  'RED': { tone: 'red' },
  'GREEN': { tone: 'green' },
  'CLEAR': { tone: 'green' },
  'BLUE': { tone: 'blue' },
  'WHITE': { tone: 'white' },
  'BLACK': { tone: 'black' },
  'BLACK AND WHITE': { tone: 'black', second: 'white' },
  'BLACK AND ORANGE': { tone: 'black', second: 'orange' },
  'CHEQUERED': { tone: 'black', second: 'white' },
};

/** The swatch tones for a flag name, or null if the feed sent one we do
 *  not have a published colour for. */
export function flagTones(name) {
  return FLAGS[String(name ?? '').trim().toUpperCase()] ?? null;
}
