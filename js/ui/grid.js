// ui/grid.js — draws the grid and reports touches.
//
// Knows nothing about songs, notes or sound. A view hands it descriptors —
// for each row, a label and a list of cells saying what to show — and it
// makes the screen match, touching only what changed. Touches go back out
// as intentions: "cell pressed", "cell released", "label pressed", "file
// chosen". Every finger is reported separately (by its pointerId), so the
// view can tell a hold from a tap, and a combo from two taps.
//
// Descriptors:
//   row    { label, cells: [cell, …] }
//   label  { name, hue, loaded, busy, loadable, tint }
//   cell   { hue, state, beat, playhead, tint }
//
//   state     'off' | 'head' | 'tail' | 'beyond'
//             head = where a note starts; tail = the rest of its length;
//             beyond = past the end of the row's loop (dark, no hue)
//   tint      null | 'root' | 'outside'
//             root = this row is the key's root note (faintly tinted)
//             outside = this pitch isn't in the key (darker)
//   loadable  holding the label arms it for loading a sample

// How long a label must be held before it arms for loading.
const HOLD_MS = 450;
// How long an armed label waits for the tap that opens Files.
const ARMED_MS = 4000;

// Hue (degrees) → colour. With hueVars below, the one place the palette is
// decided, so it can be tuned without touching anything else.
export function hueColour(hue) {
  return `hsl(${hue}, 100%, 62%)`;
}

// Every shade of one hue the grid uses, as CSS variables on an element:
// the note head, its tail (~30% brightness), the tail under the playhead,
// and the faint tint of a root-note row.
function hueVars(el, hue) {
  el.style.setProperty('--pad', hueColour(hue));
  el.style.setProperty('--tail', `hsl(${hue}, 75%, 20%)`);
  el.style.setProperty('--tail-hot', `hsl(${hue}, 85%, 40%)`);
  el.style.setProperty('--tint', `hsl(${hue}, 30%, 14%)`);
  el.style.setProperty('--tint-beat', `hsl(${hue}, 30%, 18%)`);
}

// handlers: {
//   onCellDown(row, col, pointerId)
//   onCellUp(pointerId, cancelled)
//   onLabelDown(row, pointerId)
//   onLabelUp(pointerId, cancelled)
//   onFile(row, file)
// }
// cancelled: iOS took the touch away (a system gesture), so it wasn't a
// real release.
export function createGrid(container, rowCount, colCount, handlers) {
  const rows = [];

  for (let r = 0; r < rowCount; r++) {
    // --- Row label: the audition pad. Press to hear; on kit rows, hold to
    // arm, then tap to load.
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
    const input = makeFileInput((file) => handlers.onFile(r, file));
    label.append(input);

    const row = { label, name, labelHue: null, loadable: false, cells: [], cellHues: [] };
    attachLoadGesture(label, input, hint, {
      canLoad: () => row.loadable,
      onDown: (e) => handlers.onLabelDown(r, e.pointerId),
      onUp: (e, cancelled) => handlers.onLabelUp(e.pointerId, cancelled),
    });
    container.append(label);

    // --- The cells for this row.
    for (let c = 0; c < colCount; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      container.append(cell);
      row.cells.push(cell);
    }

    rows.push(row);
  }

  // Cells act on touch-down — it should feel like hitting a pad — and
  // show they're pressed straight away, with a white ring. Each finger
  // gets its own pointerdown, so several cells can be pressed at once.
  const pressed = new Map();   // pointerId → cell element

  container.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    pressed.set(e.pointerId, cell);
    cell.classList.add('held');
    handlers.onCellDown(+cell.dataset.row, +cell.dataset.col, e.pointerId);
  });

  // Listened for on the whole window, so a finger (or the trackpad) that
  // slid off the grid before lifting is still seen to lift.
  function lift(e) {
    const cell = pressed.get(e.pointerId);
    if (!cell) return;
    pressed.delete(e.pointerId);
    if (!isPressed(cell)) cell.classList.remove('held');
    handlers.onCellUp(e.pointerId, e.type === 'pointercancel');
  }
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);

  function isPressed(cell) {
    for (const c of pressed.values()) if (c === cell) return true;
    return false;
  }

  // Long-press on iOS otherwise brings up the copy/share callout.
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  // Make the screen match the descriptors. Called every frame, so it only
  // writes to the page where something actually changed.
  function update(descriptors) {
    descriptors.forEach((d, r) => {
      const row = rows[r];
      if (!row) return;

      const l = d.label;
      if (row.labelHue !== l.hue) {
        row.labelHue = l.hue;
        hueVars(row.label, l.hue);
      }
      if (row.name.textContent !== l.name) row.name.textContent = l.name;
      row.loadable = !!l.loadable;
      const cls = row.label.classList;
      cls.toggle('empty', !l.loaded);
      cls.toggle('busy', !!l.busy);
      cls.toggle('loadable', row.loadable);
      cls.toggle('root', l.tint === 'root');
      cls.toggle('outside', l.tint === 'outside');

      d.cells.forEach((c, i) => {
        const cell = row.cells[i];
        if (!cell) return;
        if (row.cellHues[i] !== c.hue) {
          row.cellHues[i] = c.hue;
          hueVars(cell, c.hue);
        }
        const want = cellClass(c, isPressed(cell));
        if (cell.className !== want) cell.className = want;
      });
    });
  }

  return { update };
}

// One class per look, so no two rules ever fight over a cell's colour.
function cellClass(c, held) {
  let cls;
  if (c.state === 'beyond') cls = 'cell beyond';
  else if (c.state === 'head') cls = c.playhead ? 'cell head playhead' : 'cell head';
  else if (c.state === 'tail') cls = c.playhead ? 'cell tail playhead' : 'cell tail';
  else if (c.playhead) cls = 'cell playhead';
  else {
    cls = 'cell';
    if (c.tint) cls += ' ' + c.tint;
    if (c.beat) cls += ' beat';
  }
  if (held) cls += ' held';
  return cls;
}

// An invisible file input. It calls onFile(file) when one is chosen.
export function makeFileInput(onFile) {
  const input = document.createElement('input');
  input.type = 'file';
  input.className = 'file';
  input.addEventListener('change', () => {
    const file = input.files[0];
    // Clear it so choosing the same file again still fires 'change'.
    input.value = '';
    if (file) onFile(file);
  });
  return input;
}

// Press / hold / tap behaviour for anything a sample can be loaded into
// (a kit row's label, an instrument's button in the track strip).
//
//   press            → onDown (audition the row, select the track…)
//   lift             → onUp
//   hold ~half a sec → if canLoad(), it arms: fills with its colour,
//                      "tap to load"
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
//
// Returns a function that removes the listeners this added outside `el`.
export function attachLoadGesture(el, input, hint, { canLoad = () => true, onDown, onUp = () => {} }) {
  const restingHint = hint ? hint.textContent : '';
  const fingers = new Set();   // pointerIds pressing el right now
  let holdTimer = null;
  let armTimer = null;
  let armed = false;
  let freshTap = false;   // did a new touch start on the input while armed?

  function arm() {
    if (!canLoad()) return;
    armed = true;
    freshTap = false;
    el.classList.add('armed');
    if (hint) hint.textContent = 'tap to load';
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, ARMED_MS);
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
    el.classList.remove('armed');
    if (hint) hint.textContent = restingHint;
  }

  el.addEventListener('pointerdown', (e) => {
    // While armed, the finger is landing on the file input, not the pad.
    // Let iOS handle that tap natively.
    if (armed) {
      freshTap = e.target === input;
      return;
    }
    fingers.add(e.pointerId);
    el.classList.add('pressed');
    clearTimeout(holdTimer);
    if (canLoad()) holdTimer = setTimeout(arm, HOLD_MS);
    onDown(e);
  });

  // Letting go early (or iOS taking the touch away) just means "that was
  // a tap". Once armed, it stays armed after the finger lifts.
  function release(e) {
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    clearTimeout(holdTimer);
    if (!fingers.size) el.classList.remove('pressed');
    onUp(e, e.type === 'pointercancel');
  }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  input.addEventListener('click', (e) => {
    // Once armed, the input is under the still-held finger, so lifting it
    // can arrive as a click on the input. Ignore that one, so it's always
    // hold, then tap — the same with a finger or the trackpad.
    if (!freshTap) {
      e.preventDefault();
      return;
    }
    // A real tap reached the input and Files is opening: back to normal.
    disarm();
  });

  // Touching anything else means "never mind".
  function elsewhere(e) {
    if (armed && e.target !== input) disarm();
  }
  document.addEventListener('pointerdown', elsewhere);

  return function detach() {
    clearTimeout(holdTimer);
    clearTimeout(armTimer);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    document.removeEventListener('pointerdown', elsewhere);
  };
}
