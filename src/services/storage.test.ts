import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSavedHints, loadSavedProgress, loadSavedUiStyle, loadSavedVariants, saveHints, saveProgress, saveUiStyle, saveVariants } from './storage';

test('progress, hints, variants and UI preference survive storage round trips', () => {
  const data = new Map<string, string>();
  const fakeStorage: Storage = {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage });
  try {
    const progress = { 'lvl-01': { completed: true, bestTicks: 5 } };
    const variants = { 'lvl-01': { A: { blocks: [{ type: 'add1' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const } }] } } };
    saveProgress(progress); saveVariants(variants); saveHints({ 'lvl-01': 2 }); saveUiStyle('classic');
    assert.deepEqual(loadSavedProgress(), progress);
    assert.deepEqual(loadSavedVariants(), variants);
    assert.deepEqual(loadSavedHints(), { 'lvl-01': 2 });
    assert.equal(loadSavedUiStyle(), 'classic');
    fakeStorage.setItem('fabrika_chisel_progress_v1', '{');
    assert.deepEqual(loadSavedProgress(), {});
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.deepEqual(loadSavedVariants(), {});
    assert.doesNotThrow(() => saveProgress(progress));
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
