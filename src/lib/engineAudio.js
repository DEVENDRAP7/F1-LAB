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
  // Steeper with revs and wider with throttle than it was, because the
  // V6's sixth order at 12 600 rpm is 3.8 kHz and the old slope left the
  // cutoff at 5.0 kHz — audible, but with the top of the note shelved.
  // The W16 is untouched by this: its own 3 kHz ceiling clamps first at
  // every point in its range.
  const open = 420 + rpm * 0.28 + throttle * 3200;
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
    // Was 6200, which rolled off the harmonics that make this engine
    // sound like this engine: at 12 600 rpm the sixth order is 3.8 kHz
    // and it was being filtered away.
    // 7.4 kHz, not 9.6: the top orders were being heard on their own,
    // with nothing under them, which is most of what "electric" means.
    ceiling: 7400,
    trim: 1.0,
    q: 1.1,
    growl: { ratio: 1, depth: 260 },
    noise: 0.06,
    // Was centred near 4.7 kHz at speed. That is not a turbo, that is a
    // hiss sitting on top of the note.
    noiseHz: [1200, 0.12],
    shelf: { hz: 175, gain: 7 },
    // Pitch is not only frequency. What you hear as the pitch of a
    // complex note is the partial carrying the most energy, and the
    // strongest term here used to be the fundamental with a heavy
    // half-order under it — which is a heavy, low reading of a V6.
    // The second harmonic is the loudest term now, so the perceived
    // pitch sits an octave up, and the half-order is nearly gone. That
    // is the difference between a growl and a scream, and a Formula 1
    // V6 screams.
    partials: [
      { ratio: 0.25, gain: 0.34, type: 'sawtooth', detune: -16 },
      { ratio: 0.5, gain: 0.5, type: 'sawtooth', detune: -6 },
      { ratio: 1, gain: 0.7, type: 'sawtooth', detune: 0 },
      { ratio: 2, gain: 1, type: 'sawtooth', detune: 7 },
      { ratio: 3, gain: 0.55, type: 'sawtooth', detune: -11 },
      { ratio: 4, gain: 0.26, type: 'square', detune: 9 },
      { ratio: 6, gain: 0.12, type: 'sawtooth', detune: -14 },
    ],
  },
  // The first cut of this sounded like an electric motor, and the reason
  // is worth keeping written down. Its loudest partial was at 0.5 — HALF
  // the firing frequency — as a clean sawtooth under a 3 kHz lowpass.
  // That is a synth bass patch, near enough exactly. A combustion engine
  // is a series of discrete bangs, and three things were missing:
  //
  //  - the firing rate itself has to dominate. It is the pulse you hear;
  //    burying it under a sub-octave drone removes the combustion.
  //  - the spectrum has to be dense and slightly INHARMONIC. Four clean
  //    integer partials is a chord, not an engine, so there is a 1.5
  //    order in here now and much wider detune spread.
  //  - the filter has to move with the pulses. A static lowpass over a
  //    steady tone is what a synthesiser sounds like; sweeping the
  //    cutoff at the crank-cycle rate is the chug of an engine, and it
  //    throws sidebands that no amount of extra partials would give.
  w16: {
    id: 'w16',
    name: 'W16 quad-turbo',
    note: 'NOT a Formula 1 engine — a road-car layout, here so you can hear what '
      + 'sixteen cylinders and a 6 700 rpm limit do to the same rev sweep.',
    cylinders: 16,
    idle: 900,
    redline: 6700,
    // Back down from 5200. The last pass fixed this voice sounding
    // electric and then overshot into pitchy, and the ceiling was most
    // of it — 5.2 kHz let through harmonics a sixteen-cylinder engine
    // has no business being heard through.
    ceiling: 3200,
    trim: 0.7,
    q: 2.6,
    growl: { ratio: 0.5, depth: 700 },
    // Big turbos are low, breathy noise, not hiss. This band was
    // centred near 1.7 kHz at speed, which is a hiss.
    noise: 0.16,
    noiseHz: [280, 0.1],
    // A low shelf under the whole voice. Partials alone could not do
    // this: the weight of a big engine is energy below 200 Hz, and at
    // this engine's revs the quarter-order is the only term down there.
    shelf: { hz: 190, gain: 10 },
    // The correction to the correction. What made this sound electric
    // was SMOOTHNESS — a static filter over a sparse, clean spectrum —
    // not the low fundamental, and moving the energy up to the firing
    // rate to fix it took the weight out with the drone. The roughness
    // now comes from the swept cutoff, the 1.5 order and the noise, so
    // the energy can go back down where a W16's actually is: the
    // half-order dominates again, with a quarter-order under it, and
    // the firing rate stays loud enough to still hear as combustion.
    partials: [
      { ratio: 0.25, gain: 0.55, type: 'sawtooth', detune: -19 },
      { ratio: 0.5, gain: 1, type: 'sawtooth', detune: -14 },
      { ratio: 1, gain: 0.8, type: 'sawtooth', detune: 0 },
      { ratio: 1.5, gain: 0.24, type: 'sawtooth', detune: 11 },
      { ratio: 2, gain: 0.4, type: 'sawtooth', detune: -7 },
      { ratio: 3, gain: 0.16, type: 'square', detune: 13 },
    ],
  },
  // The 2006-2013 Formula 1 engine: 2.4 litres, eight cylinders, and
  // twice the crank speed of a road car's redline. At 18 000 rpm it
  // fires 1 200 times a second against the 2026 V6's 750, which is the
  // whole reason people remember these as the ones that screamed.
  // Naturally aspirated, so there is almost no turbo noise in it — what
  // little there is here is induction, not boost.
  v8: {
    id: 'v8',
    name: 'V8 (2006-2013)',
    note: 'The naturally aspirated 2.4-litre V8 that ran until 2013 — eight cylinders '
      + 'to 18 000 rpm, firing 1 200 times a second where the 2026 V6 manages 750.',
    cylinders: 8,
    idle: 5000,
    redline: 18000,
    // This one measured with NOTHING below 250 Hz and a centroid above
    // 5 kHz — the top of the note and none of the bottom. It is a
    // high-revving engine and it should be the brightest of the four,
    // but brightest is not the same as weightless. Ceiling down from
    // 12 kHz, and a quarter- and half-order under it to stand on.
    ceiling: 8200,
    trim: 0.95,
    q: 0.9,
    growl: { ratio: 1, depth: 200 },
    noise: 0.05,
    noiseHz: [1500, 0.1],
    shelf: { hz: 165, gain: 9 },
    partials: [
      { ratio: 0.25, gain: 0.34, type: 'sawtooth', detune: -15 },
      { ratio: 0.5, gain: 0.58, type: 'sawtooth', detune: -5 },
      { ratio: 1, gain: 0.66, type: 'sawtooth', detune: 0 },
      { ratio: 2, gain: 1, type: 'sawtooth', detune: 6 },
      { ratio: 3, gain: 0.6, type: 'sawtooth', detune: -9 },
      { ratio: 4, gain: 0.34, type: 'square', detune: 11 },
      { ratio: 6, gain: 0.16, type: 'sawtooth', detune: -13 },
    ],
  },
  // A cross-plane road-car V8, and the reason it is a separate voice
  // rather than a tweak to the one above is a real difference between
  // the engines, not a preference.
  //
  // A Formula 1 V8 is FLAT-PLANE: each bank fires evenly, 180 degrees
  // apart, and an even pulse train is a clean harmonic series — smooth,
  // and high. A road V8 is CROSS-PLANE: the banks fire unevenly, so
  // each one puts out a lumpy pulse train whose energy lands on half
  // and three-quarter orders that a flat-plane engine simply does not
  // produce. That unevenness IS the burble. It cannot be dialled into
  // the F1 V8 without making that voice a lie about the engine.
  v8road: {
    id: 'v8road',
    name: 'V8 road car',
    note: 'NOT a Formula 1 engine. A cross-plane road V8: the banks fire unevenly, '
      + 'which puts energy on half and three-quarter orders a flat-plane racing V8 '
      + 'never makes — that lumpiness is the burble you are hearing.',
    cylinders: 8,
    idle: 700,
    redline: 7000,
    ceiling: 2600,
    trim: 0.72,
    q: 2.4,
    growl: { ratio: 0.5, depth: 820 },
    noise: 0.12,
    noiseHz: [220, 0.09],
    shelf: { hz: 210, gain: 12 },
    partials: [
      { ratio: 0.25, gain: 0.5, type: 'sawtooth', detune: -21 },
      { ratio: 0.5, gain: 1, type: 'sawtooth', detune: -13 },
      { ratio: 0.75, gain: 0.3, type: 'sawtooth', detune: 15 },
      { ratio: 1, gain: 0.72, type: 'sawtooth', detune: 0 },
      { ratio: 1.5, gain: 0.34, type: 'sawtooth', detune: 9 },
      { ratio: 2, gain: 0.4, type: 'sawtooth', detune: -8 },
      { ratio: 3, gain: 0.14, type: 'square', detune: 12 },
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
    // Six detuned sawtooths can line up in phase, and turning the level
    // up without catching those peaks is how a synthesised engine turns
    // into a buzz. The limiter is what makes the louder trim safe.
    const limiter = ctx.createDynamicsCompressor();
    // -3 dB, not -8: at -8 the limiter was working most of the time and
    // a louder trim would have been compressed straight back down to
    // where it started. It catches peaks now instead of riding the note.
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = voice.q ?? 0.9;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = voice.shelf?.hz ?? 150;
    shelf.gain.value = voice.shelf?.gain ?? 0;
    filter.connect(shelf).connect(master);

    // The chug. An oscillator locked to the firing rate (or half of it)
    // sweeping the cutoff, which is what a static filter over a steady
    // tone cannot do and what made the first W16 sound like a motor
    // rather than an engine. Modulating an audible-rate parameter also
    // throws sidebands, and those are most of the roughness.
    const growlOsc = ctx.createOscillator();
    growlOsc.type = 'sawtooth';
    growlOsc.frequency.value = 120;
    const growlDepth = ctx.createGain();
    growlDepth.gain.value = voice.growl?.depth ?? 0;
    growlOsc.connect(growlDepth).connect(filter.frequency);
    growlOsc.start();

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
    this.nodes = { master, filter, oscillators, noise, band, noiseGain, growlOsc };
  }

  /** Point the whole graph at one operating point.
   *
   *  setTargetAtTime, not setValueAtTime: stepping a frequency once per
   *  animation frame clicks audibly, and a short time constant turns
   *  sixty steps a second into a slide. */
  set(rpm, throttle) {
    if (!this.ctx) return;
    const { master, filter, oscillators, band, growlOsc } = this.nodes;
    const now = this.ctx.currentTime;
    // The sequences are written in Formula 1 revs; a voice that stops at
    // 6 700 gets the same FRACTION of its own sweep.
    const own = voiceRpm(this.voice, rpm);
    const f0 = firingHz(own, this.voice.cylinders);
    for (const { osc, ratio } of oscillators) {
      osc.frequency.setTargetAtTime(Math.max(18, f0 * ratio), now, 0.035);
    }
    filter.frequency.setTargetAtTime(cutoffHz(own, throttle, this.voice), now, 0.05);
    growlOsc.frequency.setTargetAtTime(
      Math.max(8, f0 * (this.voice.growl?.ratio ?? 1)), now, 0.035,
    );
    const [base, slope] = this.voice.noiseHz;
    band.frequency.setTargetAtTime(base + own * slope, now, 0.06);
    master.gain.setTargetAtTime(
      engineGain(own, throttle, this.voice) * this.voice.trim, now, 0.05,
    );
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
