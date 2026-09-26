// ui/grid.js — draws the grid and reports touches.
//
// Knows nothing about songs, notes or sound. A view hands it descriptors —
// for each row, a label and a list of cells saying what to show — and it
// makes the screen match, touching only what changed. Touches go back out
// as intentions: "cell pressed", "audition pressed", "file chosen".
//
// Descriptors:
//   row   { label: { name, hue, loaded, busy }, cells: [cell, …] }
//   cell  { hue, state: 'off' | 'on' | 'beyond', beat, playhead }
//
// 'beyond' means past the end of the row's loop: shown dark, with no hue.

// How long a label must be held before it arms for loading.
const HOLD_MS = 450;
// How long an armed label waits for the tap that opens Files.
const ARMED_MS = 4000;

// Hue (degrees) → colour. The one place the palette is decided, so it can
// be tuned without touching anything else.
export function hueColour(hue) {
  return `hsl(${hue}, 100%, 62%)`;
}

// handlers: { onCellDown(row, col), onAudition(row), onFile(row, file) }
export function createGrid(container, rowCount, colCount, handlers) {
  const rows = [];

  for (let r = 0; r < rowCount; r++) {
    // --- Row label: press to hear, hold to arm, then tap to load.
    const label = document.createElement('div');
    label.className = 'label empty';

    const name = document.createElement('span');
    name.className = 'name';
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
      if (file) handlers.onFile(r, file);
    });
    label.append(input);

    attachLoadGesture(label, hint, input, () => handlers.onAudition(r));
    container.append(label);

    // --- The cells for this row.
    const cells = [];
    for (let c = 0; c < colCount; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      container.append(cell);
      cells.push(cell);
    }

    rows.push({ label, name, labelHue: null, cells, cellHues: [] });
  }

  // Cells act on touch-down, not on release — it should feel like hitting
  // a pad. Each finger gets its own pointerdown, so several cells can be
  // pressed at once.
  container.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handlers.onCellDown(+cell.dataset.row, +cell.dataset.col);
  });

  // Long-press on iOS otherwise brings up the copy/share callout.
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  // Make the screen match the descriptors. Called every frame, so it only
  // writes to the page where something actually changed.
  function update(descriptors) {
    descriptors.forEach((d, r) => {
      const row = rows[r];
      if (!row) return;

      if (row.labelHue !== d.label.hue) {
        row.labelHue = d.label.hue;
        row.label.style.setProperty('--pad', hueColour(d.label.hue));
      }
      if (row.name.textContent !== d.label.name) row.name.textContent = d.label.name;
      row.label.classList.toggle('empty', !d.label.loaded);
      row.label.classList.toggle('busy', d.label.busy);

      d.cells.forEach((c, i) => {
        const cell = row.cells[i];
        if (!cell) return;
        if (row.cellHues[i] !== c.hue) {
          row.cellHues[i] = c.hue;
          cell.style.setProperty('--pad', hueColour(c.hue));
        }
        const cls = cellClass(c);
        if (cell.className !== cls) cell.className = cls;
      });
    });
  }

  return { update };
}

function cellClass(c) {
  let cls = 'cell';
  if (c.state === 'beyond') {
    cls += ' beyond';
  } else {
    if (c.beat) cls += ' beat';
    if (c.state === 'on') cls += ' on';
  }
  if (c.playhead) cls += ' playhead';
  return cls;
}

// Press / hold / tap behaviour for a row label.
//
//   press            → audition the row
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
