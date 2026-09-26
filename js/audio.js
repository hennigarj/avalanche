// audio.js — the AudioContext, sample decoding, and the metronome.
//
// Every sound in the app is started at an explicit time. Notes are played
// by voice.js; this file owns what they're played through (the context
// and the master output) and what they're played from (decoded samples).

export const ctx = new AudioContext();

// iOS gotcha #2: the ringer switch can silence Web Audio.
// Asking for 'playback' tells iOS this is music, not a UI beep,
// so the mute switch is ignored.
if (navigator.audioSession) {
  try { navigator.audioSession.type = 'playback'; } catch (e) {}
}

// Everything ends up here. Headroom so several tracks hitting at once
// don't distort.
export const master = ctx.createGain();
master.gain.value = 0.5;

// A safety net after the master: a soft clipper. Below 80% of full volume
// it changes nothing at all. Above that, peaks are rounded off smoothly
// and can never pass full volume — so a big chord on top of a kick
// saturates a little instead of crackling.
//
// Why not a limiter (DynamicsCompressorNode)? It delays all sound by
// ~6 ms, keyboard pads included, and adds a "makeup" boost of its own, so
// it would change the sound even when nothing is too loud.
const CLIP_KNEE = 0.8;    // where rounding off begins
const CLIP_RANGE = 4;     // the loudest input it's shaped for

// The clipper's shape, as a table from input level to output level. A
// WaveShaperNode reads its table for inputs from -1 to 1, so the signal is
// scaled down by CLIP_RANGE on the way in and the table is stretched to
// match: entry x stands for an input of x × CLIP_RANGE.
export function softClipCurve(points = 8193) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const s = ((i / (points - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(s);
    // Straight up to the knee, then bending towards 1 (tanh leaves at the
    // same slope, so there's no corner to hear).
    const out = a <= CLIP_KNEE
      ? a
      : CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((a - CLIP_KNEE) / (1 - CLIP_KNEE));
    curve[i] = Math.sign(s) * out;
  }
  return curve;
}

const clipIn = ctx.createGain();
clipIn.gain.value = 1 / CLIP_RANGE;
const clipper = ctx.createWaveShaper();
clipper.curve = softClipCurve();
master.connect(clipIn);
clipIn.connect(clipper);
clipper.connect(ctx.destination);

// iOS gotcha #1: the context starts suspended and can only be resumed
// from inside a real user gesture. Call this from touch handlers.
export function unlock() {
  if (ctx.state !== 'running') return ctx.resume();
}

// --- Sample cache
// Samples are decoded once — when loaded from Files, or restored from
// storage at startup. After that, playback just reuses the decoded
// AudioBuffer; decoding is far too slow to do per note.
//
// Buffers stay for the whole session, even after a sample is replaced,
// because undo can bring the old one back.
const buffers = new Map();

// Decode raw file bytes and cache the result under `id`. Throws if Safari
// can't read the format. Decoding empties (detaches) `bytes`, so pass a
// copy if the original is still needed.
export async function decodeSample(id, bytes) {
  const buffer = await ctx.decodeAudioData(bytes);
  buffers.set(id, buffer);
}

export function hasSample(id) {
  return buffers.has(id);
}

// The decoded sample, or undefined if it isn't ready.
export function getBuffer(id) {
  return buffers.get(id);
}

// --- Metronome
// A short blip, pitched so you can hear the bar without looking.
// accent: 2 = first beat of the bar (high), 1 = a beat (middle),
// 0 = the 16ths in between (low).
export function playClick(accent, time) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.frequency.value = accent === 2 ? 1600 : (accent === 1 ? 1000 : 700);

  env.gain.setValueAtTime(accent > 0 ? 0.9 : 0.35, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

  osc.connect(env);
  env.connect(master);
  osc.start(time);
  osc.stop(time + 0.05);
}
