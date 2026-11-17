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
  getRotationSweptHexes,
  matchComponentToPattern,
  runUntilComplete,
  stepSimulation,
  validateLevelPlacement,
  verifyLevelSolution,
} from './hex-engine';
import {
  ALL_PUZZLE_LEVELS,
  CAMPAIGN_LEVELS,
  EUREKA_LEVELS,
  GRADE5_LEVELS,
  IMPOSSIBLE_LEVELS,
  SANDBOX_LEVEL,
} from './levels';
import { hexDistance, hexKey, rotateAroundPivot, rotateAxialOffset } from './hex-math';
import type { LevelDefinition, MachineType, TargetPattern } from './types';
import {
  evaluateMachineActionCurves,
  evaluateTokenTickTimeline,
  evaluateTransportCurve,
} from '../render/tokenAnimationTimeline';

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

test('all Campaign + Eureka + Impossible + Grade5 demo solutions pass simulation, verification runs, and part quotas', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 10);
  assert.equal(EUREKA_LEVELS.length, 9);
  assert.equal(IMPOSSIBLE_LEVELS.length, 5);
  assert.equal(GRADE5_LEVELS.length, 5);
  assert.equal(ALL_PUZZLE_LEVELS.length, 29);
  for (const level of ALL_PUZZLE_LEVELS) {
    assert.ok(level.demoSolution && level.demoSolution.length > 0, `Level ${level.id} missing demoSolution`);
    assert.ok(level.hints && level.hints.length === 3, `Level ${level.id} must have 3 progressive hints`);

    const solutionsToCheck: Array<{
      name: string;
      blocks: NonNullable<typeof level.demoSolution>;
    }> = [
      { name: 'Эталон 1 (demoSolution)', blocks: level.demoSolution },
      ...(level.altDemoSolutions ?? []).map((alt, idx) => ({
        name: `Эталон ${idx + 2} (${alt.label})`,
        blocks: alt.blocks,
      })),
    ];

    for (const sol of solutionsToCheck) {
      const placementErrors = validateLevelPlacement(level, sol.blocks);
      assert.deepEqual(
        placementErrors,
        [],
        `Level ${level.id} ${sol.name} placement invalid: ${placementErrors.join('; ')}`,
      );
      assert.ok(sol.blocks.length > 0, `Level ${level.id} ${sol.name} must not be empty`);
      if (level.maxTotalBlocks !== undefined) {
        assert.ok(
          sol.blocks.length <= level.maxTotalBlocks,
          `Level ${level.id} ${sol.name} (${sol.blocks.length}) exceeds maxTotalBlocks (${level.maxTotalBlocks})`,
        );
      }
      if (level.partLimits) {
        const counts: Partial<Record<MachineType, number>> = {};
        for (const b of sol.blocks) {
          counts[b.type] = (counts[b.type] ?? 0) + 1;
        }
        for (const [mType, limit] of Object.entries(level.partLimits)) {
          const used = counts[mType as MachineType] ?? 0;
          assert.ok(
            used <= (limit ?? Infinity),
            `Level ${level.id} ${sol.name} uses ${used} of ${mType}, limit is ${limit}`,
          );
        }
      }

      const world = createWorldFromLevel(level, sol.blocks);
      const { check } = runUntilComplete(world, 180);
      assert.equal(
        check.passed,
        true,
        `Level ${level.id} (${level.title}) failed ${sol.name}: ${check.reason}`,
      );
      const area = computeWorldArea(world);
      assert.ok(area >= sol.blocks.length, `Area ${area} must cover placed blocks`);

      if (level.verificationRuns) {
        for (const vr of level.verificationRuns) {
          const vw = createWorldFromLevel(
            level,
            sol.blocks,
            vr.spawnerOverrides,
            vr.expectedSinkValues,
            vr.expectedSinkPolymers,
          );
          const vRes = runUntilComplete(vw, 180);
          assert.equal(
            vRes.check.passed,
            true,
            `Level ${level.id} ${sol.name} verificationRun "${vr.name}" failed: ${vRes.check.reason}`,
          );
        }
        const report = verifyLevelSolution(level, sol.blocks, 180);
        assert.equal(
          report.passed,
          report.total,
          `Level ${level.id} ${sol.name} verifyLevelSolution did not pass all runs`,
        );
      }
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
    availableTools: [...new Set([...eur7.availableTools, 'add1' as const, 'conveyor' as const])],
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

test('solution verification rejects forbidden and over-budget placements', () => {
  const level = CAMPAIGN_LEVELS[0];
  const forbidden = [{ type: 'sqrt' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const } }];
  assert.ok(!level.availableTools.includes('sqrt'));
  assert.equal(verifyLevelSolution(level, forbidden).passed, 0);
  assert.match(verifyLevelSolution(level, forbidden).results[0].reason ?? '', /недоступен/);
  const limited = { ...level, maxTotalBlocks: 0 };
  const allowed = [{ type: level.availableTools[0], coord: { q: 0, r: 0 }, config: { dir: 0 as const } }];
  assert.match(verifyLevelSolution(limited, allowed).results[0].reason ?? '', /лимит/);
  for (const [target, blocks] of [[level, forbidden], [limited, allowed]] as const) {
    const world = createWorldFromLevel(target, blocks);
    assert.equal(world.status, 'error');
    assert.equal(runUntilComplete(world).check.passed, false);
    assert.equal(stepSimulation(world).status, 'error');
  }
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

test('Chapter III (Impossible) enforces constraints, chasm separation, fixedDivisor, and post-victory mathReveal', () => {
  assert.equal(IMPOSSIBLE_LEVELS.length, 5);

  for (const lvl of IMPOSSIBLE_LEVELS) {
    assert.equal(lvl.chapter, 'impossible');
    assert.ok(lvl.mathReveal && lvl.mathReveal.steps.length >= 2, `${lvl.id} must define animated mathReveal steps`);
  }

  // imp-01 & imp-02: no duplicator allowed
  const imp1 = IMPOSSIBLE_LEVELS.find((l) => l.id === 'imp-01')!;
  const imp2 = IMPOSSIBLE_LEVELS.find((l) => l.id === 'imp-02')!;
  assert.equal(imp1.availableTools.includes('dup'), false);
  assert.equal(imp2.availableTools.includes('dup'), false);

  // imp-03: top (r <= -1) and bottom (r >= 1) islands are physically separated by distance >= 2 chasm
  const imp3 = IMPOSSIBLE_LEVELS.find((l) => l.id === 'imp-03')!;
  const topHexes = (imp3.customHexes ?? []).filter((c) => c.r <= -1);
  const botHexes = (imp3.customHexes ?? []).filter((c) => c.r >= 1);
  assert.ok(topHexes.length >= 7 && botHexes.length >= 7);
  for (const t of topHexes) {
    for (const b of botHexes) {
      assert.ok(hexDistance(t, b) >= 2, `imp-03 chasm violated between (${t.q},${t.r}) and (${b.q},${b.r})`);
    }
  }
  assert.equal((imp3.customHexes ?? []).some((c) => c.r === 0), false);

  // imp-04: left and right islands only connect via locked filter(negative) at (0,0) and destroyer at (0,1);
  // positive pass-through without double-negation fails immediately into destroyer
  const imp4 = IMPOSSIBLE_LEVELS.find((l) => l.id === 'imp-04')!;
  const straightConveyorOnly = [
    { type: 'conveyor' as const, coord: { q: -2, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: -1, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 1, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 2, r: 0 }, config: { dir: 0 as const } },
  ];
  const imp4CheatReport = verifyLevelSolution(imp4, straightConveyorOnly, 25);
  assert.equal(imp4CheatReport.passed, 0, 'Straight conveyor must be shredded by locked negative filter bridge');

  // imp-05: fixedDivisor: 2 blocks changing divmod divisor to 7 (8 = 7*1 + 1 cheat), and hidden [7, 10] blocks single-spawner tricks
  const imp5 = IMPOSSIBLE_LEVELS.find((l) => l.id === 'imp-05')!;
  assert.equal(imp5.fixedDivisor, 2);
  const cheatDiv7 = [
    { type: 'conveyor' as const, coord: { q: -2, r: 1 }, config: { dir: 5 as const } },
    { type: 'conveyor' as const, coord: { q: -1, r: 0 }, config: { dir: 0 as const } },
    { type: 'divmod' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const, altDir: 5 as const, divisor: 7 } },
    { type: 'welder' as const, coord: { q: 1, r: -1 }, config: { dir: 1 as const } },
    { type: 'conveyor' as const, coord: { q: 1, r: 0 }, config: { dir: 0 as const } },
  ];
  const cheatReport = verifyLevelSolution(imp5, cheatDiv7, 30);
  assert.equal(cheatReport.passed, 0, 'imp-05 must reject divisor=7 bypass via fixedDivisor: 2');
});

test('chained adders compute (2 + 3) + 4 = 9 without ignoring results from earlier adders', () => {
  const level: LevelDefinition = {
    id: 'chained-adders',
    index: 99,
    title: 'Chained Adders',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['adder', 'conveyor', 'sink'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'spawner',
        coord: { q: -3, r: 0 },
        locked: true,
        config: { dir: 0, sequence: [2, 3], loopSequence: false, spawnInterval: 1 },
      },
      {
        type: 'conveyor',
        coord: { q: -2, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'adder',
        coord: { q: -1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'conveyor',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'adder',
        coord: { q: 1, r: 0 },
        locked: true,
        config: { dir: 0 },
      },
      {
        type: 'spawner',
        coord: { q: 1, r: -2 },
        locked: true,
        config: { dir: 1, sequence: [4], loopSequence: false, spawnInterval: 5 },
      },
      {
        type: 'conveyor',
        coord: { q: 1, r: -1 },
        locked: true,
        config: { dir: 1 },
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
            nodes: [{ offset: { q: 0, r: 0 }, value: 9 }],
            edges: [],
            rotationInvariant: true,
            label: '9',
          },
        },
      },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  const res = runUntilComplete(w, 25);
  assert.equal(res.check.passed, true, `Chained adder failed: ${res.check.reason}`);
  assert.deepEqual(res.world.sinkDeliveries['main'], [[9]]);
});

test('adder simultaneous 2-token arrival with non-null memory halts with error instead of overwriting memory', () => {
  const level: LevelDefinition = {
    id: 'adder-mem-collision',
    index: 99,
    title: 'Adder Mem Collision',
    subtitle: '',
    tier: 'Средний',
    radius: 2,
    availableTools: ['adder'],
    requiredDeliveries: 1,
    presetMachines: [
      {
        type: 'adder',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0 },
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
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  w.machines.get(hexKey({ q: 0, r: 0 }))!.state.memory = 5;
  w.tokens.set('a', { id: 'a', value: 2, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  w.tokens.set('b', { id: 'b', value: 3, coord: { q: 0, r: -1 }, prevCoord: { q: 0, r: -1 }, spawnOrder: 2 });
  stepSimulation(w);
  assert.equal(w.status, 'error');
  assert.ok(w.errorReason?.includes('Сумматор'));
});

test('SimEvent.id increases monotonically even after >160 events cap the event ring buffer', () => {
  const w = createWorldFromLevel(SANDBOX_LEVEL, SANDBOX_LEVEL.demoSolution ?? []);
  let lastSeenId = 0;
  for (let i = 0; i < 220; i++) {
    stepSimulation(w);
    const newer = w.events.filter((e) => e.id > lastSeenId);
    for (let j = 1; j < newer.length; j++) {
      assert.ok(newer[j].id > newer[j - 1].id);
    }
    if (newer.length > 0) {
      lastSeenId = newer[newer.length - 1].id;
    }
  }
  assert.equal(w.events.length, 160);
  assert.ok(lastSeenId > 160, `Expected SimEvent.id > 160, got ${lastSeenId}`);
});

test('halver splits even integers equally and halts cleanly on odd integers or bonded polymers', () => {
  const evenLevel: LevelDefinition = {
    id: 'halver-test',
    index: 99,
    title: 'Halver',
    subtitle: '',
    tier: 'Начальный',
    radius: 2,
    availableTools: ['halver'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'conveyor', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'halver', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, altDir: 1 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const wEven = createWorldFromLevel(evenLevel);
  wEven.tokens.set('t1', { id: 't1', value: 10, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  stepSimulation(wEven);
  assert.equal(wEven.status, 'running');
  const toks = Array.from(wEven.tokens.values());
  assert.equal(toks.length, 2);
  assert.equal(toks[0].value, 5);
  assert.equal(toks[1].value, 5);
  assert.ok(toks.some((t) => t.coord.q === 0 && t.coord.r === 0));
  assert.ok(toks.some((t) => t.coord.q === 0 && t.coord.r === 1));

  const wOdd = createWorldFromLevel(evenLevel);
  wOdd.tokens.set('t1', { id: 't1', value: 7, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  stepSimulation(wOdd);
  assert.equal(wOdd.status, 'error');
  assert.ok(wOdd.errorReason?.toLowerCase().includes('раскольник'));

  const wPoly = createWorldFromLevel(evenLevel);
  wPoly.tokens.set('t1', { id: 't1', value: 4, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  wPoly.tokens.set('t2', { id: 't2', value: 6, coord: { q: -1, r: 1 }, prevCoord: { q: -1, r: 1 }, spawnOrder: 2 });
  wPoly.bonds.push({ a: 't1', b: 't2' });
  stepSimulation(wPoly);
  assert.equal(wPoly.status, 'error');
  assert.ok(wPoly.errorReason?.includes('Раскольник'));
});

test('swapper exchanges opposing spheres 180 degrees cleanly and jumper leaps 2 hexes over obstacle', () => {
  const level: LevelDefinition = {
    id: 'swap-jump-test',
    index: 99,
    title: 'Swap & Jump',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['swapper', 'jumper'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'swapper', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'jumper', coord: { q: -2, r: 1 }, locked: true, config: { dir: 0 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const w = createWorldFromLevel(level);
  w.tokens.set('left', { id: 'left', value: 11, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  w.tokens.set('right', { id: 'right', value: 22, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 2 });
  w.tokens.set('leap', { id: 'leap', value: 33, coord: { q: -2, r: 1 }, prevCoord: { q: -2, r: 1 }, spawnOrder: 3 });
  stepSimulation(w);

  assert.equal(w.status, 'running');
  assert.deepEqual(w.tokens.get('left')?.coord, { q: 1, r: 0 });
  assert.deepEqual(w.tokens.get('right')?.coord, { q: -1, r: 0 });
  assert.ok(Math.abs((w.tokens.get('left')?.rotatedFrom?.angleDelta ?? 0) - Math.PI) < 0.001);
  assert.deepEqual(w.tokens.get('leap')?.coord, { q: 0, r: 1 });
  assert.equal(w.tokens.get('leap')?.moveSource, 'jump');

  // Bonded polymer attempting to jump must halt with explicit error
  const wBond = createWorldFromLevel(level);
  wBond.tokens.set('b1', { id: 'b1', value: 1, coord: { q: -2, r: 1 }, prevCoord: { q: -2, r: 1 }, spawnOrder: 1 });
  wBond.tokens.set('b2', { id: 'b2', value: 2, coord: { q: -2, r: 2 }, prevCoord: { q: -2, r: 2 }, spawnOrder: 2 });
  wBond.bonds.push({ a: 'b1', b: 'b2' });
  stepSimulation(wBond);
  assert.equal(wBond.status, 'error');
  assert.ok(wBond.errorReason?.toLowerCase().includes('трамплин'));
});

test('scales compares two numbers (max straight, min altDir) and flags equal inputs', () => {
  const level: LevelDefinition = {
    id: 'scales-test',
    index: 99,
    title: 'Scales',
    subtitle: '',
    tier: 'Средний',
    radius: 2,
    availableTools: ['scales'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'conveyor', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'conveyor', coord: { q: 0, r: -1 }, locked: true, config: { dir: 1 } },
      { type: 'scales', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, altDir: 1 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  // Sequential: 4 enters -> stored; then 9 enters -> max=9 at (0,0), min=4 at (0,1)
  const wSeq = createWorldFromLevel(level);
  wSeq.tokens.set('a', { id: 'a', value: 4, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  stepSimulation(wSeq);
  assert.equal(wSeq.status, 'running');
  assert.equal(wSeq.machines.get(hexKey({ q: 0, r: 0 }))?.state.memory, 4);

  wSeq.tokens.set('b', { id: 'b', value: 9, coord: { q: 0, r: -1 }, prevCoord: { q: 0, r: -1 }, spawnOrder: 2 });
  stepSimulation(wSeq);
  assert.equal(wSeq.status, 'running');
  assert.equal(wSeq.tokens.get('b')?.value, 9);
  assert.deepEqual(wSeq.tokens.get('b')?.coord, { q: 0, r: 0 });
  const minTok = Array.from(wSeq.tokens.values()).find((t) => t.id !== 'b');
  assert.equal(minTok?.value, 4);
  assert.deepEqual(minTok?.coord, { q: 0, r: 1 });

  // Simultaneous equal inputs -> explicit error
  const wEq = createWorldFromLevel(level);
  wEq.tokens.set('a', { id: 'a', value: 7, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  wEq.tokens.set('b', { id: 'b', value: 7, coord: { q: 0, r: -1 }, prevCoord: { q: 0, r: -1 }, spawnOrder: 2 });
  stepSimulation(wEq);
  assert.equal(wEq.status, 'error');
  assert.ok(wEq.errorReason?.includes('равны'));
});

test('narrowGap tiles drop isolated spheres but support bonded polymers while anchored, plus beam_balance & growth_ladder patterns', () => {
  // Single sphere on narrowGap falls; bonded polymer survives; cutting it drops unsupported sphere
  const gapLevel: LevelDefinition = {
    id: 'gap-physics',
    index: 99,
    title: 'Gap Physics',
    subtitle: '',
    tier: 'Средний',
    radius: 2,
    narrowGaps: [{ q: 1, r: 0 }],
    availableTools: ['conveyor', 'laser'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'conveyor', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  const wSingle = createWorldFromLevel(gapLevel);
  wSingle.tokens.set('s1', { id: 's1', value: 5, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  stepSimulation(wSingle);
  assert.equal(wSingle.status, 'error');
  assert.equal(wSingle.fallingTokens?.length, 1);

  const wBridge = createWorldFromLevel(gapLevel);
  wBridge.tokens.set('p1', { id: 'p1', value: 4, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  wBridge.tokens.set('p2', { id: 'p2', value: 4, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 2 });
  wBridge.bonds.push({ a: 'p1', b: 'p2' });
  stepSimulation(wBridge); // moves [4--4] to (0,0)--(1,0) over narrowGap!
  assert.equal(wBridge.status, 'running');

  // beam_balance & growth_ladder matching
  const balWorld = createWorldFromLevel(gapLevel);
  balWorld.tokens.set('L', { id: 'L', value: 3, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  balWorld.tokens.set('M', { id: 'M', value: 6, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 2 });
  balWorld.tokens.set('R', { id: 'R', value: 3, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 3 });
  balWorld.bonds.push({ a: 'L', b: 'M' }, { a: 'M', b: 'R' });
  const balPat: TargetPattern = {
    mode: 'beam_balance',
    nodes: [{ offset: { q: -1, r: 0 } }, { offset: { q: 0, r: 0 } }, { offset: { q: 1, r: 0 } }],
    edges: [{ fromIdx: 0, toIdx: 1 }, { fromIdx: 1, toIdx: 2 }],
    rotationInvariant: true,
    label: 'L = R',
  };
  assert.equal(
    matchComponentToPattern({ id: 'L', tokenIds: ['L', 'M', 'R'], bondIndices: [0, 1] }, balWorld, { q: 0, r: 0 }, balPat).matched,
    true,
  );
  balWorld.tokens.get('M')!.value = 7;
  assert.equal(
    matchComponentToPattern({ id: 'L', tokenIds: ['L', 'M', 'R'], bondIndices: [0, 1] }, balWorld, { q: 0, r: 0 }, balPat).matched,
    false,
  );

  const ladPat: TargetPattern = {
    mode: 'growth_ladder',
    ladderStep: { op: 'add', value: 2 },
    nodes: [{ offset: { q: -1, r: 0 } }, { offset: { q: 0, r: 0 } }, { offset: { q: 1, r: 0 } }],
    edges: [{ fromIdx: 0, toIdx: 1 }, { fromIdx: 1, toIdx: 2 }],
    rotationInvariant: false,
    label: '+2',
  };
  balWorld.tokens.get('L')!.value = 2;
  balWorld.tokens.get('M')!.value = 4;
  balWorld.tokens.get('R')!.value = 6;
  assert.equal(
    matchComponentToPattern({ id: 'L', tokenIds: ['L', 'M', 'R'], bondIndices: [0, 1] }, balWorld, { q: 0, r: 0 }, ladPat).matched,
    true,
  );
});

test('Chapter III imp-04 anti-bypass and Chapter IV Grade5 anti-bypass checks enforce authentic solutions', () => {
  // imp-04: naive neg -> filter -> neg without separating negative vs positive fails on mixed inputs [4, -5, 9, -2]
  const imp4 = IMPOSSIBLE_LEVELS.find((l) => l.id === 'imp-04')!;
  const naiveDoubleNeg = [
    { type: 'conveyor' as const, coord: { q: -2, r: 0 }, config: { dir: 0 as const } },
    { type: 'neg' as const, coord: { q: -1, r: 0 }, config: { dir: 0 as const } },
    { type: 'neg' as const, coord: { q: 1, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 2, r: 0 }, config: { dir: 0 as const } },
  ];
  assert.equal(
    verifyLevelSolution(imp4, naiveDoubleNeg, 40).passed,
    0,
    'imp-04 must reject naive inline neg -> neg bypass on negative inputs',
  );

  // g5-01: trying to send an unwelded single sphere across narrowGap (1,0) must fail
  const g51 = GRADE5_LEVELS.find((l) => l.id === 'g5-01')!;
  const singleWalk = [
    { type: 'conveyor' as const, coord: { q: -2, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: -1, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const } },
  ];
  const wg51 = createWorldFromLevel(g51, singleWalk);
  runUntilComplete(wg51, 20);
  assert.equal(wg51.status, 'error');
  assert.ok((wg51.fallingTokens?.length ?? 0) >= 1, 'Single sphere must fall into g5-01 narrowGap');

  // g5-02: wrong 60-degree orientation over sink fails rotationInvariant: false keyhole
  const g52 = GRADE5_LEVELS.find((l) => l.id === 'g5-02')!;
  const sinkPat = g52.presetMachines.find((m) => m.type === 'sink')!.config.targetPattern!;
  const wg52 = createWorldFromLevel(g52);
  // Target requires (0,-1)=2, (0,0)=4, (-1,1)=2 relative to sink(1,0).
  // Rotate by 60° CW around (1,0): (1,-1)->(2,-1), (1,0)->(1,0), (0,1)->(0,0)
  wg52.tokens.set('k1', { id: 'k1', value: 2, coord: { q: 2, r: -1 }, prevCoord: { q: 2, r: -1 }, spawnOrder: 1 });
  wg52.tokens.set('k2', { id: 'k2', value: 4, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 2 });
  wg52.tokens.set('k3', { id: 'k3', value: 2, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 3 });
  wg52.bonds.push({ a: 'k1', b: 'k2' }, { a: 'k2', b: 'k3' });
  assert.equal(
    matchComponentToPattern({ id: 'k1', tokenIds: ['k1', 'k2', 'k3'], bondIndices: [0, 1] }, wg52, { q: 1, r: 0 }, sinkPat).matched,
    false,
    'g5-02 keyhole must reject unaligned rotation',
  );

  // g5-04: open 2-edge triangle (missing 3rd bond) with sum 12 is rejected by 3-edge closed triangle sink
  const g54 = GRADE5_LEVELS.find((l) => l.id === 'g5-04')!;
  const triPat = g54.presetMachines.find((m) => m.type === 'sink')!.config.targetPattern!;
  const wg54 = createWorldFromLevel(g54);
  wg54.tokens.set('a', { id: 'a', value: 6, coord: { q: 1, r: -1 }, prevCoord: { q: 1, r: -1 }, spawnOrder: 1 });
  wg54.tokens.set('b', { id: 'b', value: 3, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 2 });
  wg54.tokens.set('c', { id: 'c', value: 3, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 3 });
  wg54.bonds.push({ a: 'a', b: 'b' }, { a: 'b', b: 'c' }); // only 2 edges!
  assert.equal(
    matchComponentToPattern({ id: 'a', tokenIds: ['a', 'b', 'c'], bondIndices: [0, 1] }, wg54, { q: 1, r: 0 }, triPat).matched,
    false,
    'g5-04 closed triangle sink must reject 2-edge open chain',
  );
  wg54.bonds.push({ a: 'a', b: 'c' }); // 3rd closing edge!
  assert.equal(
    matchComponentToPattern({ id: 'a', tokenIds: ['a', 'b', 'c'], bondIndices: [0, 1, 2] }, wg54, { q: 1, r: 0 }, triPat).matched,
    true,
  );

  // g5-05: straight conveyor bypassing parity filter+sub1 must fail on locked div2(0,0) chasm bridge
  const g55 = GRADE5_LEVELS.find((l) => l.id === 'g5-05')!;
  const q0Hexes = (g55.customHexes ?? []).filter((c) => c.q === 0);
  assert.deepEqual(q0Hexes, [{ q: 0, r: 0 }], 'g5-05 chasm must leave only (0,0) crossing');
  const straight55 = [
    { type: 'conveyor' as const, coord: { q: -2, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: -1, r: 0 }, config: { dir: 0 as const } },
    { type: 'conveyor' as const, coord: { q: 1, r: 0 }, config: { dir: 0 as const } },
  ];
  assert.equal(
    verifyLevelSolution(g55, straight55, 30).passed,
    0,
    'g5-05 must reject straight line without odd-number parity handling',
  );
});

test('Chapter IV Grade 5 levels expose complete 4-line briefings, 3-tier hints, mathReveal, and explainQuestion', () => {
  assert.equal(GRADE5_LEVELS.length, 5);
  for (const lvl of GRADE5_LEVELS) {
    assert.ok(lvl.briefing, `${lvl.id} must define 4-line briefing`);
    assert.ok(lvl.briefing!.intro && lvl.briefing!.intro.length >= 10);
    assert.ok(lvl.briefing!.example.includes('→'), `${lvl.id} briefing.example must show Before → After`);
    assert.ok(lvl.briefing!.catch.length >= 10);
    assert.ok(lvl.briefing!.secret.length >= 10);

    assert.equal(lvl.hints?.length, 3, `${lvl.id} must have 3-tier hints`);
    assert.ok(lvl.mathReveal && lvl.mathReveal.steps.length >= 2, `${lvl.id} must define mathReveal`);

    assert.ok(lvl.explainQuestion, `${lvl.id} must define post-victory explainQuestion`);
    assert.ok(lvl.explainQuestion!.options.length >= 2);
    assert.ok(
      lvl.explainQuestion!.correctIdx >= 0 &&
        lvl.explainQuestion!.correctIdx < lvl.explainQuestion!.options.length,
    );
    assert.ok(lvl.explainQuestion!.explanation.length >= 10);
  }
});

test('Actuator > Belt thrust hierarchy overrides passive belts without false conflict while enforcing same-tier conflicts', () => {
  const overrideLevel: LevelDefinition = {
    id: 'tier-override',
    index: 99,
    title: 'Tier Override',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['conveyor', 'pusher', 'rotator', 'magnet'],
    requiredDeliveries: 1,
    presetMachines: [
      // Token at (0,0) on conveyor facing East (dir=0), but Pusher at (0,1) dir=4 pushes North-West to (0,-1)
      { type: 'conveyor', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'pusher', coord: { q: 0, r: 1 }, locked: true, config: { dir: 4 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wPusherWins = createWorldFromLevel(overrideLevel);
  wPusherWins.tokens.set('t1', { id: 't1', value: 5, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  stepSimulation(wPusherWins);
  assert.equal(wPusherWins.status, 'running');
  assert.deepEqual(wPusherWins.tokens.get('t1')?.coord, { q: 0, r: -1 });
  assert.equal(wPusherWins.tokens.get('t1')?.moveSource, 'pusher');

  // Rotator overriding passive conveyor on bonded polymer
  const rotOverrideLevel: LevelDefinition = {
    ...overrideLevel,
    id: 'rot-override',
    presetMachines: [
      { type: 'conveyor', coord: { q: 1, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'rotator', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, rotMode: 'cw' } },
    ],
  };
  const wRotWins = createWorldFromLevel(rotOverrideLevel);
  wRotWins.tokens.set('r1', { id: 'r1', value: 7, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 1 });
  stepSimulation(wRotWins);
  assert.equal(wRotWins.status, 'running');
  assert.equal(wRotWins.tokens.get('r1')?.moveSource, 'rotator');
  assert.deepEqual(wRotWins.tokens.get('r1')?.coord, { q: 0, r: 1 });

  // Same-tier Actuator vs Actuator conflict (Pusher vs Rotator) must still trigger THRUST_CONFLICT
  const conflictLevel: LevelDefinition = {
    ...overrideLevel,
    id: 'tier2-conflict',
    presetMachines: [
      { type: 'pusher', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'rotator', coord: { q: 0, r: 1 }, locked: true, config: { dir: 4, rotMode: 'cw' } },
    ],
  };
  const wConflict = createWorldFromLevel(conflictLevel);
  wConflict.tokens.set('c1', { id: 'c1', value: 9, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  stepSimulation(wConflict);
  assert.equal(wConflict.status, 'error');
  assert.ok(wConflict.errorReason?.includes('Конфликт векторов тяги'));
});

test('pusher moves aligned trains up to 3 spheres (overriding opposing conveyor) and errors on 4-sphere overload', () => {
  const trainLevel: LevelDefinition = {
    id: 'pusher-chain',
    index: 99,
    title: 'Pusher Chain',
    subtitle: '',
    tier: 'Средний',
    radius: 4,
    availableTools: ['pusher', 'conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'pusher', coord: { q: -2, r: 0 }, locked: true, config: { dir: 0 } },
      // Middle sphere sits on an opposing West-facing conveyor (dir=3), pusher overpowers the whole train!
      { type: 'conveyor', coord: { q: 0, r: 0 }, locked: true, config: { dir: 3 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };

  // 3 aligned spheres: (-1,0), (0,0), (1,0) -> all advance East with pushChainIndex 0, 1, 2
  const w3 = createWorldFromLevel(trainLevel);
  w3.tokens.set('a', { id: 'a', value: 1, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  w3.tokens.set('b', { id: 'b', value: 2, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 2 });
  w3.tokens.set('c', { id: 'c', value: 3, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 3 });
  stepSimulation(w3);
  assert.equal(w3.status, 'running');
  assert.deepEqual(w3.tokens.get('a')?.coord, { q: 0, r: 0 });
  assert.deepEqual(w3.tokens.get('b')?.coord, { q: 1, r: 0 });
  assert.deepEqual(w3.tokens.get('c')?.coord, { q: 2, r: 0 });
  assert.equal(w3.tokens.get('a')?.pushChainIndex, 0);
  assert.equal(w3.tokens.get('b')?.pushChainIndex, 1);
  assert.equal(w3.tokens.get('c')?.pushChainIndex, 2);

  // 4 aligned spheres -> triggers pusher overload error
  const w4 = createWorldFromLevel(trainLevel);
  w4.tokens.set('a', { id: 'a', value: 1, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  w4.tokens.set('b', { id: 'b', value: 2, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 2 });
  w4.tokens.set('c', { id: 'c', value: 3, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 3 });
  w4.tokens.set('d', { id: 'd', value: 4, coord: { q: 2, r: 0 }, prevCoord: { q: 2, r: 0 }, spawnOrder: 4 });
  stepSimulation(w4);
  assert.equal(w4.status, 'error');
  assert.ok(w4.errorReason?.includes('Перегрузка толкателя'));
});

test('rotator swept-arc geometry detects solid housings & external spheres on radius-2 arcs while distance-1 orbits cleanly', () => {
  // Distance 1 around (0,0) has empty swept intermediate hexes
  assert.deepEqual(getRotationSweptHexes({ q: 1, r: 0 }, { q: 0, r: 0 }, 1), []);
  // Distance 2 around (0,0) from (2,0) CW to (0,2) sweeps through (1,1)
  const swept2 = getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1);
  assert.ok(
    swept2.some((h) => h.q === 1 && h.r === 1),
    `Expected swept sector through (1,1), got ${JSON.stringify(swept2)}`,
  );

  // Solid machine at (1,1) blocks CW sweep of bonded polymer (1,0)--(2,0) rotated around (0,0)
  const blockedArcLevel: LevelDefinition = {
    id: 'rot-arc-solid',
    index: 99,
    title: 'Rotator Arc Solid',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['rotator', 'pusher'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'rotator', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, rotMode: 'cw' } },
      { type: 'pusher', coord: { q: 1, r: 1 }, locked: true, config: { dir: 0 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wSolidArc = createWorldFromLevel(blockedArcLevel);
  wSolidArc.tokens.set('t1', { id: 't1', value: 2, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 1 });
  wSolidArc.tokens.set('t2', { id: 't2', value: 4, coord: { q: 2, r: 0 }, prevCoord: { q: 2, r: 0 }, spawnOrder: 2 });
  wSolidArc.bonds.push({ a: 't1', b: 't2' });
  stepSimulation(wSolidArc);
  assert.equal(wSolidArc.status, 'error');
  assert.ok(wSolidArc.errorReason?.includes('дуге поворота'));

  // External sphere parked inside (1,1) also collides on the swept arc even though final dest is (0,2)
  const extArcLevel: LevelDefinition = {
    ...blockedArcLevel,
    presetMachines: [
      { type: 'rotator', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, rotMode: 'cw' } },
    ],
  };
  const wExtArc = createWorldFromLevel(extArcLevel);
  wExtArc.tokens.set('t1', { id: 't1', value: 2, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 1 });
  wExtArc.tokens.set('t2', { id: 't2', value: 4, coord: { q: 2, r: 0 }, prevCoord: { q: 2, r: 0 }, spawnOrder: 2 });
  wExtArc.bonds.push({ a: 't1', b: 't2' });
  wExtArc.tokens.set('blocker', { id: 'blocker', value: 9, coord: { q: 1, r: 1 }, prevCoord: { q: 1, r: 1 }, spawnOrder: 3 });
  stepSimulation(wExtArc);
  assert.equal(wExtArc.status, 'error');
  assert.ok(wExtArc.errorReason?.includes('дуге поворота'));
});

test('side-port machines (dup, divmod, halver, scales) pause cleanly while altDir is occupied by another sphere, then auto-resume and detect permanent deadlocks', () => {
  // 1) Duplicator pauses when altDir=(0,1) holds a moving sphere on conveyor, then completes on next tick
  const dupQueueLevel: LevelDefinition = {
    id: 'dup-queue',
    index: 99,
    title: 'Dup Queue',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['dup', 'conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'spawner', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0, sequence: [6], loopSequence: false, spawnInterval: 5 } },
      { type: 'dup', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, altDir: 1 } },
      // Sphere at (1,0) moves West? No, hold blocker at (0,1) via a 1-tick conveyor delay:
      // Put conveyor at (0,1) -> East (1,1), but spawn blocker at (-1,1) moving East onto (0,1) on tick 1!
      { type: 'spawner', coord: { q: -1, r: 1 }, locked: true, config: { dir: 0, sequence: [9], loopSequence: false, spawnInterval: 5 } },
      { type: 'conveyor', coord: { q: 0, r: 1 }, locked: true, config: { dir: 1 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wDup = createWorldFromLevel(dupQueueLevel);
  // Tick 1: both 6 at (0,0) and 9 at (0,1) spawn! So (0,1) is occupied -> dup pauses 6 in place!
  stepSimulation(wDup);
  assert.equal(wDup.status, 'running');
  assert.equal(wDup.tokens.size, 2);
  const held6 = Array.from(wDup.tokens.values()).find((t) => t.value === 6)!;
  assert.deepEqual(held6.coord, { q: 0, r: 0 });
  assert.ok(held6.waitingSidePort);
  assert.equal(wDup.machines.get(hexKey({ q: 0, r: 0 }))?.state.isWaitingSideExit, true);
  assert.ok(wDup.events.some((e) => e.badge === '⏳'));

  // Tick 2: 9 moves from (0,1) -> (0,2), freeing (0,1) -> dup holds 6 on (0,0) while emitting copy 6 onto (0,1)!
  stepSimulation(wDup);
  assert.equal(wDup.status, 'running');
  assert.equal(held6.waitingSidePort, undefined);
  assert.equal(wDup.machines.get(hexKey({ q: 0, r: 0 }))?.state.isWaitingSideExit, false);
  const copy6 = Array.from(wDup.tokens.values()).find((t) => t.id !== held6.id && t.value === 6);
  assert.ok(copy6);
  assert.deepEqual(copy6!.coord, { q: 0, r: 1 });

  // 2) Divmod preserves original value (does not double-divide!) while waiting for altDir to clear
  const divQueueLevel: LevelDefinition = {
    id: 'divmod-queue',
    index: 99,
    title: 'Divmod Queue',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['divmod', 'conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'spawner', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0, sequence: [7], loopSequence: false, spawnInterval: 5 } },
      { type: 'divmod', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, altDir: 1, divisor: 3 } },
      { type: 'spawner', coord: { q: -1, r: 1 }, locked: true, config: { dir: 0, sequence: [99], loopSequence: false, spawnInterval: 5 } },
      { type: 'conveyor', coord: { q: 0, r: 1 }, locked: true, config: { dir: 1 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wDiv = createWorldFromLevel(divQueueLevel);
  stepSimulation(wDiv); // Tick 1: 7 waits unmutated on divmod
  assert.equal(wDiv.status, 'running');
  const held7 = Array.from(wDiv.tokens.values()).find((t) => t.coord.q === 0 && t.coord.r === 0)!;
  assert.equal(held7.value, 7, 'Token must remain unmutated while paused in side-port queue');
  stepSimulation(wDiv); // Tick 2: blocker moves -> 7 = 3*2 + 1 executes cleanly!
  assert.equal(wDiv.status, 'running');
  assert.equal(held7.value, 2);
  const rem1 = Array.from(wDiv.tokens.values()).find((t) => t.coord.q === 0 && t.coord.r === 1);
  assert.equal(rem1?.value, 1);

  // 3) Halver & Scales queue + deadlock detection when blocker never moves
  const deadlockLevel: LevelDefinition = {
    id: 'halver-deadlock',
    index: 99,
    title: 'Halver Deadlock',
    subtitle: '',
    tier: 'Средний',
    radius: 2,
    availableTools: ['halver'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'spawner', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0, sequence: [8], loopSequence: false, spawnInterval: 5 } },
      { type: 'halver', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, altDir: 1 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wDead = createWorldFromLevel(deadlockLevel);
  // Static un-driven sphere sitting permanently at (0,1)
  wDead.tokens.set('parked', { id: 'parked', value: 42, coord: { q: 0, r: 1 }, prevCoord: { q: 0, r: 1 }, spawnOrder: 0 });
  stepSimulation(wDead); // Tick 1: 8 spawns onto (0,0) and enters waitingSidePort (⏳)
  assert.equal(wDead.status, 'running');
  stepSimulation(wDead); // Tick 2: zero movement/drive -> detects permanent deadlock!
  assert.equal(wDead.status, 'error');
  assert.ok(wDead.errorReason?.includes('Затор на боковом выходе'));

  // Scales waiting on occupied altDir then resolving cleanly
  const scalesQueueLevel: LevelDefinition = {
    id: 'scales-queue',
    index: 99,
    title: 'Scales Queue',
    subtitle: '',
    tier: 'Средний',
    radius: 3,
    availableTools: ['scales', 'conveyor'],
    requiredDeliveries: 1,
    presetMachines: [
      { type: 'scales', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0, altDir: 1 } },
      { type: 'conveyor', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0 } },
      { type: 'conveyor', coord: { q: 0, r: 1 }, locked: true, config: { dir: 1 } },
    ],
    pedagogyNote: '',
    bonusGoalText: '',
  };
  const wScales = createWorldFromLevel(scalesQueueLevel);
  wScales.machines.get(hexKey({ q: 0, r: 0 }))!.state.memory = 4;
  wScales.tokens.set('s2', { id: 's2', value: 9, coord: { q: -1, r: 0 }, prevCoord: { q: -1, r: 0 }, spawnOrder: 1 });
  wScales.tokens.set('blocker', { id: 'blocker', value: 1, coord: { q: -1, r: 1 }, prevCoord: { q: -1, r: 1 }, spawnOrder: 2 });
  // Move blocker onto (0,1) via an extra conveyor at (-1,1)->East
  wScales.machines.set(hexKey({ q: -1, r: 1 }), {
    id: 'm_blk',
    type: 'conveyor',
    coord: { q: -1, r: 1 },
    locked: true,
    config: { dir: 0 },
    state: { spawnIndex: 0, cooldown: 0, memory: null, activeFlashTicks: 0, lastActionTick: -1 },
  });
  stepSimulation(wScales); // Tick 1: s2=9 arrives at scales while blocker arrives at (0,1) -> scales waits!
  assert.equal(wScales.status, 'running');
  assert.equal(wScales.machines.get(hexKey({ q: 0, r: 0 }))?.state.isWaitingSideExit, true);
  stepSimulation(wScales); // Tick 2: blocker clears to (0,2) -> scales emits 9 on (0,0) and 4 on (0,1)!
  assert.equal(wScales.status, 'running');
  assert.equal(wScales.tokens.get('s2')?.value, 9);
  const smallOut = Array.from(wScales.tokens.values()).find((t) => t.coord.q === 0 && t.coord.r === 1);
  assert.equal(smallOut?.value, 4);
});

test('3D timeline & transport curves preserve domino cascading, jumper arc squash/stretch, and damped machine settling', () => {
  const tl0 = evaluateTokenTickTimeline({
    alpha: 0.18,
    isMoving: true,
    moveSource: 'pusher',
    pushChainIndex: 0,
    hasAccent: false,
  });
  const tl2 = evaluateTokenTickTimeline({
    alpha: 0.18,
    isMoving: true,
    moveSource: 'pusher',
    pushChainIndex: 2,
    hasAccent: false,
  });
  assert.ok(tl0.moveT > tl2.moveT, 'Leading pushed sphere moves slightly ahead of 3rd sphere in domino wave');

  const tlSettled = evaluateTokenTickTimeline({
    alpha: 0.43,
    isMoving: true,
    moveSource: 'pusher',
    pushChainIndex: 2,
    hasAccent: false,
  });
  assert.equal(tlSettled.moveT, 1);

  const jumpAscent = evaluateTransportCurve(0.14, 'jump');
  const jumpApex = evaluateTransportCurve(0.5, 'jump');
  const jumpLand = evaluateTransportCurve(0.9, 'jump');
  assert.ok(jumpApex.hop > 0.75, 'Jumper reaches high parabolic apex');
  assert.ok(jumpAscent.stretchY > 1, 'Jumper stretches vertically on launch');
  assert.ok(jumpLand.stretchY < 1 && jumpLand.stretchXZ > 1, 'Jumper squashes smoothly on touchdown');

  const actImpact = evaluateMachineActionCurves(0.56, true);
  const actReturn = evaluateMachineActionCurves(0.99, true);
  assert.ok(actImpact.stroke > 0.95);
  assert.ok(Math.abs(actReturn.stroke) < 0.08);
});




