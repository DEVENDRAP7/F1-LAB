// A synthesised power unit, for the steering wheel demos.
//
// ── why this is synthesised and not a recording ───────────────────────
// Every recording of a real Formula 1 engine is somebody's copyright —
// the broadcast feed, the onboard, the trackside video you would rip it
// from. None of it is ours to ship, and this site's whole claim is that
// what it publishes is real and legitimately sourced. A clip long
// enough to cover a fifteen-second demo would also be several hundred
// kilobytes on its own, against a 400 KB budget for the entire initial
// load.
//
// So the engine here is generated in the browser from an oscillator
// stack. It costs about four kilobytes of code and no assets at all,
// and it is honest: it is a plausible V6 turbo note, not a recording of
// one, and the page says as much.
//
// ── how an engine note is built ───────────────────────────────────────
// The pitch you hear is the FIRING frequency, not the crank speed. A
// four-stroke fires once per cylinder every two revolutions, so
//
//     f0 = (rpm / 60) x (cylinders / 2)
//
// which for a V6 at 12 000 rpm is 600 Hz. Everything else is harmonics
// of that, a lowpass whose cutoff opens with throttle — that is what
// makes an engine sound like it is being worked rather than just spun —
// and a band of noise around a much higher, rpm-linked frequency for
// the turbo.

/** The firing frequency of a four-stroke, in Hz. */
export function firingHz(rpm, cylinders = 6) {
  return (rpm / 60) * (cylinders / 2);
}

/** Where the lowpass sits, in Hz.
 *
 *  Opening the filter with throttle rather than only with revs is what
 *  separates an engine under load from one coasting at the same speed.
 *  Clamped at the top so a high-rev, full-throttle sample cannot run
 *  into the region where the harmonics turn into a whistle. */
export function cutoffHz(rpm, throttle, voice = DEFAULT_VOICE) {
  const open = 420 + rpm * 0.16 + throttle * 2600;
  // Never below the fundamental it is meant to be shaping: a low-revving
  // voice has a low ceiling, and on the W16 a flat 3 000 Hz cap would
  // have closed under its own firing frequency at the top end.
  return Math.max(firingHz(rpm, voice.cylinders) * 1.6, Math.min(voice.ceiling, open));
}

/** How loud, 0..1. Idle is audible; nothing is ever full scale. */
export function engineGain(rpm, throttle, voice = DEFAULT_VOICE) {
  return Math.min(0.9, 0.22 + (rpm / voice.redline) * 0.34 + throttle * 0.3);
}

// ── voices ───────────────────────────────────────────────────────────
// Two engines, and the interesting thing is that swapping the cylinder
// count alone would not make them sound different.
//
// A W16 does not rev where a Formula 1 V6 revs — call it 6 700 against
// 15 000 — and firing frequency is (rpm/60) x (cylinders/2), so sixteen
// cylinders at a quarter of the crank speed land at very nearly the
// same pitch. Wire the demos' revs straight through with cylinders: 16
// and you get an F1 note with the wrong label on it.
//
// What actually separates them is the rev range each one is asked to
// cover, and the TIMBRE: a big low-revving engine carries most of its
// energy in the low orders — quarter and half of the firing frequency,
// the rumble you feel — while the F1 unit is thin and bright and its
// energy is all in the harmonics above f0. So each voice brings its own
// rev range, its own partials, and its own filter ceiling.
export const VOICES = {
  v6: {
    id: 'v6',
    name: 'V6 turbo hybrid',
    note: 'The 2026 Formula 1 layout: 1.6-litre V6, and the revs to match.',
    cylinders: 6,
    idle: 4000,
    redline: 15000,
    ceiling: 6200,
    noise: 0.05,
    noiseHz: [1400, 0.14],
    partials: [
      { ratio: 0.5, gain: 0.55, type: 'sawtooth', detune: -6 },
      { ratio: 1, gain: 1, type: 'sawtooth', detune: 0 },
      { ratio: 2, gain: 0.42, type: 'square', detune: 7 },
      { ratio: 3, gain: 0.2, type: 'sawtooth', detune: -11 },
    ],
  },
  w16: {
    id: 'w16',
    name: 'W16 quad-turbo',
    note: 'NOT a Formula 1 engine — a road-car layout, here so you can hear what '
      + 'sixteen cylinders and a 6 700 rpm limit do to the same rev sweep.',
    cylinders: 16,
    idle: 900,
    redline: 6700,
    ceiling: 3000,
    noise: 0.1,
    noiseHz: [700, 0.16],
    partials: [
      { ratio: 0.25, gain: 0.72, type: 'sawtooth', detune: -9 },
      { ratio: 0.5, gain: 0.95, type: 'sawtooth', detune: 5 },
      { ratio: 1, gain: 0.8, type: 'sawtooth', detune: 0 },
      { ratio: 2, gain: 0.22, type: 'square', detune: -12 },
    ],
  },
};

export const DEFAULT_VOICE = VOICES.v6;

/** Put a demo's revs onto an engine's own rev range.
 *
 *  The sequences are written in Formula 1 revs because that is the car
 *  they describe. Playing them on an engine that stops at 6 700 means
 *  mapping the FRACTION of the sweep, not the number — otherwise a W16
 *  spends the whole demo three times past its limiter. */
export function voiceRpm(voice, demoRpm, from = VOICES.v6) {
  const span = from.redline - from.idle;
  const u = Math.max(0, Math.min(1, (demoRpm - from.idle) / span));
  return voice.idle + u * (voice.redline - voice.idle);
}

/** The engine, wired up in a Web Audio graph.
 *
 *  Nothing is created until start(), which must be called from a user
 *  gesture — a browser will not let a page make noise on its own, and
 *  quite right too. */
export default class EngineAudio {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.voice = DEFAULT_VOICE;
  }

  get running() {
    return this.ctx != null;
  }

  /** Build the graph, or rebuild it if the voice has changed.
   *
   *  A voice is a different oscillator stack, not a parameter, so
   *  switching means tearing the old one down. Doing it here rather
   *  than in the caller keeps "start with this voice" a single call. */
  start(voice = DEFAULT_VOICE) {
    if (this.ctx && this.voice.id === voice.id) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    if (this.ctx) this.stop();
    this.voice = voice;
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.9;
    filter.connect(master);

    const oscillators = voice.partials.map((p) => {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      osc.detune.value = p.detune;
      const gain = ctx.createGain();
      gain.gain.value = p.gain * 0.18;
      osc.connect(gain).connect(filter);
      osc.start();
      return { osc, ratio: p.ratio };
    });

    // Turbo and induction: two seconds of white noise on a loop, held
    // in a narrow band that climbs with the revs. It is what fills the
    // gap between the harmonics, and without it the stack above sounds
    // like a synthesiser playing a chord.
    const frames = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = voice.noiseHz[0] + 800;
    band.Q.value = 7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = voice.noise;
    noise.connect(band).connect(noiseGain).connect(master);
    noise.start();

    this.ctx = ctx;
    this.nodes = { master, filter, oscillators, noise, band, noiseGain };
  }

  /** Point the whole graph at one operating point.
   *
   *  setTargetAtTime, not setValueAtTime: stepping a frequency once per
   *  animation frame clicks audibly, and a short time constant turns
   *  sixty steps a second into a slide. */
  set(rpm, throttle) {
    if (!this.ctx) return;
    const { master, filter, oscillators, band } = this.nodes;
    const now = this.ctx.currentTime;
    // The sequences are written in Formula 1 revs; a voice that stops at
    // 6 700 gets the same FRACTION of its own sweep.
    const own = voiceRpm(this.voice, rpm);
    const f0 = firingHz(own, this.voice.cylinders);
    for (const { osc, ratio } of oscillators) {
      osc.frequency.setTargetAtTime(Math.max(18, f0 * ratio), now, 0.035);
    }
    filter.frequency.setTargetAtTime(cutoffHz(own, throttle, this.voice), now, 0.05);
    const [base, slope] = this.voice.noiseHz;
    band.frequency.setTargetAtTime(base + own * slope, now, 0.06);
    master.gain.setTargetAtTime(engineGain(own, throttle, this.voice) * 0.22, now, 0.05);
  }

  /** Fade out and tear the graph down. */
  stop() {
    if (!this.ctx) return;
    const { master } = this.nodes;
    const ctx = this.ctx;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    this.ctx = null;
    this.nodes = null;
    setTimeout(() => ctx.close().catch(() => {}), 350);
  }
}
