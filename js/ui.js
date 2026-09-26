// ui.js — the grid surface: rendering and touch input.
//
// This file draws the grid and turns touches into intentions
// ("toggle this step", "audition this pad", "load a file into this pad").
// It never touches audio or the clock directly — main.js decides what
// those intentions mean.

// How long a label must be held before it arms for loading.
const HOLD_MS = 450;
// How long an armed label waits for the tap that opens Files.
const ARMED_MS = 4000;

// Colour as memory: each pad keeps its colour everywhere it appears.
const PAD_COLOURS = [
  '#ff5a3c', '#ff9a3c', '#ffd23c', '#7ddc4a',
  '#3cd6c4', '#3c9dff', '#9a6bff', '#ff5ab4',
];

// handlers: { onToggle(pad, step), onAudition(pad), onLoad(pad, file) }
export function createGrid(container, kit, handlers) {
  const cells = [];     // cells[pad][step]
  const names = [];     // the text element inside each label
  const labels = [];

  kit.tracks.forEach((track, pad) => {
    const colour = PAD_COLOURS[pad % PAD_COLOURS.length];

    // --- Pad label: press to hear, hold to arm, then tap to load.
    const label = document.createElement('div');
    label.className = 'label empty';
    label.style.setProperty('--pad', colour);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = track.name;
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'hold to load';
    label.append(name, hint);

    // One file input per row, invisible, lying over the label.
    // No `accept` filter on purpose: on iOS, accept="audio/*" greys out
    // .wav files in the Files browser. If a non-audio file is picked it
    // simply fails to decode and the label says so.
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'file';
    input.addEventListener('change', () => {
      const file = input.files[0];
      // Clear it so choosing the same file again still fires 'change'.
      input.value = '';
      if (file) handlers.onLoad(pad, file);
    });
    label.append(input);

    attachLoadGesture(label, hint, input, () => handlers.onAudition(pad));

    container.append(label);
    labels.push(label);
    names.push(name);

    // --- The 16 steps for this pad.
    const row = [];
    for (let step = 0; step < track.steps.length; step++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (step % 4 === 0 ? ' beat' : '');
      cell.style.setProperty('--pad', colour);
      cell.dataset.pad = pad;
      cell.dataset.step = step;
      container.append(cell);
      row.push(cell);
    }
    cells.push(row);
  });

  // Steps toggle on touch-down, not on release — it should feel like
  // hitting a pad. Each finger gets its own pointerdown, so several
  // steps can be toggled at once.
  container.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const pad = +cell.dataset.pad;
    const step = +cell.dataset.step;
    const on = handlers.onToggle(pad, step);
    cell.classList.toggle('on', on);
  });

  // Long-press on iOS otherwise brings up the copy/share callout.
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- Playhead
  let lit = -1;
  function setPlayhead(step) {
    if (step === lit) return;
    if (lit >= 0) for (const row of cells) row[lit].classList.remove('playhead');
    if (step >= 0) for (const row of cells) row[step].classList.add('playhead');
    lit = step;
  }

  function setPadName(pad, text, loaded) {
    names[pad].textContent = text;
    labels[pad].classList.toggle('empty', !loaded);
  }

  function setPadBusy(pad, busy) {
    labels[pad].classList.toggle('busy', busy);
  }

  return {
    setPlayhead,
    clearPlayhead: () => setPlayhead(-1),
    setPadName,
    setPadBusy,
  };
}

// Press / hold / tap behaviour for a pad label.
//
//   press            → audition the pad
//   hold ~half a sec → the label arms: fills with its colour, "tap to load"
//   tap while armed  → Files opens
//
// Why hold-then-tap instead of hold-and-release: iOS only opens the Files
// picker from a genuine tap on the file input itself. A script calling
// input.click() at the end of a long finger press is silently ignored
// (it worked with the trackpad because iOS treats that as a mouse click).
// So arming just lets the invisible file input receive touches, and the
// next tap lands on it directly — iOS opens Files on its own, no script.
//
// The timers here only change what's on screen. They never make a sound.
function attachLoadGesture(label, hint, input, press) {
  let holdTimer = null;
  let armTimer = null;
  let armed = false;
  let freshTap = false;   // did a new touch start on the input while armed?

  function arm() {
    armed = true;
    freshTap = false;
    label.classList.add('armed');
    hint.textContent = 'tap to load';
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, ARMED_MS);
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
    label.classList.remove('armed');
    hint.textContent = 'hold to load';
  }

  label.addEventListener('pointerdown', (e) => {
    // While armed, the finger is landing on the file input, not the pad.
    // Let iOS handle that tap natively.
    if (armed) {
      freshTap = e.target === input;
      return;
    }
    label.classList.add('pressed');
    clearTimeout(holdTimer);
    holdTimer = setTimeout(arm, HOLD_MS);
    press();
  });

  // Letting go early (or iOS taking the touch away) just means "that was
  // a tap". Once armed, the label stays armed after the finger lifts.
  function release() {
    clearTimeout(holdTimer);
    label.classList.remove('pressed');
  }
  label.addEventListener('pointerup', release);
  label.addEventListener('pointercancel', release);

  input.addEventListener('click', (e) => {
    // Once the label arms, the input is under the still-held finger, so
    // lifting it can arrive as a click on the input. Ignore that one, so
    // it's always hold, then tap — the same with a finger or the trackpad.
    if (!freshTap) {
      e.preventDefault();
      return;
    }
    // A real tap reached the input and Files is opening: back to normal.
    disarm();
  });

  // Touching anything else means "never mind".
  document.addEventListener('pointerdown', (e) => {
    if (armed && e.target !== input) disarm();
  });
}
