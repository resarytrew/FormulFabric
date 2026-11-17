import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_LEVELS } from '../engine/levels';
import { prepareSavedVariant } from './restoreVariant';

test('saved layouts are restored whole or rejected with an explanation', () => {
  const level = CAMPAIGN_LEVELS[0];
  const saved = structuredClone(level.demoSolution!);
  const result = prepareSavedVariant(level, saved);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.blocks, saved);
    assert.notEqual(result.blocks, saved);
    result.blocks[0].coord.q += 1;
    assert.notDeepEqual(result.blocks, saved);
  }
  const invalid = [...saved, { ...saved[0], coord: { q: 999, r: 999 } }];
  const before = structuredClone(invalid);
  const rejected = prepareSavedVariant(level, invalid);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.reason, /Не удалось загрузить схему/);
  assert.deepEqual(invalid, before);
  const corrupted = prepareSavedVariant(level, null);
  assert.equal(corrupted.ok, false);
  if (!corrupted.ok) assert.match(corrupted.reason, /повреждена/);
});
