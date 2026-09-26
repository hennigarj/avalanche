// store.js — IndexedDB: the song and its samples, kept on the iPad.
//
// Two stores, kept apart on purpose:
//
//   songs    the song as JSON text. Small; rewritten on every autosave.
//   samples  the original bytes of each loaded file. Big; written once.
//
// Samples are saved the moment they're loaded. The song is saved a second
// after the last edit, and immediately when the app goes to the background
// (the last chance before iOS may kill it).
//
// Sample bytes are stored as an ArrayBuffer rather than a Blob: Safari's
// IndexedDB has had Blob bugs over the years; ArrayBuffers always work.

const DB_NAME = 'avalanche';
const DB_VERSION = 1;

// Wait this long after the last edit before saving, so a burst of taps or
// a tempo drag becomes one write instead of dozens. This timer only saves
// data; it never has anything to do with sound.
const SAVE_DELAY_MS = 1000;

let db = null;

// --- Opening

export function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      db = request.result;
      // Anything edited before storage was ready gets saved now.
      if (dirty) saveSoon();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

// iOS Safari may clear site data it thinks is unused. Asking for
// persistent storage prevents that where it's granted (home-screen apps
// usually are). Resolves true, false, or null if the browser can't say.
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (err) {
    return null;
  }
}

// Run one transaction. `work` gets the object store and may return a
// request; its result is what the promise resolves to, once the whole
// transaction has safely finished.
function run(storeName, mode, work) {
  if (!db) return Promise.reject(new Error('Storage is not open'));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

// --- Songs

// Every saved song, newest first: [{ id, savedAt, json }].
export async function loadSongs() {
  const records = await run('songs', 'readonly', (s) => s.getAll());
  return records.sort((a, b) => b.savedAt - a.savedAt);
}

// Autosave. main.js tells us once where the current song comes from, then
// calls saveSoon() after each edit. The song is read at the moment of
// saving, so it's always the latest one — even if undo swapped it out.
let source = null;
let dirty = false;
let timer = null;
let queue = Promise.resolve();   // saves run one after another, in order
let statusListener = () => {};

export function autosave(getSong) {
  source = getSong;
}

// fn({ savedAt }) after each save, or fn({ error }) if one fails.
export function onStatus(fn) {
  statusListener = fn;
}

export function saveSoon() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY_MS);
}

// Save now if anything changed. Returns a promise for when it's written.
export function flush() {
  clearTimeout(timer);
  if (!dirty || !db || !source) return queue;
  dirty = false;
  const song = source();
  const record = { id: song.id, savedAt: Date.now(), json: JSON.stringify(song) };
  queue = queue
    .then(() => run('songs', 'readwrite', (s) => s.put(record)))
    .then(() => statusListener({ savedAt: record.savedAt }))
    .catch((err) => {
      console.error('Save failed', err);
      dirty = true;   // try again with the next edit or flush
      statusListener({ error: err });
    });
  return queue;
}

// --- Samples

// record: { id, name, type, bytes: ArrayBuffer }
export function putSample(record) {
  return run('samples', 'readwrite', (s) => s.put(record));
}

// Resolves to the record, or undefined if there isn't one.
export function getSample(id) {
  return run('samples', 'readonly', (s) => s.get(id));
}

export function sampleIds() {
  return run('samples', 'readonly', (s) => s.getAllKeys());
}

export function deleteSamples(ids) {
  return run('samples', 'readwrite', (s) => {
    for (const id of ids) s.delete(id);
  });
}
