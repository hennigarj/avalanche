// ui.js — the grid surface: rendering and touch input.
//
// This file draws the grid and turns touches into intentions
// ("toggle this step", "audition this pad", "load a file into this pad").
// It never touches audio or the clock directly — main.js decides what
// those intentions mean.

// How long a label must be held before letting go opens Files.
const HOLD_MS = 450;

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

    // --- Pad label: press to hear, hold and release to load.
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

    // One file input per row. Hidden but not display:none, which some
    // iOS versions refuse to open programmatically.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.className = 'file';
    input.addEventListener('change', () => {
      const file = input.files[0];
      // Clear it so choosing the same file again still fires 'change'.
      input.value = '';
      if (file) handlers.onLoad(pad, file);
    });
    label.append(input);

    attachHold(label, {
      press: () => handlers.onAudition(pad),
      release: (held) => { if (held) input.click(); },
    });

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

// Press / hold detection for a pad label.
//
// The Files picker has to be opened on finger-up, not by a timer while
// the finger is still down: iOS only lets a page open it in direct
// response to a touch event, and a timer firing mid-hold doesn't count.
// The timer below is purely visual — it lights the label to say
// "let go now and Files will open".
function attachHold(el, { press, release }) {
  let pointerId = null;
  let downAt = 0;
  let timer = null;

  function reset() {
    clearTimeout(timer);
    el.classList.remove('pressed', 'armed');
    pointerId = null;
  }

  el.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;   // ignore a second finger on the same label
    pointerId = e.pointerId;
    downAt = e.timeStamp;
    el.classList.add('pressed');
    timer = setTimeout(() => el.classList.add('armed'), HOLD_MS);
    press();
  });

  el.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pointerId) return;
    const held = e.timeStamp - downAt >= HOLD_MS;
    reset();
    release(held);
  });

  // The system took the touch away (e.g. a gesture). Don't open Files.
  el.addEventListener('pointercancel', (e) => {
    if (e.pointerId === pointerId) reset();
  });
}
