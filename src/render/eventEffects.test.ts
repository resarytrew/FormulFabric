import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventEffects } from './eventEffects';
import type { SimEvent } from '../engine/types';

test('simulation event effects preserve delivery and error cues, and suppress title badges', () => {
  const calls: string[] = [];
  let title = false;
  const emit = createEventEffects({
    spawnSteamBurst: () => { calls.push('steam'); },
    spawnSparkBurst: () => { calls.push('spark'); },
    spawnPulseRing: () => { calls.push('ring'); },
    spawnOpPopup: () => { calls.push('badge'); },
    addTrauma: () => { calls.push('shake'); },
    isTitleMode: () => title,
  });
  const event: SimEvent = { id: 1, tick: 1, type: 'deliver', coord: { q: 0, r: 0 }, message: '', severity: 'success', badge: '✓' };
  emit(event);
  assert.deepEqual(calls, ['steam', 'ring', 'shake', 'badge']);
  calls.length = 0;
  title = true;
  emit({ ...event, type: 'error', severity: 'error' });
  assert.deepEqual(calls, ['ring', 'ring', 'shake']);
});
