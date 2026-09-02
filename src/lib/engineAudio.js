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
export function cutoffHz(rpm, throttle) {
  return Math.min(6200, 420 + rpm * 0.16 + throttle * 2600);
}

/** How loud, 0..1. Idle is audible; nothing is ever full scale. */
export function engineGain(rpm, throttle) {
  return Math.min(0.9, 0.22 + (rpm / 15000) * 0.34 + throttle * 0.3);
}

// Partials of the firing frequency, with a gain each. The half-order
// term is the one that gives the note its weight — without it a V6
// reads as a wasp rather than as something with a crankshaft in it.
const PARTIALS = [
  { ratio: 0.5, gain: 0.55, type: 'sawtooth', detune: -6 },
  { ratio: 1, gain: 1, type: 'sawtooth', detune: 0 },
  { ratio: 2, gain: 0.42, type: 'square', detune: 7 },
  { ratio: 3, gain: 0.2, type: 'sawtooth', detune: -11 },
];

/** The engine, wired up in a Web Audio graph.
 *
 *  Nothing is created until start(), which must be called from a user
 *  gesture — a browser will not let a page make noise on its own, and
 *  quite right too. */
export default class EngineAudio {
  constructor() {
    this.ctx = null;
    this.nodes = null;
  }

  get running() {
    return this.ctx != null;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
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

    const oscillators = PARTIALS.map((p) => {
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
    band.frequency.value = 2200;
    band.Q.value = 7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;
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
    const f0 = firingHz(rpm);
    for (const { osc, ratio } of oscillators) {
      osc.frequency.setTargetAtTime(Math.max(20, f0 * ratio), now, 0.035);
    }
    filter.frequency.setTargetAtTime(cutoffHz(rpm, throttle), now, 0.05);
    band.frequency.setTargetAtTime(1400 + rpm * 0.14, now, 0.06);
    master.gain.setTargetAtTime(engineGain(rpm, throttle) * 0.22, now, 0.05);
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
