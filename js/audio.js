// audio.js — the AudioContext, sample decoding, and playback.
//
// Every sound in the app is started here, and always at an explicit time.
// Sequenced hits get their time from the transport; auditions pass "now".

export const ctx = new AudioContext();

// iOS gotcha #2: the ringer switch can silence Web Audio.
// Asking for 'playback' tells iOS this is music, not a UI beep,
// so the mute switch is ignored.
if (navigator.audioSession) {
  try { navigator.audioSession.type = 'playback'; } catch (e) {}
}

// Headroom so eight drums hitting at once don't distort.
const master = ctx.createGain();
master.gain.value = 0.5;
master.connect(ctx.destination);

// One GainNode per drum (keyed by drum id), created the first time that
// drum makes a sound. It's the drum's own channel: volume now, and the
// place the filter and envelope will slot in at milestone 4.
const buses = new Map();
function busFor(key) {
  let bus = buses.get(key);
  if (!bus) {
    bus = ctx.createGain();
    bus.gain.value = 0.8;
    bus.connect(master);
    buses.set(key, bus);
  }
  return bus;
}

// iOS gotcha #1: the context starts suspended and can only be resumed
// from inside a real user gesture. Call this from touch handlers.
export function unlock() {
  if (ctx.state !== 'running') return ctx.resume();
}

// --- Sample cache
// Samples are decoded once — when loaded from Files, or restored from
// storage at startup. After that, playback just reuses the decoded
// AudioBuffer; decoding is far too slow to do per hit.
//
// Buffers stay for the whole session, even after a drum's sample is
// replaced, because undo can bring the old one back.
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

// --- Playback
// `time` must be a ctx.currentTime value. For sequenced hits it comes from
// the clock's time map, slightly in the future.
export function playSample(busKey, sampleId, time) {
  const buffer = buffers.get(sampleId);
  if (!buffer) return;

  // Source nodes are single-use by design: make one per hit and let it go.
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(busFor(busKey));
  src.onended = () => src.disconnect();
  src.start(time);
}

// Tap-to-hear. The only sound started by a touch rather than the clock.
export function audition(busKey, sampleId) {
  playSample(busKey, sampleId, ctx.currentTime);
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
