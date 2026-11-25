/**
 * Undo/redo for the editor.
 *
 * An editor without undo is not a tool people will trust with a document they
 * care about — every action feels irreversible, so nobody explores. The model
 * is deliberately simple: the editable state is two Maps (text/geometry edits,
 * and form field values), both small and cheaply cloneable, so history stores
 * whole snapshots rather than diffs. Correctness matters far more here than
 * memory, and a snapshot cannot drift out of sync with the thing it describes.
 *
 * Consecutive edits to the SAME element within a short window are coalesced, so
 * typing a word is one undo rather than one per keystroke.
 */

export const COALESCE_MS = 600;

const cloneMap = m => new Map(m instanceof Map ? m : []);

export function createHistoryState(edits = new Map(), fieldValues = new Map()) {
  return {
    past: [],
    present: { edits: cloneMap(edits), fieldValues: cloneMap(fieldValues) },
    future: [],
    lastLabel: null,
    lastAt: 0,
  };
}

/**
 * Record a new state.
 *
 * @param {object} state    the history state
 * @param {object} next     { edits, fieldValues }
 * @param {object} [opts]
 * @param {string} [opts.label]     what changed, e.g. `text:seg0_3`
 * @param {boolean} [opts.coalesce] merge with the previous entry when the label
 *                                  matches and it happened moments ago
 * @param {number} [opts.now]       injectable clock, for tests
 */
export function pushHistory(state, next, opts = {}) {
  const { label = null, coalesce = false, now = Date.now() } = opts;
  const present = { edits: cloneMap(next.edits), fieldValues: cloneMap(next.fieldValues) };

  const mergeable =
    coalesce &&
    label !== null &&
    label === state.lastLabel &&
    now - state.lastAt < COALESCE_MS &&
    state.past.length > 0;

  return {
    // when coalescing, replace the current present instead of stacking a new step
    past: mergeable ? state.past : [...state.past, state.present],
    present,
    future: [],
    lastLabel: label,
    lastAt: now,
  };
}

export const canUndo = state => state.past.length > 0;
export const canRedo = state => state.future.length > 0;

export function undo(state) {
  if (!canUndo(state)) return state;
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
    lastLabel: null,     // never coalesce across an undo
    lastAt: 0,
  };
}

export function redo(state) {
  if (!canRedo(state)) return state;
  const next = state.future[0];
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
    lastLabel: null,
    lastAt: 0,
  };
}

/** Discard history, e.g. when a different document is opened. */
export function resetHistory() {
  return createHistoryState();
}

/** How many steps are available, for a UI that wants to show it. */
export const historyDepth = state => ({ undo: state.past.length, redo: state.future.length });
