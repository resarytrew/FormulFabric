import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_PUZZLE_LEVELS } from './levels';
import { createWorldFromLevel, MAX_SIMULATION_TICKS, stepSimulation } from './hex-engine';

const traces: Record<string, unknown[]> = JSON.parse(
  readFileSync(new URL('./fixtures/demo-traces.json', import.meta.url), 'utf8'),
);

test('demo solutions reproduce the original world on every tick', () => {
  assert.equal(ALL_PUZZLE_LEVELS.length, 29);
  assert.deepEqual(Object.keys(traces).sort(), ALL_PUZZLE_LEVELS.map(level => level.id).sort());
  for (const level of ALL_PUZZLE_LEVELS) {
    const world = createWorldFromLevel(level, level.demoSolution ?? []);
    const expected = traces[level.id];
    for (let tick = 0; tick < expected.length; tick++) {
      const actual = JSON.parse(JSON.stringify(world, (_key, value) =>
        value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value,
      ));
      assert.deepEqual(actual, expected[tick], `${level.id}, tick ${tick}`);
      if (tick < expected.length - 1) stepSimulation(world);
    }
    assert.ok(world.status === 'victory' || world.status === 'error' || world.tick >= MAX_SIMULATION_TICKS);
  }
});
