// main.js — wiring. Connects the song, storage, the clock and transport,
// audio, and the clip view. Also owns the buttons around the grid and the
// startup sequence (restore the saved song and its samples).

import { ctx, unlock, decodeSample, hasSample, audition } from './audio.js';
import { Clock } from './clock.js';
import { Transport } from './transport.js';
import * as model from './model.js';
import { STEP_TICKS } from './model.js';
import * as store from './store.js';
import { createClipView } from './views/clip.js';

const clock = new Clock(ctx);
const transport = new Transport(clock);

// --- Loading a sample from Files
// Decode it first (so a file that isn't audio is refused before anything
// is saved), then keep its original bytes in storage. Returns the new
// sample's id.
async function importSample(file) {
  const bytes = await file.arrayBuffer();
  const id = model.newId('sample');
  // Decoding empties the buffer it's given, so decode a copy and keep the
  // original bytes for storage.
  await decodeSample(id, bytes.slice(0));
  try {
    await store.putSample({ id, name: file.name, type: file.type, bytes });
  } catch (err) {
    // Still playable this session; it just won't survive a restart.
    console.error('Could not store sample', file.name, err);
  }
  return id;
}

// --- The clip view
const view = createClipView(document.getElementById('grid'), {
  transport,
  audition,
  importSample,
  hasSample,
});

// --- After every change to the song: an edit, undo, redo, or a load.
model.onChange((reason) => {
  clock.setBpm(model.getSong().bpm);   // re-anchors cleanly if playing
  refreshControls();
  view.render();                       // show the change now, not next frame
  // A song just read from storage doesn't need writing straight back.
  if (reason !== 'load') store.saveSoon();
});
store.autosave(model.getSong);

// A row can be auditioned before Start is ever pressed, so any touch
// anywhere counts as the gesture that wakes audio up. Finger-up is used
// because iOS treats it as a real gesture; finger-down doesn't always count.
document.addEventListener('pointerup', unlock);
document.addEventListener('touchend', unlock);

// --- Visuals run on their own loop, reading the clock's time map.
// Never drive visuals from the audio scheduler — audio is booked in the
// future, the screen should show the present.
function frame() {
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Transport
const toggle = document.getElementById('toggle');
let startedAt = 0;

function stopTransport() {
  transport.stop();
  toggle.textContent = 'Start';
  toggle.classList.remove('running');
}

toggle.addEventListener('click', async () => {
  // iOS gotcha #1: resume must happen inside a real user gesture.
  await unlock();

  if (transport.isRunning) {
    stopTransport();
  } else {
    transport.start();
    startedAt = performance.now();
    toggle.textContent = 'Stop';
    toggle.classList.add('running');
  }
});

const metro = document.getElementById('metro');
metro.addEventListener('click', () => {
  transport.metronome = !transport.metronome;
  metro.classList.toggle('active', transport.metronome);
  metro.textContent = transport.metronome ? 'Click on' : 'Click off';
});

// --- Tempo
// The slider edits the song; the clock follows the song (see onChange).
// A whole drag is one undo step: lifting the finger ends it.
const bpmInput = document.getElementById('bpm');
const bpmLabel = document.getElementById('bpmLabel');

bpmInput.addEventListener('input', () => model.setBpm(+bpmInput.value));
bpmInput.addEventListener('change', () => model.endGesture());

function showTempo(bpm) {
  bpmLabel.textContent = bpm;
  if (+bpmInput.value !== bpm) bpmInput.value = bpm;
}

// --- SHIFT and BACK
// SHIFT is held, like on the Deluge: it's on only while a finger is on it.
// BACK undoes; SHIFT + BACK redoes. Both act on touch-down.
const shiftBtn = document.getElementById('shift');
const backBtn = document.getElementById('back');
let shiftHeld = false;

shiftBtn.addEventListener('pointerdown', () => {
  shiftHeld = true;
  shiftBtn.classList.add('held');
});
function releaseShift() {
  shiftHeld = false;
  shiftBtn.classList.remove('held');
}
// A touch stays attached to the element it started on, so the finger
// lifting arrives here even if it slid off the button.
shiftBtn.addEventListener('pointerup', releaseShift);
shiftBtn.addEventListener('pointercancel', releaseShift);

backBtn.addEventListener('pointerdown', () => {
  backBtn.classList.add('pressed');
  if (shiftHeld) model.redo();
  else model.undo();
});
function releaseBack() {
  backBtn.classList.remove('pressed');
}
backBtn.addEventListener('pointerup', releaseBack);
backBtn.addEventListener('pointercancel', releaseBack);

// ─── TEMPORARY ─────────────────────────────────────────────────────────
// Polymeter check for milestone 3. Toggles the third row between the
// clip's 16 steps and 12, so it can be heard cycling against the others
// (they line up again every 3 bars). It's a normal edit: undoable, saved.
// Remove at milestone 7, when holding a row's audition pad and dragging
// the time ruler sets row length for real.
const DEBUG_ROW = 2;          // third row from the top
const DEBUG_STEPS = 12;
const debugBtn = document.getElementById('debugRow');

debugBtn.addEventListener('click', () => {
  const { track, clip } = model.currentKitClip();
  const drum = track.drums[DEBUG_ROW];
  const isShort = model.rowLengthTicks(clip, drum.id) !== clip.lengthTicks;
  model.setRowLength(track.id, clip.id, drum.id, isShort ? null : DEBUG_STEPS * STEP_TICKS);
});

function showDebugRow() {
  const { track, clip } = model.currentKitClip();
  const steps = model.rowLengthTicks(clip, track.drums[DEBUG_ROW].id) / STEP_TICKS;
  const clipSteps = clip.lengthTicks / STEP_TICKS;
  const other = steps === clipSteps ? DEBUG_STEPS : clipSteps;
  debugBtn.textContent = `Temp debug · row 3 is ${steps} steps · tap for ${other}`;
  debugBtn.classList.toggle('active', steps !== clipSteps);
}
// ─── end TEMPORARY ─────────────────────────────────────────────────────

// Keep the controls around the grid in step with the song (undo can
// change tempo, for instance).
function refreshControls() {
  showTempo(model.getSong().bpm);
  showDebugRow();
}

// --- Backgrounding
// iOS gotcha #3: audio suspends when you lock or switch apps.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // iOS throttles timers in the background. Stop cleanly instead of
    // letting the scheduler fall behind and burst on return.
    if (transport.isRunning) stopTransport();
    // Save now: this may be the last moment before iOS kills the app
    // (a force-quit from the app switcher starts with this event).
    store.flush();
  } else {
    ctx.resume();
  }
});
window.addEventListener('pagehide', () => store.flush());

// --- Startup: bring back the saved song and its samples.
let storageState = 'opening…';
let persistState = '';

async function boot() {
  store.requestPersistence().then((granted) => {
    persistState = granted === true ? 'persistent' : (granted === false ? 'not persistent' : '');
  });

  try {
    await store.open();
  } catch (err) {
    console.error('Storage unavailable', err);
    storageState = 'unavailable — not saving';
    return;
  }
  storageState = 'ok';

  // Saved songs, newest first. One that can't be read is left untouched
  // in storage — never overwritten — and we start a fresh song instead.
  let saved = [];
  try {
    const records = await store.loadSongs();
    saved = records.map((r) => {
      try { return JSON.parse(r.json); } catch (err) { return null; }
    });
  } catch (err) {
    console.error('Could not read saved songs', err);
    return;
  }
  if (saved.length && !model.load(saved[0])) {
    console.warn('The newest saved song could not be used; starting a fresh one.');
  }

  await restoreSamples();
  await cleanUpSamples(saved);
}

// Decode every sample the song uses. Rows dim until theirs is ready.
async function restoreSamples() {
  const ids = [...model.sampleIdsIn(model.getSong())];
  for (const id of ids) view.setBusy(id, true);
  await Promise.all(ids.map(async (id) => {
    try {
      const record = await store.getSample(id);
      if (record) await decodeSample(id, record.bytes);
      else console.warn('Sample missing from storage:', id);
    } catch (err) {
      console.error('Could not restore sample', id, err);
    } finally {
      view.setBusy(id, false);
    }
  }));
}

// Delete stored samples that no song uses any more — ones that were
// replaced, and kept until now only in case of undo. Undo history doesn't
// survive a restart, so at startup nothing can bring them back. If any
// saved song couldn't be read we can't know what it uses, so we delete
// nothing.
async function cleanUpSamples(savedSongs) {
  if (savedSongs.some((s) => s === null)) return;
  const keep = model.sampleIdsIn(model.getSong());
  for (const s of savedSongs) {
    for (const id of model.sampleIdsIn(s)) keep.add(id);
  }
  try {
    const unused = (await store.sampleIds()).filter((id) => !keep.has(id));
    if (unused.length) await store.deleteSamples(unused);
  } catch (err) {
    console.error('Sample clean-up failed', err);
  }
}

refreshControls();
view.render();
boot();

// --- Diagnostics
// This timer only updates text on screen. It never triggers sound.
const dState = document.getElementById('dState');
const dMargin = document.getElementById('dMargin');
const dTime = document.getElementById('dTime');
const dStorage = document.getElementById('dStorage');
const dSaved = document.getElementById('dSaved');

store.onStatus(({ savedAt, error }) => {
  dSaved.textContent = error ? 'failed' : new Date(savedAt).toLocaleTimeString();
  dSaved.classList.toggle('bad', !!error);
});

setInterval(() => {
  dState.textContent = ctx.state;
  dStorage.textContent = persistState ? storageState + ' · ' + persistState : storageState;
  dStorage.classList.toggle('bad', storageState.startsWith('unavailable'));
  if (transport.isRunning) {
    const m = clock.worstMargin;
    dMargin.textContent = (m * 1000).toFixed(1) + ' ms';
    dMargin.classList.toggle('bad', m < 0);
    dTime.textContent = ((performance.now() - startedAt) / 1000).toFixed(0) + ' s';
  }
}, 250);
