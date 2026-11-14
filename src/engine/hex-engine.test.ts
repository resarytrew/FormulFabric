import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SIMULATION_TICKS,
  cloneWorld,
  computeWorldArea,
  createWorldFromLevel,
  euclideanDivMod,
  getExactDiv2,
  getExactSqrt,
  matchComponentToPattern,
  runUntilComplete,
  stepSimulation,
  verifyLevelSolution,
} from './hex-engine';
import { ALL_PUZZLE_LEVELS, CAMPAIGN_LEVELS, EUREKA_LEVELS, SANDBOX_LEVEL } from './levels';
import { hexKey, rotateAroundPivot, rotateAxialOffset } from './hex-math';
import type { LevelDefinition, MachineType, TargetPattern } from './types';

test('signed integer arithmetic and exact div2 parity including negative numbers and zero', () => {
  for (const even of [-8, -4, -2, 0, 2, 4]) {
    const res = getExactDiv2(even);
    assert.equal(res.ok, true, `${even} should divide by 2`);
    if (res.ok) assert.equal(res.result, even / 2 === 0 ? 0 : even / 2);
  }
  for (const odd of [-7, -3, -1, 1, 3, 5]) {
    const res = getExactDiv2(odd);
    assert.equal(res.ok, false, `${odd} must NOT divide by 2`);
  }
});

test('exact sqrt rejects negative and non-square numbers', () => {
  assert.deepEqual(getExactSqrt(0), { ok: true, result: 0 });
  assert.deepEqual(getExactSqrt(1), { ok: true, result: 1 });
  assert.deepEqual(getExactSqrt(9), { ok: true, result: 3 });
  assert.equal(getExactSqrt(-1).ok, false);
  assert.equal(getExactSqrt(2).ok, false);
  assert.equal(getExactSqrt(3).ok, false);
});

test('euclidean divmod satisfies a = b*q + r with 0 <= r < b for negative and positive a', () => {
  for (const a of [-8, -1, 0, 1, 2, 3, 7]) {
    const b = 3;
    const { q, r } = euclideanDivMod(a, b);
    assert.equal(b * q + r, a);
    assert.ok(r >= 0 && r < b, `r=${r} out of [0, ${b}) for a=${a}`);
  }
});

test('range overflow produces explicit error event instead of clamping', () => {
  const level: LevelDefinition = {
    id: 'overflow-test',
    index: 99,
    title: 'Overflow',
    subtitle: '',
    tier: 'Начальный',
    radius: 2,
    availableTools: ['mul2'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [600], loopSequence: false, spawnInterval: 2 },
      },
      {
        type: 'mul2',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const world = createWorldFromLevel(level);
  stepSimulation(world); // spawns 600 onto (-1,0) -> mul2 -> 1200 > 999!
  assert.equal(world.status, 'error');
  assert.ok(world.errorReason?.includes('999'));
});

test('odd number entering div2 emits error and does not vanish or round', () => {
  const level: LevelDefinition = {
    id: 'odd-div2',
    index: 99,
    title: 'Odd Div2',
    subtitle: '',
    tier: 'Начальный',
    radius: 2,
    availableTools: ['div2'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [-1], loopSequence: false, spawnInterval: 2 },
      },
      {
        type: 'div2',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const world = createWorldFromLevel(level);
  stepSimulation(world);
  assert.equal(world.status, 'error');
  assert.ok(world.errorReason?.includes('не делится нацело'));
  assert.equal(world.tokens.size, 1);
  const tok = Array.from(world.tokens.values())[0];
  assert.equal(tok.value, -1);
});

test('adder handles simultaneous arrival of 2 and 3 without re-absorbing 5, and preserves stored zero', () => {
  const level: LevelDefinition = {
    id: 'adder-sim',
    index: 99,
    title: 'Adder Simultaneous',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['adder', 'conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [2], loopSequence: false, spawnInterval: 5 },
      },
      {
        type: 'spawner',
        coord: { q: 0, r: -2 },
        locked: true,
        config: { dir: 1, sequence: [3], loopSequence: false, spawnInterval: 5 },
      },
      {
        type: 'conveyor',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'conveyor',
        coord: { q: 0, r: -1 },
        locked: true,
        config: { dir: 1 },
      },
      {
        type: 'adder',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'conveyor',
        coord: { q: 1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'sink',
        coord: { q: 2, r: 0 },
        locked: true,
        config: {
          dir: 0,
          sinkId: 'main',
          targetPattern: {
            mode: 'exact',
            nodes: [{ offset: { q: 0, r: 0 }, value: 5 }],
            edges: [],
            rotationInvariant: true,
            label: '[5]',
          },
        },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const world = createWorldFromLevel(level);
  stepSimulation(world); // Tick 1: spawns 2 at (-1,0) and 3 at (0,-1)
  stepSimulation(world); // Tick 2: both arrive simultaneously at (0,0) -> output 5!
  assert.equal(world.status, 'running');
  const adder = world.machines.get(hexKey({ q: 0, r: 0 }))!;
  assert.equal(adder.state.memory, null);
  const tokensAtAdder = Array.from(world.tokens.values());
  assert.equal(tokensAtAdder.length, 1);
  assert.equal(tokensAtAdder[0].value, 5);

  stepSimulation(world); // Tick 3: 5 moves East to (1,0), NOT re-absorbed into memory!
  assert.equal(adder.state.memory, null);
  assert.equal(world.tokens.size, 1);
  assert.deepEqual(Array.from(world.tokens.values())[0].coord, { q: 1, r: 0 });

  stepSimulation(world); // Tick 4: 5 arrives at Sink (2,0) -> victory!
  assert.equal(world.status, 'victory');
  assert.equal(world.deliveredCount, 1);
});

test('adder preserves stored zero (0 + -8 = -8)', () => {
  const level: LevelDefinition = {
    id: 'adder-zero',
    index: 99,
    title: 'Adder Zero',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['adder', 'conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [0, -8], loopSequence: false, spawnInterval: 2 },
      },
      {
        type: 'conveyor',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'adder',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'sink',
        coord: { q: 1, r: 0 },
        locked: true,
        config: {
          dir: 0,
          sinkId: 'main',
          targetPattern: {
            mode: 'exact',
            nodes: [{ offset: { q: 0, r: 0 }, value: -8 }],
            edges: [],
            rotationInvariant: true,
            label: '[-8]',
          },
        },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const world = createWorldFromLevel(level);
  stepSimulation(world); // spawns 0 at (-1,0)
  stepSimulation(world); // 0 enters adder -> stored in memory = 0
  const adder = world.machines.get(hexKey({ q: 0, r: 0 }))!;
  assert.equal(adder.state.memory, 0);
  const res = runUntilComplete(world, 20);
  assert.equal(res.check.passed, true);
  assert.deepEqual(res.world.sinkDeliveries['main'], [[-8]]);
});

test('conflicting drive vectors on bonded polymer trigger symmetric THRUST_CONFLICT regardless of machine order', () => {
  const makeConflictWorld = (reverseOrder: boolean) => {
    const mA = {
      type: 'conveyor' as const,
      coord: { q: 0, r: 0 },
      locked: true,
      config: { dir: 0 as const }, // East
    };
    const mB = {
      type: 'conveyor' as const,
      coord: { q: 1, r: 0 },
      locked: true,
      config: { dir: 3 as const }, // West
    };
    const level: LevelDefinition = {
      id: 'conflict',
      index: 99,
      title: 'Conflict',
      subtitle: '',
      tier: 'Начальный',
      radius: 2,
      availableTools: ['conveyor'],
      requiredDeliveries: 1,
      presetMachines: reverseOrder ? [mB, mA] : [mA, mB],
      pedagogyNote: '',
      bonusGoalText: '',
    };
    const world = createWorldFromLevel(level);
    world.tokens.set('t_1', {
      id: 't_1',
      value: 1,
      coord: { q: 0, r: 0 },
      prevCoord: { q: 0, r: 0 },
      spawnOrder: 1,
    });
    world.tokens.set('t_2', {
      id: 't_2',
      value: 2,
      coord: { q: 1, r: 0 },
      prevCoord: { q: 1, r: 0 },
      spawnOrder: 2,
    });
    world.bonds.push({ a: 't_1', b: 't_2' });
    return world;
  };

  const w1 = makeConflictWorld(false);
  const w2 = makeConflictWorld(true);
  stepSimulation(w1);
  stepSimulation(w2);

  assert.equal(w1.status, 'error');
  assert.equal(w2.status, 'error');
  assert.equal(w1.errorHighlightHexes.length, 2);
  assert.equal(w2.errorHighlightHexes.length, 2);
});

test('exact sink rejects oversized polymer [4]-[2]-[99]-[42] when target is [4]-[2]', () => {
  const pattern: TargetPattern = {
    mode: 'exact',
    nodes: [
      { offset: { q: 0, r: 0 }, value: 4 },
      { offset: { q: 1, r: 0 }, value: 2 },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
    rotationInvariant: false,
    label: '[4 ━━ 2]',
  };
  const level: LevelDefinition = {
    id: 'exact-graph',
    index: 99,
    title: 'Exact',
    subtitle: '',
    tier: 'Начальный',
    radius: 3,
    availableTools: [],
    requiredDeliveries: 1,
    presetMachines: [],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const world = createWorldFromLevel(level);
  world.tokens.set('t1', { id: 't1', value: 4, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  world.tokens.set('t2', { id: 't2', value: 2, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 2 });
  world.tokens.set('t3', { id: 't3', value: 99, coord: { q: 2, r: 0 }, prevCoord: { q: 2, r: 0 }, spawnOrder: 3 });
  world.tokens.set('t4', { id: 't4', value: 42, coord: { q: 2, r: 1 }, prevCoord: { q: 2, r: 1 }, spawnOrder: 4 });
  world.bonds.push({ a: 't1', b: 't2' }, { a: 't2', b: 't3' }, { a: 't3', b: 't4' });

  const matchRes = matchComponentToPattern(
    { id: 't1', tokenIds: ['t1', 't2', 't3', 't4'], bondIndices: [0, 1, 2] },
    world,
    { q: 0, r: 0 },
    pattern,
  );
  assert.equal(matchRes.matched, false);
});

test('axial 60-degree rotation math is cyclic of order 6', () => {
  const p = { q: 2, r: -1 };
  let curr = { ...p };
  for (let i = 0; i < 6; i++) {
    curr = rotateAxialOffset(curr, 1);
  }
  assert.deepEqual(curr, p);

  const pivot = { q: 1, r: 1 };
  const rot1 = rotateAroundPivot({ q: 2, r: 0 }, pivot, 1);
  const back = rotateAroundPivot(rot1, pivot, -1);
  assert.deepEqual(back, { q: 2, r: 0 });
});

test('all Campaign + Eureka demo solutions pass simulation, verification runs, and part quotas', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 10);
  assert.equal(EUREKA_LEVELS.length, 9);
  for (const level of ALL_PUZZLE_LEVELS) {
    assert.ok(level.demoSolution && level.demoSolution.length > 0, `Level ${level.id} missing demoSolution`);
    assert.ok(level.hints && level.hints.length === 3, `Level ${level.id} must have 3 progressive hints`);

    if (level.maxTotalBlocks !== undefined) {
      assert.ok(
        level.demoSolution.length <= level.maxTotalBlocks,
        `Level ${level.id} demoSolution (${level.demoSolution.length}) exceeds maxTotalBlocks (${level.maxTotalBlocks})`,
      );
    }
    if (level.partLimits) {
      const counts: Partial<Record<MachineType, number>> = {};
      for (const b of level.demoSolution) {
        counts[b.type] = (counts[b.type] ?? 0) + 1;
      }
      for (const [mType, limit] of Object.entries(level.partLimits)) {
        const used = counts[mType as MachineType] ?? 0;
        assert.ok(
          used <= (limit ?? Infinity),
          `Level ${level.id} demoSolution uses ${used} of ${mType}, limit is ${limit}`,
        );
      }
    }

    const world = createWorldFromLevel(level, level.demoSolution);
    const { check } = runUntilComplete(world, 180);
    assert.equal(
      check.passed,
      true,
      `Level ${level.id} (${level.title}) failed demoSolution: ${check.reason}`,
    );
    const area = computeWorldArea(world);
    assert.ok(area >= level.demoSolution.length, `Area ${area} must cover placed blocks`);

    if (level.verificationRuns) {
      for (const vr of level.verificationRuns) {
        const vw = createWorldFromLevel(
          level,
          level.demoSolution,
          vr.spawnerOverrides,
          vr.expectedSinkValues,
          vr.expectedSinkPolymers,
        );
        const vRes = runUntilComplete(vw, 180);
        assert.equal(
          vRes.check.passed,
          true,
          `Level ${level.id} verificationRun "${vr.name}" failed: ${vRes.check.reason}`,
        );
      }
      const report = verifyLevelSolution(level, level.demoSolution, 180);
      assert.equal(report.passed, report.total, `Level ${level.id} verifyLevelSolution did not pass all runs`);
    }
  }
});

test('cloneWorld creates deep isolated snapshot for React state and tick rewind', () => {
  const lvl1 = CAMPAIGN_LEVELS[0];
  const worldA = createWorldFromLevel(lvl1, lvl1.demoSolution ?? []);
  stepSimulation(worldA); // tick 1: token spawns at (-1, 0)
  const snapshotBefore = cloneWorld(worldA);

  const worldB = cloneWorld(worldA);
  stepSimulation(worldB); // tick 2: token moves onto (0, 0) +1 -> value 2, spawner cooldown decays
  stepSimulation(worldB); // tick 3: second token spawns (spawnIndex = 2)

  assert.equal(worldA.tick, snapshotBefore.tick);
  assert.equal(worldA.tokens.size, snapshotBefore.tokens.size);
  assert.equal(worldA.events.length, snapshotBefore.events.length);
  const spawnerA = worldA.machines.get(hexKey({ q: -2, r: 0 }))!;
  const spawnerB = worldB.machines.get(hexKey({ q: -2, r: 0 }))!;
  assert.equal(spawnerA.state.spawnIndex, 1);
  assert.equal(spawnerB.state.spawnIndex, 2);
});

test('spawner directed into solid machine housing halts with collision error', () => {
  const level: LevelDefinition = {
    id: 'spawner-solid',
    index: 99,
    title: 'Spawner Solid',
    subtitle: '',
    tier: 'Начальный',
    radius: 2,
    availableTools: ['spawner', 'pusher'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [5], loopSequence: false, spawnInterval: 2 },
      },
      {
        type: 'pusher',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const world = createWorldFromLevel(level);
  stepSimulation(world);
  assert.equal(world.status, 'error');
  assert.equal(world.tokens.size, 0);
  assert.ok(world.errorReason?.includes('корпус'));
});

test('rotationInvariant sink checks all 60-degree orientations instead of failing on first mismatched values', () => {
  // Asymmetric triangle [10, 20, 30] around sink (0,0) rotated by 180 deg (rot = 3)
  const pattern: TargetPattern = {
    mode: 'exact',
    nodes: [
      { offset: { q: 0, r: 0 }, value: 10 },
      { offset: { q: 1, r: 0 }, value: 20 },
      { offset: { q: -1, r: 0 }, value: 30 },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 0, toIdx: 2 },
    ],
    rotationInvariant: true,
    label: '[30 ━━ 10 ━━ 20]',
  };
  const world = createWorldFromLevel({
    id: 'rot-match',
    index: 99,
    title: 'Rot Match',
    subtitle: '',
    tier: 'Средний',
    radius: 2,
    availableTools: [],
    requiredDeliveries: 1,
    presetMachines: [],
    pedagogyNote: '',
    bonusGoalText: '',
  });
  // Place 30 at (1,0) and 20 at (-1,0) — geometry matches at rot=0, values only match at rot=3!
  world.tokens.set('t1', { id: 't1', value: 10, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  world.tokens.set('t2', { id: 't2', value: 20, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 2 });
  world.tokens.set('t3', { id: 't3', value: 30, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 3 });
  world.bonds.push({ a: 't1', b: 't2' }, { a: 't1', b: 't3' });

  const res = matchComponentToPattern(
    { id: 't1', tokenIds: ['t1', 't2', 't3'], bondIndices: [0, 1] },
    world,
    { q: 0, r: 0 },
    pattern,
  );
  assert.equal(res.matched, true);
});

test('sandbox infiniteMode runs continuously past 100 deliveries without stopping in victory', () => {
  const world = createWorldFromLevel(SANDBOX_LEVEL, SANDBOX_LEVEL.demoSolution ?? []);
  for (let i = 0; i < 360; i++) {
    stepSimulation(world);
    assert.notEqual(world.status, 'error', `Sandbox errored at tick ${world.tick}: ${world.errorReason}`);
    assert.notEqual(world.status, 'victory', 'Sandbox must never stop in victory');
  }
  assert.ok(world.deliveredCount > 100, `Expected >100 deliveries in infinite sandbox, got ${world.deliveredCount}`);
});

test('welder + laser cut + magnet + filter + divmod multi-machine interaction', () => {
  const level: LevelDefinition = {
    id: 'multi-interact',
    index: 99,
    title: 'Multi',
    subtitle: '',
    tier: 'Продвинутый',
    radius: 3,
    availableTools: ['conveyor', 'welder', 'laser', 'magnet', 'divmod', 'filter'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -3, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [7], loopSequence: false, spawnInterval: 10 },
      },
      {
        type: 'spawner',
        coord: { q: -3, r: 1 },
        locked: true,
        config: { dir: 0, sequence: [4], loopSequence: false, spawnInterval: 10 },
      },
      { type: 'welder', coord: { q: -2, r: 0 }, locked: true, config: { dir: 1 } },
      { type: 'conveyor', coord: { q: -2, r: 1 }, locked: true, config: { dir: 0 } },
      { type: 'laser', coord: { q: -1, r: 0 }, locked: true, config: { dir: 1 } },
      { type: 'conveyor', coord: { q: -1, r: 1 }, locked: true, config: { dir: 0 } },
      { type: 'filter', coord: { q: 0, r: 1 }, locked: true, config: { dir: 0, altDir: 1, filterRule: 'negative' } },
      { type: 'magnet', coord: { q: 1, r: 0 }, locked: true, config: { dir: 3 } },
      { type: 'divmod', coord: { q: 0, r: 0 }, locked: true, config: { dir: 4, altDir: 5, divisor: 3 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  // Tick 1: spawn 7 at (-2,0) & 4 at (-2,1); welder bonds [7 ━━ 4]
  stepSimulation(w);
  assert.equal(w.bonds.length, 1);

  // Tick 2: conveyor (-2,1) moves [7 ━━ 4] East to (-1,0) & (-1,1); laser (-1,0) cuts bond
  stepSimulation(w);
  assert.equal(w.bonds.length, 0, 'Laser must cut bond between (-1,0) and (-1,1)');

  // Tick 3: magnet pulls 7 onto divmod (0,0) -> 7 = 3*2 + 1 (q=2 at (0,0), r=1 at (1,-1)),
  // while conveyor (-1,1) moves 4 onto filter (0,1).
  stepSimulation(w);
  assert.equal(w.status, 'running');
  const tokensT3 = Array.from(w.tokens.values());
  const qTok = tokensT3.find((t) => t.coord.q === 0 && t.coord.r === 0);
  const rTok = tokensT3.find((t) => t.coord.q === 1 && t.coord.r === -1);
  assert.equal(qTok?.value, 2);
  assert.equal(rTok?.value, 1);

  // Tick 4: filter at (0,1) with rule 'negative' routes positive 4 to altDir=1 -> (0,2)!
  stepSimulation(w);
  assert.equal(w.status, 'running');
  const fTok = Array.from(w.tokens.values()).find((t) => t.value === 4);
  assert.deepEqual(fTok?.coord, { q: 0, r: 2 });
});

test('negator (-x) and duplicator (=) handle zero, negatives, and blocked copy port', () => {
  const eur2 = EUREKA_LEVELS.find((l) => l.id === 'eur-02')!;
  const wNeg = createWorldFromLevel(eur2, eur2.demoSolution);
  const resNeg = runUntilComplete(wNeg, 40);
  assert.equal(resNeg.check.passed, true);
  assert.deepEqual(resNeg.world.sinkDeliveries['main'], [[5], [0], [1], [10]]);

  // Blocked copy port on dup triggers explicit error
  const blockedDupLevel: LevelDefinition = {
    id: 'dup-blocked',
    index: 99,
    title: 'Blocked Dup',
    subtitle: '',
    tier: 'Начальный',
    radius: 2,
    availableTools: ['dup'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [7], loopSequence: false, spawnInterval: 5 },
      },
      {
        type: 'dup',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0, altDir: 1 },
      },
      {
        type: 'pusher',
        coord: { q: 0, r: 1 },
        locked: true,
        config: { dir: 0 },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wBlocked = createWorldFromLevel(blockedDupLevel);
  stepSimulation(wBlocked);
  assert.equal(wBlocked.status, 'error');
  assert.ok(wBlocked.errorReason?.includes('дубликатора'));
});

test('hidden verificationRuns catch hardcoded solution that passes only visible stream', () => {
  // eur-01 visible stream [2, 5, -3, 0] -> [6, 15, -9, 0]
  // Wrongly build x*2 instead of x*3? No, eur-01 needs 3x, if someone hardcodes +4 on first etc., or uses x + 4 (2->6, 5->9 fails).
  // Use lvl-02: [4, 8, 12] -> [1, 2, 3]. Hardcode x - 3? 4-3=1, 8-3=5 fails.
  // Use eur-02: [4, -1, 0, 9] -> +1. Wrongly doing x + 1 works, whereas doing something on lvl-08: 2(x+3).
  // Suppose on lvl-02 someone builds div2 -> sub1 -> ... wait: on eur-06 (min(x,5)):
  // Visible stream [2, 8, 5, 9, -3] -> [2, 5, 5, 5, -3].
  // A faulty solution that only subtracts 1 ONCE when x > 5 (instead of looping!) passes if x <= 6, or wait:
  // A faulty solution on eur-04 that only divides by 2 ONCE (instead of looping!) for [12, 7, 16, 20] fails on 12/16,
  // while on lvl-02 someone doing straight conveyor passes nothing. On eur-07: [27, 45, 81, 90] ALL have digit sum = 9!
  // A player who ignores input digits on eur-07 and checks hidden [19, 30, 7, 64] -> [10, 3, 7, 10]:
  // Suppose someone divides by 3 and outputs 9-ish, or builds divmod(b=9) vs divmod(b=10):
  // Let's test eur-07 with a fake constant-9 machine (divmod b=9 -> wait, 27/9=3, not 9).
  // Even simpler: on eur-01 if we check a machine that passes visible run of lvl-06 (interval 3) with misaligned delay:
  // Wait: on eur-06, suppose someone uses a chain of 4 `sub1`s inside the gt5 branch instead of a loop: 8->4 (wrong),
  // OR on eur-06 with filter(gt5) + 4x sub1 in a line: 8 (>5) -> 8-4 = 4 (wrong).
  // What about a custom level where visible [2, 4] -> [4, 8] passes with x+2? Wait: x=2 -> 4, x=4 -> 6 fails.
  // Better: x=2 -> 2*2=4 passes x*x AND 2*x! Hidden x=3 -> 6 fails x*x=9!
  // Let's test verifyLevelSolution directly on eur-07 with a solution that outputs [9, 9, 9, 9] (only passes visible run!):
  const eur7 = EUREKA_LEVELS.find((l) => l.id === 'eur-07')!;
  // If we use divmod(b=27) -> no, let's check with a synthetic level that mirrors visible vs hidden:
  const antiCheatLevel: LevelDefinition = {
    ...eur7,
    demoSolution: undefined,
    verificationRuns: [
      {
        name: 'Видимый [2]',
        spawnerOverrides: { '-3,0': { sequence: [2], spawnInterval: 3 } },
        expectedSinkValues: { main: [4] },
      },
      {
        name: 'Скрытый [5]',
        hidden: true,
        spawnerOverrides: { '-3,0': { sequence: [5], spawnInterval: 3 } },
        expectedSinkValues: { main: [10] },
      },
    ],
  };
  // Solution adds +2 (passes 2->4, fails 5->7 != 10!)
  const hardcodedAdd2 = [
    { type: 'add1' as const, coord: { q: -2, r: 0 }, config: { dir: 0 as const } },
    { type: 'add1' as const, coord: { q: -1, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 1, r: 0 }, config: { dir: 0 as const } },
  ];
  const report = verifyLevelSolution(antiCheatLevel, hardcodedAdd2, 60);
  assert.equal(report.passed, 1);
  assert.equal(report.total, 2);
  assert.equal(report.results[0].passed, true);
  assert.equal(report.results[1].passed, false);
});

test('live simulation halts infinite feedback loop at MAX_SIMULATION_TICKS with diagnostic message', () => {
  const infiniteLoopLevel: LevelDefinition = {
    id: 'loop-timeout-test',
    index: 99,
    title: 'Loop Timeout',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['conveyor', 'filter'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [4], loopSequence: false, spawnInterval: 10 },
      },
      // Positive 4 enters filter(positive) -> routed to (0,1) -> (-1,1) -> (-1,0) forever
      {
        type: 'filter',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 1, altDir: 0, filterRule: 'positive' },
      },
      {
        type: 'conveyor',
        coord: { q: -1, r: 1 },
        locked: true,
        config: { dir: 3 },
      },
      {
        type: 'conveyor',
        coord: { q: -2, r: 1 },
        locked: true,
        config: { dir: 5 },
      },
      {
        type: 'sink',
        coord: { q: 1, r: 0 },
        locked: true,
        config: {
          dir: 0,
          sinkId: 'main',
          targetPattern: {
            mode: 'exact',
            nodes: [{ offset: { q: 0, r: 0 }, value: 4 }],
            edges: [],
            rotationInvariant: true,
            label: '[4]',
          },
        },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const world = createWorldFromLevel(infiniteLoopLevel);
  for (let i = 0; i < MAX_SIMULATION_TICKS; i++) {
    stepSimulation(world);
  }
  assert.equal(world.tick, MAX_SIMULATION_TICKS);
  assert.equal(world.status, 'error');
  assert.ok(world.errorReason?.includes('Цикл не завершился'));
  assert.ok(world.errorReason?.includes(`${MAX_SIMULATION_TICKS}`));
  assert.ok(world.errorHighlightHexes.length >= 1);
});

test('divmod records remainder output hex in visitedHexes for area calculation', () => {
  const eur7 = EUREKA_LEVELS.find((l) => l.id === 'eur-07')!;
  const world = createWorldFromLevel(eur7, eur7.demoSolution);
  stepSimulation(world); // spawns 27 onto divmod at (-2,0) -> remTok placed at (-2,1)
  assert.equal(world.visitedHexes.has(hexKey({ q: -2, r: 1 })), true);
  assert.ok(computeWorldArea(world) >= eur7.demoSolution!.length);
});

test('stepSimulation populates Token.moveSource and SimEvent.badge for physics and popups', () => {
  const level: LevelDefinition = {
    id: 'physics-meta',
    index: 99,
    title: 'Physics Meta',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['spawner', 'pusher', 'magnet', 'rotator', 'add1', 'mul2', 'conveyor', 'sink'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -3, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [4], loopSequence: false, spawnInterval: 10 },
      },
      { type: 'add1', coord: { q: -2, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'magnet', coord: { q: 1, r: 0 }, locked: true, config: { dir: 3 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  // Tick 1: spawner emits 4 onto add1 (-2,0) -> +1 => 5, moveSource='spawner'
  stepSimulation(w);
  const tok1 = Array.from(w.tokens.values())[0];
  assert.equal(tok1.value, 5);
  assert.equal(tok1.moveSource, 'spawner');
  assert.ok(w.events.some((e) => e.badge === '+1'));

  // Tick 2: add1 (-2,0) & pusher (-2,1)->dir5 both drive (-2,0) East? No, pusher dir 5 pushes (-1,0)!
  // Let's check: (-2,0) dir 0 moves to (-1,0) via add1 (conveyor source)
  stepSimulation(w);
  assert.deepEqual(tok1.coord, { q: -1, r: 0 });
  assert.equal(tok1.moveSource, 'conveyor');

  // Tick 3: magnet at (1,0) dir 3 pulls (-1,0) -> (0,0), moveSource='magnet'
  stepSimulation(w);
  assert.deepEqual(tok1.coord, { q: 0, r: 0 });
  assert.equal(tok1.moveSource, 'magnet');

  // Tick 4: rotator at (0,1) dir 4 grabs (0,0) and rotates CW to (1,0)? Wait: (1,0) is solid magnet!
  // Let's verify rotator + pusher cleanly on an open line
  const pusherRotLevel: LevelDefinition = {
    id: 'pusher-rot-meta',
    index: 99,
    title: 'Pusher Rot Meta',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['pusher', 'rotator'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'pusher', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'rotator', coord: { q: 1, r: 1 }, locked: true, config: { dir: 4, rotMode: 'ccw' } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const w2 = createWorldFromLevel(pusherRotLevel);
  w2.tokens.set('t1', { id: 't1', value: 7, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  stepSimulation(w2); // pusher pushes (0,0) -> (1,0)
  const pTok = w2.tokens.get('t1')!;
  assert.deepEqual(pTok.coord, { q: 1, r: 0 });
  assert.equal(pTok.moveSource, 'pusher');

  stepSimulation(w2); // rotator at (1,1) grabs (1,0) [dir 4] and rotates CCW
  assert.equal(pTok.moveSource, 'rotator');
  assert.ok(w2.events.some((e) => e.type === 'rotate' && e.badge === '60°↺'));
});

test('splitter alternates outputs round-robin and destroyer safely recycles tokens and bonded polymers', () => {
  const level: LevelDefinition = {
    id: 'splitter-destroyer',
    index: 99,
    title: 'Splitter & Destroyer',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['splitter', 'destroyer', 'conveyor', 'sink'],
    requiredDeliveries: 2,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [10, 20, 30, 40], loopSequence: false, spawnInterval: 2 },
      },
      {
        type: 'splitter',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0, altDir: 1 },
      },
      {
        type: 'destroyer',
        coord: { q: -1, r: 1 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'sink',
        coord: { q: 0, r: 0 },
        locked: true,
        config: {
          dir: 0,
          sinkId: 'main',
          targetPattern: {
            mode: 'exact',
            nodes: [{ offset: { q: 0, r: 0 } }],
            edges: [],
            rotationInvariant: true,
            expectedValues: [10, 30],
            label: '10, 30',
          },
        },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  const res = runUntilComplete(w, 20);
  assert.equal(res.check.passed, true, `Expected pass, got: ${res.check.reason}`);
  assert.deepEqual(res.world.sinkDeliveries['main'], [[10], [30]]);
  assert.ok(res.world.events.some((e) => e.type === 'destroy' && e.badge === '×'));
  assert.ok(res.world.events.some((e) => e.badge === '⇄'));
});

test('out-of-bounds movement records fallingTokens metadata for 3D cliff tumble animation', () => {
  const level: LevelDefinition = {
    id: 'oob-fall',
    index: 99,
    title: 'OOB Fall',
    subtitle: '',
    tier: 'Начальный',
    radius: 1,
    availableTools: ['conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [7], loopSequence: false, spawnInterval: 5 },
      },
      {
        type: 'conveyor',
        coord: { q: 1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  stepSimulation(w); // spawns 7 at (1,0)
  stepSimulation(w); // moves 7 from (1,0) -> (2,0) off radius-1 island!
  assert.equal(w.status, 'error');
  assert.equal(w.fallingTokens?.length, 1);
  assert.equal(w.fallingTokens?.[0].value, 7);
  assert.deepEqual(w.fallingTokens?.[0].fromCoord, { q: 1, r: 0 });
  assert.deepEqual(w.fallingTokens?.[0].toCoord, { q: 2, r: 0 });
});

test('eur-09 splits single 18 via divmod(4) and mul2 into bonded [4 -- 4] without dup', () => {
  const eur9 = EUREKA_LEVELS.find((l) => l.id === 'eur-09')!;
  assert.ok(eur9, 'eur-09 must exist in EUREKA_LEVELS');
  assert.equal(eur9.availableTools.includes('dup'), false, 'duplicator must not be available');

  const w = createWorldFromLevel(eur9, eur9.demoSolution ?? []);
  const res = runUntilComplete(w, 30);
  assert.equal(res.check.passed, true, `Expected eur-09 pass, got: ${res.check.reason}`);
  assert.equal(res.world.tick, 5);
  assert.deepEqual(res.world.sinkDeliveries['main'], [[4, 4]]);
});

