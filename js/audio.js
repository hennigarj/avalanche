// audio.js — the AudioContext, sample loading, and playback.
//
// Every sound in the app is started here, and always at an explicit time.
// Sequenced hits get their time from the clock; auditions pass "now".

export const ctx = new AudioContext();

// iOS gotcha #2: the ringer switch can silence Web Audio.
// Asking for 'playback' tells iOS this is music, not a UI beep,
// so the mute switch is ignored.
if (navigator.audioSession) {
  try { navigator.audioSession.type = 'playback'; } catch (e) {}
}

// Headroom so eight pads hitting at once don't distort.
const master = ctx.createGain();
master.gain.value = 0.5;
master.connect(ctx.destination);

// One GainNode per pad, created the first time a pad makes a sound.
// It's the pad's own channel: volume now, and the place the filter and
// envelope will slot in at milestone 4.
const padBuses = [];
function busFor(pad) {
  if (!padBuses[pad]) {
    const g = ctx.createGain();
    g.gain.value = 0.8;
    g.connect(master);
    padBuses[pad] = g;
  }
  return padBuses[pad];
}

// iOS gotcha #1: the context starts suspended and can only be resumed
// from inside a real user gesture. Call this from touch handlers.
export function unlock() {
  if (ctx.state !== 'running') return ctx.resume();
}

// --- Sample cache
// Files are decoded once, when loaded. After that, playback just reuses
// the decoded AudioBuffer — decoding is far too slow to do per hit.
const buffers = new Map();
let nextId = 1;

// Read a File from the picker, decode it, cache it. Returns its id.
export async function loadSample(file) {
  const data = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(data);
  const id = 'sample-' + nextId++;
  buffers.set(id, buffer);
  return id;
}

// Drop a buffer nobody uses any more. Hits already booked keep their
// own reference to it, so this is safe to call mid-playback.
export function forgetSample(id) {
  buffers.delete(id);
}

// --- Playback
// `time` must be a ctx.currentTime value. For sequenced hits it comes
// straight from clock.onStep, slightly in the future.
export function playSample(pad, sampleId, time) {
  const buffer = buffers.get(sampleId);
  if (!buffer) return;

  // Source nodes are single-use by design: make one per hit and let it go.
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(busFor(pad));
  src.onended = () => src.disconnect();
  src.start(time);
}

// Tap-to-hear. The only sound started by a touch rather than the clock.
export function audition(pad, sampleId) {
  playSample(pad, sampleId, ctx.currentTime);
}

// --- Metronome
// A short blip, pitched so you can hear the bar without looking:
// high on the downbeat, middle on beats, low on off-beats.
export function playClick(step, time) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.frequency.value = step === 0 ? 1600 : (step % 4 === 0 ? 1000 : 700);

  env.gain.setValueAtTime(step % 4 === 0 ? 0.9 : 0.35, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

  osc.connect(env);
  env.connect(master);
  osc.start(time);
  osc.stop(time + 0.05);
}
