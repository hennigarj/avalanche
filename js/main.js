// main.js — wiring. Connects the clock, the kit data, audio, and the grid.

import { Clock } from './clock.js';
import { ctx, unlock, loadSample, forgetSample, playSample, audition, playClick } from './audio.js';
import { createKit, toggleStep, STEPS } from './pattern.js';
import { createGrid } from './ui.js';

const kit = createKit();
const clock = new Clock(ctx);
clock.totalSteps = STEPS;

let metronomeOn = false;

// --- The one place sequenced audio is scheduled.
// The clock calls this slightly ahead of time with the exact moment the
// step should sound. Every hit is booked at that `time` — never "now".
// It reads the kit fresh on every step, so edits are heard on the next
// pass without stopping.
clock.onStep = (step, time) => {
  for (let pad = 0; pad < kit.tracks.length; pad++) {
    const track = kit.tracks[pad];
    if (track.sampleId && track.steps[step]) {
      playSample(pad, track.sampleId, time);
    }
  }
  if (metronomeOn) playClick(step, time);
};

// --- The grid
const grid = createGrid(document.getElementById('grid'), kit, {
  onToggle(pad, step) {
    return toggleStep(kit.tracks[pad], step);
  },

  onAudition(pad) {
    const track = kit.tracks[pad];
    if (track.sampleId) audition(pad, track.sampleId);
  },

  async onLoad(pad, file) {
    const track = kit.tracks[pad];
    grid.setPadBusy(pad, true);
    try {
      const id = await loadSample(file);
      const old = track.sampleId;
      track.sampleId = id;
      track.name = file.name.replace(/\.[^.]+$/, '');   // drop the extension
      if (old) forgetSample(old);
      grid.setPadName(pad, track.name, true);
    } catch (err) {
      // Usually a format Safari can't decode. Leave the old sample in place.
      console.error('Could not load', file.name, err);
      grid.setPadName(pad, "can't read file", !!track.sampleId);
      setTimeout(() => grid.setPadName(pad, track.name, !!track.sampleId), 2000);
    } finally {
      grid.setPadBusy(pad, false);
    }
  },
});

// A pad can be auditioned before Start is ever pressed, so any touch
// anywhere counts as the gesture that wakes audio up. Finger-up is used
// because iOS treats it as a real gesture; finger-down doesn't always count.
document.addEventListener('pointerup', unlock);
document.addEventListener('touchend', unlock);

// --- Visuals run on their own loop, reading the clock's queue.
// Never drive visuals from the audio scheduler directly — audio is
// booked in the future, the screen should update in the present.
function frame() {
  const s = clock.stepForDisplay();
  if (s !== null) grid.setPlayhead(s);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Transport
const toggle = document.getElementById('toggle');
let startedAt = 0;

function stopTransport() {
  clock.stop();
  toggle.textContent = 'Start';
  toggle.classList.remove('running');
  grid.clearPlayhead();
}

toggle.addEventListener('click', async () => {
  // iOS gotcha #1: resume must happen inside a real user gesture.
  await unlock();

  if (clock.isRunning) {
    stopTransport();
  } else {
    clock.start();
    startedAt = performance.now();
    toggle.textContent = 'Stop';
    toggle.classList.add('running');
  }
});

const metro = document.getElementById('metro');
metro.addEventListener('click', () => {
  metronomeOn = !metronomeOn;
  metro.classList.toggle('active', metronomeOn);
  metro.textContent = metronomeOn ? 'Click on' : 'Click off';
});

document.getElementById('bpm').addEventListener('input', (e) => {
  clock.bpm = +e.target.value;
  document.getElementById('bpmLabel').textContent = e.target.value;
});

// iOS gotcha #3: audio suspends when you lock or switch apps.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // iOS throttles timers in the background. Stop cleanly instead of
    // letting the scheduler fall behind and burst on return.
    if (clock.isRunning) stopTransport();
  } else {
    ctx.resume();
  }
});

// --- Diagnostics
// This timer only updates text on screen. It never triggers sound.
const dState = document.getElementById('dState');
const dMargin = document.getElementById('dMargin');
const dTime = document.getElementById('dTime');

setInterval(() => {
  dState.textContent = ctx.state;
  if (clock.isRunning) {
    const m = clock.worstMargin;
    dMargin.textContent = (m * 1000).toFixed(1) + ' ms';
    dMargin.classList.toggle('bad', m < 0);
    dTime.textContent = ((performance.now() - startedAt) / 1000).toFixed(0) + ' s';
  }
}, 250);
