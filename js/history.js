// history.js — undo and redo, as snapshots of the whole song.
//
// Before every edit, model.js hands us the song as it was (as JSON text).
// Undo swaps the current song for the most recent snapshot; redo swaps it
// back. The song is small, so keeping a whole copy per step is simpler and
// safer than recording each change and working out how to reverse it.
//
// Kept in memory only. After a restart there's nothing to undo — but the
// song itself is saved, so nothing is lost.

const LIMIT = 100;

const past = [];      // songs before each edit, most recent last
const future = [];    // songs that were undone, ready to redo, most recent last

// While a stream of edits with the same key keeps arriving (a tempo drag),
// only the first one is recorded, so one undo goes back to where the drag
// began instead of stepping back through every value it passed.
let openMerge = null;

// Record the song as it was just before an edit.
export function record(before, mergeKey = null) {
  if (mergeKey !== null && mergeKey === openMerge) return;
  past.push(before);
  if (past.length > LIMIT) past.shift();
  future.length = 0;   // a new edit makes the old redo path meaningless
  openMerge = mergeKey;
}

// End the current stream: the next edit is a new undo step, even if it
// has the same key. Called when a drag ends.
export function closeMerge() {
  openMerge = null;
}

// Returns the song to go back to, or null if there's nothing to undo.
export function undo(current) {
  openMerge = null;
  if (!past.length) return null;
  future.push(current);
  return past.pop();
}

// Returns the song to go forward to, or null if there's nothing to redo.
export function redo(current) {
  openMerge = null;
  if (!future.length) return null;
  past.push(current);
  if (past.length > LIMIT) past.shift();
  return future.pop();
}

// Forget everything. Used when a different song is loaded.
export function clear() {
  past.length = 0;
  future.length = 0;
  openMerge = null;
}
