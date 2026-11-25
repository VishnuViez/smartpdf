import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from './_helpers.mjs';

const {
  createHistoryState, pushHistory, undo, redo, canUndo, canRedo, historyDepth, COALESCE_MS,
} = await import(path.join(ROOT, 'app/lib/pdf/model/history.js'));

const edits = (...pairs) => new Map(pairs);
const state0 = () => createHistoryState();

describe('history: the basics people expect', () => {
  test('a fresh history has nothing to undo or redo', () => {
    const s = state0();
    assert.equal(canUndo(s), false);
    assert.equal(canRedo(s), false);
    assert.deepEqual(historyDepth(s), { undo: 0, redo: 0 });
  });

  test('undo returns the previous state, redo returns forward again', () => {
    let s = state0();
    s = pushHistory(s, { edits: edits(['a', 1]), fieldValues: new Map() }, { now: 0 });
    s = pushHistory(s, { edits: edits(['a', 1], ['b', 2]), fieldValues: new Map() }, { now: 5000 });
    assert.equal(s.present.edits.size, 2);

    s = undo(s);
    assert.equal(s.present.edits.size, 1, 'undo did not restore the earlier state');
    s = undo(s);
    assert.equal(s.present.edits.size, 0, 'undo did not reach the empty start');
    assert.equal(canUndo(s), false);

    s = redo(s);
    assert.equal(s.present.edits.size, 1);
    s = redo(s);
    assert.equal(s.present.edits.size, 2);
    assert.equal(canRedo(s), false);
  });

  test('undoing past the beginning is a no-op, not a crash', () => {
    let s = state0();
    for (let i = 0; i < 5; i++) s = undo(s);
    assert.equal(s.present.edits.size, 0);
    for (let i = 0; i < 5; i++) s = redo(s);
    assert.equal(s.present.edits.size, 0);
  });

  test('a new edit after undo discards the redo branch', () => {
    let s = state0();
    s = pushHistory(s, { edits: edits(['a', 1]), fieldValues: new Map() }, { now: 0 });
    s = pushHistory(s, { edits: edits(['a', 2]), fieldValues: new Map() }, { now: 5000 });
    s = undo(s);
    assert.equal(canRedo(s), true);
    s = pushHistory(s, { edits: edits(['a', 3]), fieldValues: new Map() }, { now: 10000 });
    assert.equal(canRedo(s), false, 'a stale redo branch survived a new edit');
    assert.equal(s.present.edits.get('a'), 3);
  });

  test('snapshots are independent — mutating the source cannot corrupt history', () => {
    let s = state0();
    const live = edits(['a', 1]);
    s = pushHistory(s, { edits: live, fieldValues: new Map() }, { now: 0 });
    live.set('b', 2);                       // caller keeps editing their copy
    assert.equal(s.present.edits.size, 1, 'history shares state with the caller');
  });

  test('form field values are tracked alongside text edits', () => {
    let s = state0();
    s = pushHistory(s, { edits: new Map(), fieldValues: edits(['f1', 'Ada']) }, { now: 0 });
    s = pushHistory(s, { edits: new Map(), fieldValues: edits(['f1', 'Ada Lovelace']) }, { now: 5000 });
    s = undo(s);
    assert.equal(s.present.fieldValues.get('f1'), 'Ada');
  });
});

describe('history: coalescing so typing is one undo', () => {
  test('rapid edits to the same element collapse into one step', () => {
    let s = state0();
    s = pushHistory(s, { edits: edits(['x', 'H']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1000 });
    s = pushHistory(s, { edits: edits(['x', 'He']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1100 });
    s = pushHistory(s, { edits: edits(['x', 'Hel']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1200 });
    assert.equal(historyDepth(s).undo, 1, 'each keystroke became its own undo step');
    s = undo(s);
    assert.equal(s.present.edits.size, 0, 'one undo should remove the whole word');
  });

  test('a pause ends the coalescing window', () => {
    let s = state0();
    s = pushHistory(s, { edits: edits(['x', 'H']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1000 });
    s = pushHistory(s, { edits: edits(['x', 'Hi']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1000 + COALESCE_MS + 50 });
    assert.equal(historyDepth(s).undo, 2, 'edits after a pause must be separate steps');
  });

  test('editing a DIFFERENT element always starts a new step', () => {
    let s = state0();
    s = pushHistory(s, { edits: edits(['x', 'a']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1000 });
    s = pushHistory(s, { edits: edits(['x', 'a'], ['y', 'b']), fieldValues: new Map() },
      { label: 'text:y', coalesce: true, now: 1050 });
    assert.equal(historyDepth(s).undo, 2);
  });

  test('an undo breaks the coalescing chain', () => {
    let s = state0();
    s = pushHistory(s, { edits: edits(['x', 'a']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1000 });
    s = pushHistory(s, { edits: edits(['x', 'ab']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1050 });
    s = undo(s);
    s = pushHistory(s, { edits: edits(['x', 'ac']), fieldValues: new Map() },
      { label: 'text:x', coalesce: true, now: 1100 });
    assert.equal(historyDepth(s).undo, 1, 'coalesced onto a state that was undone');
  });

  test('moves and resizes coalesce so a drag is one undo', () => {
    let s = state0();
    for (let i = 0; i < 30; i++) {
      s = pushHistory(s, { edits: edits(['x', { x: i }]), fieldValues: new Map() },
        { label: 'geometry:x', coalesce: true, now: 2000 + i * 16 });
    }
    assert.equal(historyDepth(s).undo, 1, 'a single drag produced 30 undo steps');
  });
});
