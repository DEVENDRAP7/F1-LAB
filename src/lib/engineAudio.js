// A synthesised power unit, for the steering wheel demos.
//
// ── why this is synthesised and not a recording ───────────────────────
// Every recording of a real Formula 1 engine is somebody's copyright —
// the broadcast feed, the onboard, the trackside video you would rip it
// from. None of it is ours to ship, and this site's whole claim is that
// what it publishes is real and legitimately sourced. A clip long
// enough to cover a fifteen-second demo would also be several hundred
// kilobytes on its own.
//
// ── the rewrite, and what four earlier attempts got wrong ─────────────
// The first four versions were a stack of DETUNED SAWTOOTH OSCILLATORS
// through a lowpass. That is a supersaw: the most recognisable synth
// patch there is. It was rearranged four times — harmonics moved, a
// growl LFO added, a combustion gate added — and every time it still
// sounded electric, because the identity of a sound is in its SOURCE
// and the source was a synthesiser.
//
// It also had no bass, and the reason is arithmetic. The spectrum was
// built upward from the FIRING frequency, which at demo revs is about
// 600 Hz for a V6. Everything else was a multiple of that, so the
// lowest significant content sat around 150 Hz and was a minor partial.
// There was nothing down there to be bass.
//
// This version is built the way an engine actually makes noise:
//
//   HALF-ORDER SUB.  A sine at the half engine order — the crank turning
//   at half speed, f0 / cylinders. For a V6 at 12 600 rpm that is 105 Hz,
//   which is bass. It is the largest term in the mix.
//
//   CRANK-RATE BODY.  A triangle at the crank rotation rate, twice the
//   half-order. This is the note you actually hear as the engine's pitch.
//
//   FIRING BUZZ.  A single sawtooth at the firing rate, quietly, for
//   edge. One, not six, and not detuned: the detuning was the supersaw.
//
//   EXHAUST ROAR.  Looping noise gated at the firing rate. Broadband,
//   not tonal — a real exhaust is mostly noise, and a narrow band of it
//   is a whistle, which is what the old one was.
//
//   FIXED RESONANCES.  Two or three bandpass peaks at frequencies that
//   DO NOT MOVE WITH RPM. This is the part that makes a sound belong to
//   a physical object: an exhaust pipe and a body shell ring at their
//   own frequencies whatever the engine is doing. Everything in the old
//   synth scaled with revs, and a spectrum where every feature slides
//   together is the definition of synthetic.

/** One combustion pulse, as a waveshaper curve.
 *
 *  An engine is not a tone. It is a series of discrete bangs that only
 *  merge into a tone because they arrive hundreds of times a second. A
 *  sawtooth sweeps -1 to +1 once per firing; this maps that to 1 falling
 *  to 0, so every cycle is an attack and a decay. */
export function pulseCurve(sharpness = 4, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    curve[i] = (1 - i / (n - 1)) ** sharpness;
  }
  return curve;
}

/** The firing frequency of a four-stroke, in Hz. */
export function firingHz(rpm, cylinders = 6) {
  return (rpm / 60) * (cylinders / 2);
}

/** The half engine order: the crank turning at half speed, in Hz.
 *
 *  This is where an engine's weight lives, and building the spectrum
 *  upward from the firing rate instead of downward from here is why
 *  four earlier versions had no bass at all. */
export function halfOrderHz(rpm) {
  return rpm / 120;
}

/** Where the lowpass sits, in Hz. */
export function cutoffHz(rpm, throttle, voice) {
  const open = 380 + rpm * 0.16 + throttle * 1800;
  return Math.max(240, Math.min(voice.ceiling, open));
}

/** How loud, 0..1. Idle is audible; nothing is ever full scale. */
export function engineGain(rpm, throttle, voice) {
  return Math.min(0.9, 0.30 + (rpm / voice.redline) * 0.28 + throttle * 0.26);
}

export const VOICES = {
  v6: {
    id: 'v6',
    name: 'V6 turbo hybrid',
    note: 'The 2026 Formula 1 layout: 1.6-litre V6, and the revs to match.',
    cylinders: 6,
    idle: 4000,
    redline: 15000,
    ceiling: 4200,
    trim: 0.26,
    // Layer gains. The sub is the loudest thing in the engine, which is
    // the opposite of every earlier version.
    sub: 1.0,
    body: 0.82,
    buzz: 0.26,
    roar: 0.62,
    pulse: { sharp: 3, depth: 0.5 },
    // [Hz, Q, gain] — an exhaust and a body shell, ringing where they
    // ring regardless of what the engine is doing.
    formants: [[140, 3.0, 1.0], [330, 2.4, 0.7], [720, 1.8, 0.35]],
    shelf: { hz: 180, gain: 9 },
  },
  v8: {
    id: 'v8',
    name: 'V8 (2006-2013)',
    note: 'The naturally aspirated 2.4-litre V8 that ran until 2013 — eight cylinders '
      + 'to 18 000 rpm, firing 1 200 times a second where the 2026 V6 manages 750.',
    cylinders: 8,
    idle: 5000,
    redline: 18000,
    ceiling: 5400,
    trim: 0.26,
    sub: 0.92,
    body: 0.9,
    buzz: 0.34,
    roar: 0.46,
    pulse: { sharp: 3, depth: 0.46 },
    formants: [[160, 2.8, 0.9], [380, 2.2, 0.85], [880, 1.7, 0.45]],
    shelf: { hz: 175, gain: 8 },
  },
  w16: {
    id: 'w16',
    name: 'W16 quad-turbo',
    note: 'NOT a Formula 1 engine — a road-car layout, here so you can hear what '
      + 'sixteen cylinders and a 6 700 rpm limit do to the same rev sweep.',
    cylinders: 16,
    idle: 900,
    redline: 6700,
    ceiling: 2600,
    trim: 0.22,
    sub: 1.0,
    body: 0.86,
    buzz: 0.2,
    roar: 0.72,
    pulse: { sharp: 4, depth: 0.6 },
    formants: [[75, 3.4, 1.0], [180, 2.6, 0.8], [430, 1.9, 0.3]],
    shelf: { hz: 200, gain: 12 },
  },
  v8road: {
    id: 'v8road',
    name: 'V8 road car',
    note: 'NOT a Formula 1 engine. A cross-plane road V8: the banks fire unevenly, '
      + 'which puts energy on half and three-quarter orders a flat-plane racing V8 '
      + 'never makes — that lumpiness is the burble you are hearing.',
    cylinders: 8,
    idle: 700,
    redline: 7000,
    ceiling: 2200,
    trim: 0.21,
    sub: 1.0,
    body: 0.8,
    buzz: 0.22,
    roar: 0.66,
    // Sharper and deeper than the racing voices: at 700-7000 rpm the
    // individual strokes are slow enough to hear as separate events,
    // and that lumpiness is the burble.
    pulse: { sharp: 5, depth: 0.66 },
    formants: [[68, 3.6, 1.0], [165, 2.8, 0.85], [370, 2.0, 0.35]],
    shelf: { hz: 210, gain: 13 },
  },
};

export const DEFAULT_VOICE = VOICES.v6;

/** Put a demo's revs onto an engine's own rev range.
 *
 *  The sequences are written in Formula 1 revs because that is the car
 *  they describe. Playing them on an engine that stops at 6 700 means
 *  mapping the FRACTION of the sweep, not the number. */
export function voiceRpm(voice, demoRpm, from = VOICES.v6) {
  const span = from.redline - from.idle;
  const u = Math.max(0, Math.min(1, (demoRpm - from.idle) / span));
  return voice.idle + u * (voice.redline - voice.idle);
}

/** The engine, wired up in a Web Audio graph.
 *
 *  Nothing is created until start(), which must be called from a user
 *  gesture — a browser will not let a page make noise on its own. */
export default class EngineAudio {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.voice = DEFAULT_VOICE;
    this.owned = true;
  }

  get running() {
    return this.ctx != null;
  }

  /** Build the graph, or rebuild it if the voice has changed.
   *
   *  `context` is for rendering offline: scripts/audio_preview.mjs drives
   *  this exact graph through an OfflineAudioContext to produce a WAV,
   *  which is the only way anything about how it SOUNDS can be checked
   *  rather than asserted. */
  start(voice = DEFAULT_VOICE, context = null) {
    if (this.ctx && this.voice.id === voice.id && !context) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    if (this.ctx) this.stop();
    this.voice = voice;

    let ctx = context;
    if (!ctx) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
    }
    this.owned = !context;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = voice.shelf.hz;
    shelf.gain.value = voice.shelf.gain;
    shelf.connect(master);

    // The ceiling. Low, because an engine heard from outside a car is a
    // dull roar and not a buzz.
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 900;
    lowpass.Q.value = 0.7;
    lowpass.connect(shelf);

    // Fixed resonances, in parallel, plus a dry path. All formants and
    // no dry signal is a vocoder; all dry and no formants is a synth.
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const dry = ctx.createGain();
    dry.gain.value = 0.4;
    bus.connect(dry).connect(lowpass);
    for (const [hz, q, gain] of voice.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      bus.connect(bp).connect(g).connect(lowpass);
    }

    // The combustion gate: everything passes through it, and it opens
    // and shuts once per firing.
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const floorSrc = ctx.createConstantSource();
    floorSrc.offset.value = 1 - voice.pulse.depth;
    floorSrc.connect(gate.gain);
    floorSrc.start();
    const pulseOsc = ctx.createOscillator();
    pulseOsc.type = 'sawtooth';
    pulseOsc.frequency.value = 120;
    const shaper = ctx.createWaveShaper();
    shaper.curve = pulseCurve(voice.pulse.sharp);
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = voice.pulse.depth;
    pulseOsc.connect(shaper).connect(pulseDepth).connect(gate.gain);
    pulseOsc.start();
    gate.connect(bus);

    // Sources. Sine and triangle, not sawtooths, and NOT detuned: the
    // detuning is what made every earlier version a supersaw.
    const layer = (type, gain) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 100;
      const g = ctx.createGain();
      g.gain.value = gain * 0.34;
      osc.connect(g).connect(gate);
      osc.start();
      return osc;
    };
    const subOsc = layer('sine', voice.sub);
    const bodyOsc = layer('triangle', voice.body);
    const buzzOsc = layer('sawtooth', voice.buzz);

    // Exhaust roar: two seconds of noise on a loop, gated with the rest.
    const frames = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Brown-ish noise: integrated white, which has far more low-frequency
    // energy than white and is what a exhaust actually sounds like.
    let last = 0;
    for (let i = 0; i < frames; i += 1) {
      last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 12;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const roar = ctx.createGain();
    roar.gain.value = voice.roar * 0.5;
    noise.connect(roar).connect(gate);
    noise.start();

    // A gate shut most of the cycle throws away average level, and
    // mean((1-x)^k) over a cycle is 1/(k+1) — exactly what to give back.
    this.pulseMean = (1 - voice.pulse.depth) + voice.pulse.depth / (voice.pulse.sharp + 1);
    this.ctx = ctx;
    this.nodes = { master, lowpass, subOsc, bodyOsc, buzzOsc, pulseOsc };
  }

  /** Point the whole graph at one operating point. */
  set(rpm, throttle, when = null) {
    if (!this.ctx) return;
    const { master, lowpass, subOsc, bodyOsc, buzzOsc, pulseOsc } = this.nodes;
    const now = when ?? this.ctx.currentTime;
    const own = voiceRpm(this.voice, rpm);
    const f0 = firingHz(own, this.voice.cylinders);
    const half = halfOrderHz(own);
    const ramp = (param, value, tau = 0.04) => {
      if (when == null) param.setTargetAtTime(value, now, tau);
      else param.linearRampToValueAtTime(value, now);
    };
    ramp(subOsc.frequency, Math.max(18, half));
    ramp(bodyOsc.frequency, Math.max(24, half * 2));
    ramp(buzzOsc.frequency, Math.max(30, f0));
    ramp(pulseOsc.frequency, Math.max(8, f0), 0.03);
    ramp(lowpass.frequency, cutoffHz(own, throttle, this.voice), 0.06);
    ramp(
      master.gain,
      (engineGain(own, throttle, this.voice) * this.voice.trim) / this.pulseMean,
      0.05,
    );
  }

  /** Fade out and tear the graph down. */
  stop() {
    if (!this.ctx || !this.owned) { this.ctx = null; this.nodes = null; return; }
    const { master } = this.nodes;
    const ctx = this.ctx;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    this.ctx = null;
    this.nodes = null;
    setTimeout(() => ctx.close().catch(() => {}), 350);
  }
}
