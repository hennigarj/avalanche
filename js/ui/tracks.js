// ui/tracks.js — the track strip. TEMPORARY: a stand-in for song view
// (milestone 9), deliberately simple.
//
// One button per track, then + KIT and + INST.
//   tap a track            show it on the grid
//   hold an instrument     arms it; tap again to load its sample from Files
//                          (the same hold-then-tap as a kit row's label)
//   + KIT / + INST         add an empty track of that kind
//
// Like the grid, it knows nothing about the song: main.js hands it the
// tracks to show and gets back intentions.

import { attachLoadGesture, hueColour, makeFileInput } from './grid.js';

// handlers: { onSelect(trackId), onAdd(type), onFile(trackId, file) }
export function createTrackStrip(container, handlers) {
  let signature = null;
  let items = [];   // one per track, in order: { el, name, detach }

  const addKit = makeAddButton('+ Kit', 'kit');
  const addInst = makeAddButton('+ Inst', 'instrument');

  function makeAddButton(text, type) {
    const button = document.createElement('button');
    button.className = 'add';
    button.textContent = text;
    button.addEventListener('pointerdown', () => handlers.onAdd(type));
    return button;
  }

  function makeItem(track) {
    const el = document.createElement('div');
    el.className = 'track';
    el.style.setProperty('--pad', hueColour(track.hue));

    const name = document.createElement('span');
    name.className = 'name';
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = track.type === 'kit' ? 'kit' : 'instrument';
    el.append(name, kind);

    let detach = () => {};
    if (track.type === 'instrument') {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'hold to load';
      const input = makeFileInput((file) => handlers.onFile(track.id, file));
      el.append(hint, input);
      detach = attachLoadGesture(el, input, hint, {
        onDown: () => handlers.onSelect(track.id),
      });
    } else {
      el.addEventListener('pointerdown', () => handlers.onSelect(track.id));
    }
    return { el, name, detach };
  }

  // Rebuild the buttons only when tracks are added, removed or reordered.
  // Everything else (names, which is current) is updated in place.
  function update({ tracks, currentId, isBusy, messages }) {
    const sig = tracks.map((t) => t.id + ':' + t.type + ':' + t.hue).join('|');
    if (sig !== signature) {
      signature = sig;
      for (const item of items) item.detach();
      items = tracks.map(makeItem);
      container.replaceChildren(...items.map((i) => i.el), addKit, addInst);
    }

    tracks.forEach((t, i) => {
      const item = items[i];
      const text = messages.get(t.id) || t.name;
      if (item.name.textContent !== text) item.name.textContent = text;
      item.el.classList.toggle('current', t.id === currentId);
      item.el.classList.toggle('busy', isBusy(t.id) || (!!t.sampleId && isBusy(t.sampleId)));
      item.el.classList.toggle('empty', t.type === 'instrument' && !t.sampleId);
    });
  }

  return { update };
}
