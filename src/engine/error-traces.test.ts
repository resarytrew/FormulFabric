import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { errorScenarios } from './error-scenarios';
import { createWorldFromLevel, stepSimulation } from './hex-engine';

test('collision and arithmetic errors reproduce original intermediate worlds', () => {
  const traces: Record<string, unknown[]> = JSON.parse(readFileSync(new URL('./fixtures/error-traces.json', import.meta.url), 'utf8'));
  const scenarios = errorScenarios(createWorldFromLevel);
  assert.deepEqual(Object.keys(scenarios).sort(), Object.keys(traces).sort());
  for (const [name, world] of Object.entries(scenarios)) {
    const expected = traces[name];
    for (let tick = 0; tick < expected.length; tick++) {
      const snapshot = JSON.parse(JSON.stringify(world, (_key, value) => value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value));
      assert.deepEqual(snapshot, expected[tick], `${name}, tick ${tick}`);
      if (tick < expected.length - 1) stepSimulation(world);
    }
    assert.equal(world.status, 'error');
    assert.ok(world.errorReason);
  }
});
