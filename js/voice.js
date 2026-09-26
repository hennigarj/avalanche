// voice.js — playing one note of a sample: pitch, envelope, filter.
//
// Each note gets its own little chain of audio nodes, made when it starts
// and thrown away when it ends:
//
//   sample ─→ envelope ─→ gate ─→ channel (filter → volume → pan) ─→ master
//
// - sample:   an AudioBufferSourceNode. Its playbackRate sets the pitch.
// - envelope: a gain shaped once, when the note starts: up over the
//             attack, down to sustain over the decay, then holds.
// - gate:     a gain that stays at full until the note ends, then fades to
//             silence over the release.
//
// Why two gains instead of one: ending a note never has to undo the
// envelope. The gate simply scales whatever the envelope is doing, so a
// note released halfway through its attack fades from wherever it has
// got to. No jumps, so no clicks.
//
// The channel is shared by every note of one track (a kit has one per
// drum). Its filter and volume follow the song the moment they change,
// even for notes already ringing. With no filter envelope, one filter on
// the whole track sounds exactly like one per note, and costs far less.
//
// Nothing in here decides *when* a note plays. Notes are started and
// released at times handed in: by the transport (from the clock) for
// sequenced notes, or "now" for pads being played by hand.

import { ctx, master, getBuffer } from './audio.js';

// Notes one instrument track can sound at once. The 9th steals the oldest.
export const MAX_VOICES = 8;

// The shortest fade used anywhere. Stopping a sample while it's audible
// clicks; fading it over a few milliseconds doesn't, and is too quick to
// hear as a fade. A release of 0 means this.
const MIN_FADE = 0.005;

// A voice's cutoff at or above this means "filter fully open".
const OPEN_CUTOFF = 20000;

// Resonance 0–1 becomes the filter's Q. Web Audio's lowpass Q is in
// decibels: 0 is a smooth corner, 18 a strong, singing peak.
const MAX_RESONANCE_DB = 18;

// How quickly the channel follows a control (seconds). Just enough to
// stop a fast slider drag from crackling.
const GLIDE = 0.015;

// Pitch as speed. Every 12 semitones above the sample's root doubles the
// speed (an octave up, half as long); 12 below halves it.
export function pitchRate(pitch, rootNote) {
  return Math.pow(2, (pitch - rootNote) / 12);
}

// --- Channels: one per instrument track, one per drum.

const channels = new Map();

function channelFor(key) {
  let ch = channels.get(key);
  if (ch) return ch;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  // Fully open. At exactly half the sample rate the lowpass lets
  // everything through untouched.
  filter.frequency.value = ctx.sampleRate / 2;
  filter.Q.value = 0;

  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  filter.connect(gain);

  let pan = null;
  if (ctx.createStereoPanner) {
    pan = ctx.createStereoPanner();
    gain.connect(pan);
    pan.connect(master);
  } else {
    gain.connect(master);
  }

  ch = { input: filter, filter, gain, pan, applied: {} };
  channels.set(key, ch);
  return ch;
}

// Make one channel match a voice's settings. Only touches what changed.
function applyVoice(key, voice) {
  const ch = channelFor(key);
  const cutoff = voice.cutoff >= OPEN_CUTOFF ? ctx.sampleRate / 2 : voice.cutoff;
  set(ch, 'volume', ch.gain.gain, voice.volume);
  set(ch, 'cutoff', ch.filter.frequency, Math.min(cutoff, ctx.sampleRate / 2));
  set(ch, 'resonance', ch.filter.Q, voice.resonance * MAX_RESONANCE_DB);
  if (ch.pan) set(ch, 'pan', ch.pan.pan, voice.pan);
}

function set(ch, name, param, value) {
  if (typeof value !== 'number' || !isFinite(value)) return;
  if (ch.applied[name] === value) return;
  const first = !(name in ch.applied);
  ch.applied[name] = value;
  if (first) {
    param.value = value;
  } else {
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, GLIDE);
  }
}

// Bring every channel in line with the song. Called after every edit,
// undo and load, so the knobs are heard straight away.
export function syncChannels(song) {
  for (const track of song.tracks) {
    if (track.type === 'instrument' && track.voice) applyVoice(track.id, track.voice);
    if (track.type === 'kit') {
      for (const drum of track.drums) {
        if (drum.voice) applyVoice(drum.id, drum.voice);
      }
    }
  }
}

// --- Voices

// Every note still making sound, grouped by track, oldest first.
const groups = new Map();

// Start a note. Returns the voice (so it can be released later), or null
// if the sample isn't loaded.
//   group    which polyphony pool it counts against (the track id)
//   channel  which channel it plays through (track id, or drum id)
//   time     when it starts, in ctx.currentTime seconds
//   rate     playback speed; sets the pitch
//   voice    the sound settings from the song
//   cap      how many notes the group may sound at once
export function startVoice({ group, channel, sampleId, time, rate = 1, voice, cap = MAX_VOICES }) {
  const buffer = getBuffer(sampleId);
  if (!buffer) return null;

  const mode = voice.mode || 'once';
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const offset = Math.min(Math.max(voice.start || 0, 0), 0.999) * buffer.duration;
  if (mode === 'loop') {
    src.loop = true;
    src.loopStart = offset;
    src.loopEnd = buffer.duration;
  }

  const env = ctx.createGain();
  const gate = ctx.createGain();
  shapeEnvelope(env.gain, time, voice);
  src.connect(env);
  env.connect(gate);
  gate.connect(channelFor(channel).input);

  const v = {
    src,
    gate,
    group,
    start: time,
    release: Math.max(MIN_FADE, voice.release || 0),
    // ONCE samples ignore note length and play to their end. CUT and
    // LOOP samples wait for a release.
    sustains: mode !== 'once',
    releaseAt: null,   // when its release was booked to begin, if it has been
    done: false,
  };

  // Make room first, so the new note is never the one stolen.
  steal(group, time, cap);
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(v);

  src.onended = () => {
    v.done = true;
    src.disconnect();
    env.disconnect();
    gate.disconnect();
    const list = groups.get(group);
    if (list) {
      const i = list.indexOf(v);
      if (i !== -1) list.splice(i, 1);
    }
  };
  src.start(time, offset);
  return v;
}

// Attack from silence to full, decay to the sustain level, then hold.
// Every step is a ramp: a jump in level is a click.
function shapeEnvelope(param, time, voice) {
  const attack = Math.max(0, voice.attack || 0);
  const decay = Math.max(MIN_FADE, voice.decay || 0);
  const sustain = Math.min(1, Math.max(0, voice.sustain === undefined ? 1 : voice.sustain));

  if (attack > 0) {
    param.setValueAtTime(0, time);
    param.linearRampToValueAtTime(1, time + attack);
  } else {
    param.setValueAtTime(1, time);
  }
  if (sustain < 1) param.linearRampToValueAtTime(sustain, time + attack + decay);
}

// End a note: fade the gate to silence over `fade` seconds starting at
// `time`, then stop the sample once it's silent. Safe to call on a voice
// that has already ended or is already fading.
export function releaseVoice(v, time, fade) {
  if (!v || v.done) return;
  // Already fading by then: leave it to finish.
  if (v.releaseAt !== null && v.releaseAt <= time) return;
  if (fade === undefined) fade = v.release;

  const g = v.gate.gain;
  // A release already booked for later is moved earlier. Nothing is
  // booked on the gate before it, so clearing it leaves the gate at full
  // right up to `time`.
  if (v.releaseAt !== null) g.cancelScheduledValues(time);
  g.setValueAtTime(1, time);
  g.linearRampToValueAtTime(0, time + fade);
  v.releaseAt = time;
  try {
    v.src.stop(time + fade + 0.01);
  } catch (e) {
    // Some browsers refuse a second stop(). The gate has already
    // silenced it, so the sample simply runs on unheard until its end.
  }
}

// Before a note starts at `time`, fade out the oldest notes in its group
// until there's room for it. Notes already in their release don't count:
// they're on their way out.
function steal(group, time, cap) {
  const list = groups.get(group);
  if (!list || cap === Infinity) return;
  const sounding = list
    .filter((v) => !v.done && v.start <= time && (v.releaseAt === null || v.releaseAt > time))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i <= sounding.length - cap; i++) {
    releaseVoice(sounding[i], time, MIN_FADE);
  }
}

// Stop pressed: release every held note (with its own release), and
// silence anything booked that hasn't started yet. ONCE samples already
// playing are left to finish, as they would on a drum machine.
export function releaseAll(time) {
  for (const list of groups.values()) {
    for (const v of list) {
      if (v.start > time) releaseVoice(v, time, MIN_FADE);
      else if (v.sustains) releaseVoice(v, time);
    }
  }
}

// --- Notes, from the song

// Play one note of a track: a drum (rowKey = drum id) or a pitch
// (rowKey = MIDI pitch). Returns the voice, or null if there's nothing
// loaded to play.
export function playNote(track, rowKey, time) {
  if (track.type === 'kit') {
    const drum = track.drums.find((d) => d.id === rowKey);
    if (!drum || !drum.sampleId) return null;
    // Kit hits overlap freely, as they always have: no cap.
    return startVoice({
      group: track.id, channel: drum.id, sampleId: drum.sampleId,
      time, voice: drum.voice, cap: Infinity,
    });
  }
  if (track.type === 'instrument') {
    if (!track.sampleId) return null;
    return startVoice({
      group: track.id, channel: track.id, sampleId: track.sampleId,
      time, rate: pitchRate(rowKey, track.rootNote), voice: track.voice,
    });
  }
  return null;
}
