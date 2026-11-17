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
        // requiredBySink — производное поле сборки мира (проверяется в verification.test.ts);
        // эталонные трассы фиксируют поведение симуляции, а не метаданные ожиданий.
        _key === 'requiredBySink' ? undefined : value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value,
      ));
      assert.deepEqual(actual, expected[tick], `${level.id}, tick ${tick}`);
      if (tick < expected.length - 1) stepSimulation(world);
    }
    assert.ok(world.status === 'victory' || world.status === 'error' || world.tick >= MAX_SIMULATION_TICKS);
  }
});

test('verification streams reproduce original intermediate states', () => {
  const expected: Record<string, unknown[]> = JSON.parse(
    readFileSync(new URL('./fixtures/verification-traces.json', import.meta.url), 'utf8'),
  );
  const keys: string[] = [];
  for (const level of ALL_PUZZLE_LEVELS) {
    for (const [index, run] of (level.verificationRuns ?? []).entries()) {
      const key = `${level.id}:${index}`;
      keys.push(key);
      const world = createWorldFromLevel(level, level.demoSolution ?? [], run.spawnerOverrides, run.expectedSinkValues, run.expectedSinkPolymers);
      const trace = expected[key];
      assert.ok(trace, `missing verification trace ${key}`);
      for (let tick = 0; tick < trace.length; tick++) {
        const actual = JSON.parse(JSON.stringify(world, (_key, value) =>
          // requiredBySink — производное поле сборки мира (проверяется в verification.test.ts);
          // эталонные трассы фиксируют поведение симуляции, а не метаданные ожиданий.
          _key === 'requiredBySink' ? undefined : value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value,
        ));
        assert.deepEqual(actual, trace[tick], `${key}, tick ${tick}`);
        if (tick < trace.length - 1) stepSimulation(world);
      }
      assert.ok(world.status === 'victory' || world.status === 'error' || world.tick >= MAX_SIMULATION_TICKS);
    }
  }
  assert.deepEqual(Object.keys(expected).sort(), keys.sort());
});
