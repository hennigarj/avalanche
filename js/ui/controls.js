// ui/controls.js — the instrument controls under the grid. TEMPORARY:
// placeholders until the rulers, context knobs and gold knobs arrive in
// milestone 7. Plain buttons and sliders; no panels, no modes.
//
//   ▼ ▲             scroll pitch rows (with SHIFT: an octave)
//   SCALE           tap: scale mode ↔ chromatic
//                   SHIFT + SCALE: next mode (notes follow)
//                   hold SCALE + tap an audition pad: set the key's root
//   MODE            the sample's mode: once → cut → loop
//   OCT / SEMI      transpose (becomes E3 at milestone 7)
//   sliders         attack, release, cutoff, resonance
//   sample root     the pitch the sample was recorded at (out of the way,
//                   at the bottom — you should rarely need it)
//
// Only shown while an instrument track is on screen. Every change goes
// through the model, so it's undoable and saved like any other edit.

import * as model from '../model.js';
import { keyName, pitchName } from '../scale.js';

// Each slider runs 0–1000 and maps onto a voice setting. `from` turns the
// slider's position (0–1) into the stored value; `to` goes back again.
// Squared and exponential curves give fine control where the ear needs it:
// short times, low frequencies.
const KNOBS = [
  {
    param: 'attack',
    from: (x) => round(2 * x * x, 3),          // 0–2 s
    to: (v) => Math.sqrt(v / 2),
    show: seconds,
  },
  {
    param: 'release',
    from: (x) => round(3 * x * x, 3),          // 0–3 s
    to: (v) => Math.sqrt(v / 3),
    show: seconds,
  },
  {
    param: 'cutoff',
    from: (x) => Math.round(30 * Math.pow(20000 / 30, x)),   // 30 Hz – open
    to: (v) => Math.log(v / 30) / Math.log(20000 / 30),
    show: (hz) => (hz >= 20000 ? 'open' : hz >= 1000 ? (hz / 1000).toFixed(1) + ' kHz' : hz + ' Hz'),
  },
  {
    param: 'resonance',
    from: (x) => round(x, 2),                   // 0–100%
    to: (v) => v,
    show: (v) => Math.round(v * 100) + '%',
  },
];

function round(v, places) {
  const f = Math.pow(10, places);
  return Math.round(v * f) / f;
}

function seconds(s) {
  return s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
}

// view: the clip view (which track is on screen, scrolling)
// mods: { shift, scale, scaleUsed } — shared with the clip view
export function createControls({ view, mods }) {
  const $ = (id) => document.getElementById(id);
  const box = $('instControls');
  const rootBox = $('sampleRoot');

  function instrument() {
    const track = view.currentTrack();
    return track.type === 'instrument' ? track : null;
  }

  // Buttons act on touch-down, like SHIFT and BACK: a second finger's tap
  // while another is on the grid may never become a click on iOS.
  function onPress(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      el.classList.add('pressed');
      const up = (u) => {
        if (u.pointerId !== e.pointerId) return;
        el.classList.remove('pressed');
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      fn(e);
    });
  }

  // --- Scrolling
  onPress($('rowsUp'), () => view.scroll(1, mods.shift));
  onPress($('rowsDown'), () => view.scroll(-1, mods.shift));

  // --- SCALE
  // Acts on release, and only if the hold wasn't used: holding SCALE and
  // tapping an audition pad sets the root instead of toggling.
  const scaleBtn = $('scale');
  let scalePointer = null;

  scaleBtn.addEventListener('pointerdown', (e) => {
    scalePointer = e.pointerId;
    mods.scale = true;
    mods.scaleUsed = false;
    scaleBtn.classList.add('held');
    if (mods.shift) {
      mods.scaleUsed = true;
      model.cycleMode();
    }
  });
  function releaseScale(e) {
    if (e.pointerId !== scalePointer) return;
    scalePointer = null;
    mods.scale = false;
    scaleBtn.classList.remove('held');
    if (!mods.scaleUsed && e.type === 'pointerup') model.toggleScale();
  }
  window.addEventListener('pointerup', releaseScale);
  window.addEventListener('pointercancel', releaseScale);

  // --- Sample mode
  onPress($('mode'), () => {
    const track = instrument();
    if (track) model.cycleVoiceMode(track.id);
  });

  // --- Transpose
  // The view doesn't scroll along: rows are pitches, so the notes are
  // seen to move. (If it followed, undo would bring the notes back but
  // leave the view where the transpose had taken it.)
  function transpose(semitones) {
    const track = instrument();
    if (track) model.transpose(track.id, track.activeClipId, semitones);
  }
  onPress($('octDown'), () => transpose(-12));
  onPress($('octUp'), () => transpose(12));
  onPress($('semiDown'), () => transpose(-1));
  onPress($('semiUp'), () => transpose(1));

  // --- Sliders. A whole drag is one undo step.
  for (const knob of KNOBS) {
    const input = $(knob.param);
    knob.input = input;
    knob.readout = $(knob.param + 'Val');
    input.addEventListener('input', () => {
      const track = instrument();
      if (track) model.setVoice(track.id, knob.param, knob.from(+input.value / 1000));
    });
    input.addEventListener('change', () => model.endGesture());
  }

  // --- Sample root (SHIFT: an octave)
  function nudgeRoot(direction) {
    const track = instrument();
    if (track) model.setSampleRoot(track.id, track.rootNote + direction * (mods.shift ? 12 : 1));
  }
  onPress($('rootDown'), () => nudgeRoot(-1));
  onPress($('rootUp'), () => nudgeRoot(1));

  // Make every control show the song as it is now (after an edit, an
  // undo, or switching track).
  function refresh() {
    const track = instrument();
    box.hidden = !track;
    rootBox.hidden = !track;
    if (!track) return;

    const scale = model.getSong().scale;
    $('keyName').textContent = keyName(scale) + (scale.enabled ? '' : ' · chromatic');
    scaleBtn.classList.toggle('on', scale.enabled);
    $('mode').textContent = 'Mode ' + track.voice.mode;
    $('rootName').textContent = pitchName(track.rootNote);

    for (const knob of KNOBS) {
      const value = track.voice[knob.param];
      // Leave a slider alone if it already says this value — it's the one
      // being dragged, and nudging it would make it jitter.
      if (knob.from(+knob.input.value / 1000) !== value) {
        knob.input.value = Math.round(knob.to(value) * 1000);
      }
      knob.readout.textContent = knob.show(value);
    }
  }

  return { refresh };
}
