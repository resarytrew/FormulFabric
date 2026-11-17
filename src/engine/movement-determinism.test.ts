/**
 * Инвариант D — детерминированность относительно порядка хранения объектов.
 *
 * Две копии мира отличаются ТОЛЬКО порядком вставки в world.machines и
 * world.tokens. Сравнивается не порядок массивов, а канонический снимок
 * физического состояния: координаты, значения, связи, состояния механизмов,
 * доставки и результат уровня (см. snapshotPhysicalState в audit-kit).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel, stepSimulation } from './hex-engine';
import { ALL_PUZZLE_LEVELS } from './levels';
import { generateHexDisk, hexKey, hexNeighbor } from './hex-math';
import {
  addToken,
  assertMatchesRule,
  auditLevel,
  bondTokens,
  documentedViolations,
  formatViolationTable,
  levelWithPresets,
  mulberry32,
  preset,
  reverseStorageOrder,
  snapshotPhysicalState,
  snapshotTokenIdsByCoord,
  tokensAt,
} from './audit-kit';
import type { AxialCoord, LevelDefinition, MachineType, SimulationWorld } from './types';

interface RunOutcome {
  states: string[];
  /** Идентификаторы новых сфер по координатам — тоже обязаны совпадать. */
  ids: string[];
  finalStatus: string;
  finalTick: number;
}

/** Прогоняет мир до терминального состояния, складывая канонический снимок каждого такта. */
function runAndRecord(world: SimulationWorld, maxTicks = 180): RunOutcome {
  const states: string[] = [snapshotPhysicalState(world)];
  const ids: string[] = [snapshotTokenIdsByCoord(world)];
  for (let tick = 0; tick < maxTicks; tick++) {
    if (world.status === 'victory' || world.status === 'error') break;
    stepSimulation(world);
    states.push(snapshotPhysicalState(world));
    ids.push(snapshotTokenIdsByCoord(world));
  }
  return { states, ids, finalStatus: world.status, finalTick: world.tick };
}

function assertSameRun(forward: RunOutcome, reverse: RunOutcome, label: string): void {
  assert.equal(reverse.states.length, forward.states.length, `${label}: разная длина прогона`);
  for (let i = 0; i < forward.states.length; i++) {
    assert.equal(reverse.states[i], forward.states[i], `${label}: состояние разошлось на такте ${i}`);
    assert.equal(reverse.ids[i], forward.ids[i], `${label}: идентификаторы сфер разошлись на такте ${i}`);
  }
  assert.equal(reverse.finalStatus, forward.finalStatus, `${label}: разный итог уровня`);
  assert.equal(reverse.finalTick, forward.finalTick, `${label}: разное число тактов`);
}

// ---------------------------------------------------------------------------
// D: эталонные решения всех уровней
// ---------------------------------------------------------------------------

test('D: all 29 puzzle levels, every reference solution and verification stream are storage-order independent', () => {
  let solutionRuns = 0;
  let verificationRuns = 0;
  let victories = 0;

  for (const level of ALL_PUZZLE_LEVELS) {
    const solutions: Array<{ name: string; blocks: NonNullable<LevelDefinition['demoSolution']> }> = [];
    if (level.demoSolution?.length) solutions.push({ name: 'Эталон 1', blocks: level.demoSolution });
    for (const alt of level.altDemoSolutions ?? []) solutions.push({ name: alt.label, blocks: alt.blocks });
    assert.ok(solutions.length > 0, `${level.id}: нет эталонного решения для аудита`);

    for (const solution of solutions) {
      interface Stream {
        name: string;
        overrides?: Record<string, { sequence: number[]; spawnInterval?: number }>;
        values?: Record<string, number[]>;
        polymers?: Record<string, number[][]>;
      }
      const streams: Stream[] = [{ name: 'основной поток' }];
      for (const run of level.verificationRuns ?? []) {
        streams.push({
          name: run.name,
          overrides: run.spawnerOverrides,
          values: run.expectedSinkValues,
          polymers: run.expectedSinkPolymers,
        });
      }

      for (const stream of streams) {
        const forwardWorld = createWorldFromLevel(level, solution.blocks, stream.overrides, stream.values, stream.polymers);
        const reversedWorld = reverseStorageOrder(createWorldFromLevel(level, solution.blocks, stream.overrides, stream.values, stream.polymers));
        const forward = runAndRecord(forwardWorld);
        const reversed = runAndRecord(reversedWorld);
        assertSameRun(forward, reversed, `${level.id} / ${solution.name} / ${stream.name}`);
        if (stream.name === 'основной поток') solutionRuns += 1;
        else verificationRuns += 1;
        if (forward.finalStatus === 'victory') victories += 1;
      }
    }
  }

  assert.ok(solutionRuns >= ALL_PUZZLE_LEVELS.length, `прогонов эталонов: ${solutionRuns}`);
  assert.ok(victories > 0, 'хотя бы часть эталонов должна доходить до победы');
  assert.ok(verificationRuns > 0, 'дополнительные проверочные потоки должны участвовать в аудите');
});

// ---------------------------------------------------------------------------
// D: синтетические конфигурации
// ---------------------------------------------------------------------------

test('D: two sources, bonded polymers, competing pushers and a rotator stay identical under reversed storage order', () => {
  const scenarios: Array<{ name: string; build: (reverse: boolean) => SimulationWorld }> = [
    {
      name: 'два источника на двух линиях с приёмниками',
      build: (reverse) => {
        const anySink = (q: number, r: number, sinkId: string) =>
          preset('sink', q, r, {
            dir: 0,
            sinkId,
            targetPattern: { mode: 'exact', nodes: [{ offset: { q: 0, r: 0 } }], edges: [], rotationInvariant: false, label: '[*]' },
          });
        const presets = [
          preset('spawner', -3, 1, { dir: 0, sequence: [2, 4], loopSequence: false, spawnInterval: 2 }),
          preset('spawner', -3, -1, { dir: 0, sequence: [3, 5], loopSequence: false, spawnInterval: 2 }),
          preset('conveyor', -2, 1, { dir: 0 }),
          preset('conveyor', -1, 1, { dir: 0 }),
          preset('conveyor', -2, -1, { dir: 0 }),
          preset('conveyor', -1, -1, { dir: 0 }),
          anySink(0, 1, 'top'),
          anySink(0, -1, 'bottom'),
        ];
        return createWorldFromLevel(levelWithPresets('D-two-sources', reverse ? [...presets].reverse() : presets, {
          radius: 5,
          requiredDeliveries: 4,
        }));
      },
    },
    {
      name: 'связанный полимер на двух конвейерах',
      build: (reverse) => {
        const presets = [
          preset('conveyor', 0, 0, { dir: 0 }),
          preset('conveyor', 0, -1, { dir: 1 }),
        ];
        const world = createWorldFromLevel(levelWithPresets('D-polymer', reverse ? [...presets].reverse() : presets, { radius: 4 }));
        addToken(world, 'p1', 4, 0, 0, 1);
        addToken(world, 'p2', 6, 0, -1, 2);
        bondTokens(world, 'p1', 'p2');
        if (reverse) reverseStorageOrder(world);
        return world;
      },
    },
    {
      name: 'конкурирующие толкатели',
      build: (reverse) => {
        const presets = [
          preset('pusher', -2, 0, { dir: 0 }),
          preset('pusher', 0, 1, { dir: 4 }),
          preset('conveyor', 0, 0, { dir: 0 }),
        ];
        const world = createWorldFromLevel(levelWithPresets('D-pushers', reverse ? [...presets].reverse() : presets, { radius: 5 }));
        addToken(world, 'a', 3, -1, 0, 1);
        addToken(world, 'b', 4, 0, 0, 2);
        if (reverse) reverseStorageOrder(world);
        return world;
      },
    },
    {
      name: 'ротатор и полимер',
      build: (reverse) => {
        const world = createWorldFromLevel(levelWithPresets('D-rotator', [
          preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
        ], { radius: 5 }));
        addToken(world, 'near', 1, 1, 0, 1);
        addToken(world, 'far', 2, 2, 0, 2);
        bondTokens(world, 'near', 'far');
        if (reverse) reverseStorageOrder(world);
        return world;
      },
    },
    {
      name: 'столкновение встречного обмена',
      build: (reverse) => {
        const presets = [
          preset('conveyor', 0, 0, { dir: 0 }),
          preset('conveyor', 1, 0, { dir: 3 }),
        ];
        const world = createWorldFromLevel(levelWithPresets('D-head-on', reverse ? [...presets].reverse() : presets, { radius: 4 }));
        addToken(world, 'l', 1, 0, 0, 1);
        addToken(world, 'r', 2, 1, 0, 2);
        if (reverse) reverseStorageOrder(world);
        return world;
      },
    },
    {
      name: 'два входа в сумматор',
      build: (reverse) => {
        const presets = [
          preset('conveyor', -1, 0, { dir: 0 }),
          preset('conveyor', 0, -1, { dir: 1 }),
          preset('adder', 0, 0, { dir: 0 }),
        ];
        const world = createWorldFromLevel(levelWithPresets('D-adder', reverse ? [...presets].reverse() : presets, { radius: 4 }));
        addToken(world, 'x', 3, -1, 0, 1);
        addToken(world, 'y', 7, 0, -1, 2);
        if (reverse) reverseStorageOrder(world);
        return world;
      },
    },
  ];

  for (const scenario of scenarios) {
    const forward = runAndRecord(scenario.build(false));
    const reversed = runAndRecord(scenario.build(true));
    assertSameRun(forward, reversed, scenario.name);
  }
});

test('D: 200 seeded random worlds are identical under reversed storage order', () => {
  const TYPES: MachineType[] = [
    'conveyor', 'conveyor', 'add1', 'sub1', 'mul2', 'div2', 'sqrt', 'neg', 'dup', 'adder', 'filter',
    'splitter', 'divmod', 'halver', 'scales', 'jumper', 'pusher', 'magnet', 'rotator', 'swapper',
    'welder', 'laser', 'destroyer', 'sink',
  ];

  const buildPair = (seed: number): { level: LevelDefinition; tokens: Array<{ id: string; value: number; coord: AxialCoord; bondTo?: string }> } => {
    const rnd = mulberry32(seed);
    const radius = 3 + Math.floor(rnd() * 3);
    const hexes = generateHexDisk(radius);
    const used: AxialCoord[] = [];
    const presets: Array<{ type: MachineType; coord: AxialCoord; config: Record<string, unknown> }> = [];
    const machineCount = 2 + Math.floor(rnd() * 8);
    for (let i = 0; i < machineCount; i++) {
      const hex = hexes[Math.floor(rnd() * hexes.length)];
      if (used.some((h) => hexKey(h) === hexKey(hex))) continue;
      used.push(hex);
      const type = TYPES[Math.floor(rnd() * TYPES.length)];
      const dir = Math.floor(rnd() * 6);
      const config: Record<string, unknown> = { dir };
      if (type === 'filter') {
        config.altDir = (dir + 1) % 6;
        config.filterRule = 'even';
      }
      if (type === 'splitter' || type === 'scales' || type === 'halver' || type === 'dup') config.altDir = (dir + 1) % 6;
      if (type === 'divmod') config.divisor = 2;
      if (type === 'rotator') config.rotMode = rnd() < 0.5 ? 'cw' : 'ccw';
      presets.push({ type, coord: hex, config });
    }
    const level = auditLevel({
      id: `D-fuzz-${seed}`,
      radius,
      presetMachines: presets.map((p) => ({
        type: p.type,
        coord: { ...p.coord },
        locked: true,
        config: p.config as never,
      })),
    });

    const probe = createWorldFromLevel(level);
    const solid = new Set([...probe.machines.values()].map((m) => hexKey(m.coord)));
    const free = [...probe.platformHexes]
      .filter((key) => !solid.has(key))
      .map((key) => {
        const [q, r] = key.split(',').map(Number);
        return { q, r };
      });
    const tokens: Array<{ id: string; value: number; coord: AxialCoord; bondTo?: string }> = [];
    const tokenCount = 1 + Math.floor(rnd() * 5);
    for (let i = 0; i < tokenCount; i++) {
      if (tokens.length > 0 && rnd() < 0.5) {
        const base = tokens[Math.floor(rnd() * tokens.length)];
        const next = hexNeighbor(base.coord, Math.floor(rnd() * 6) as 0 | 1 | 2 | 3 | 4 | 5);
        const key = hexKey(next);
        if (!probe.platformHexes.has(key) || solid.has(key) || tokens.some((t) => hexKey(t.coord) === key)) continue;
        tokens.push({ id: `t${tokens.length + 1}`, value: 1 + Math.floor(rnd() * 9), coord: next, bondTo: base.id });
        continue;
      }
      const hex = free[Math.floor(rnd() * free.length)];
      if (!hex || tokens.some((t) => hexKey(t.coord) === hexKey(hex))) continue;
      tokens.push({ id: `t${tokens.length + 1}`, value: 1 + Math.floor(rnd() * 9), coord: hex });
    }
    return { level, tokens };
  };

  const materialize = (level: LevelDefinition, tokens: ReturnType<typeof buildPair>['tokens'], reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    if (world.status === 'error') return world;
    for (const tok of tokens) {
      addToken(world, tok.id, tok.value, tok.coord.q, tok.coord.r, Number(tok.id.slice(1)));
      if (tok.bondTo) bondTokens(world, tok.bondTo, tok.id);
    }
    return reverse ? reverseStorageOrder(world) : world;
  };

  let compared = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { level, tokens } = buildPair(seed);
    const probe = createWorldFromLevel(level);
    if (probe.status === 'error') continue;
    const forward = materialize(level, tokens, false);
    const reversed = materialize(level, tokens, true);
    const forwardRun = runAndRecord(forward, 40);
    const reversedRun = runAndRecord(reversed, 40);
    assertSameRun(forwardRun, reversedRun, `seed ${seed}`);
    compared += 1;
  }
  assert.ok(compared > 150, `сравнено миров: ${compared}`);
});

// ---------------------------------------------------------------------------
// Задокументированные расхождения по идентификаторам и диагностике
// ---------------------------------------------------------------------------

test('ids: two sources spawning in the same tick allocate the same token ids under reversed storage order', () => {
  const level = levelWithPresets('D-two-sources-ids', [
    preset('spawner', -2, 0, { dir: 0, sequence: [2], loopSequence: false, spawnInterval: 5 }),
    preset('spawner', 0, -2, { dir: 1, sequence: [3], loopSequence: false, spawnInterval: 5 }),
  ], { radius: 4 });

  const forward = createWorldFromLevel(level);
  const reversed = reverseStorageOrder(createWorldFromLevel(level));
  stepSimulation(forward);
  stepSimulation(reversed);

  assertMatchesRule(tokensAt(forward), tokensAt(reversed), 'координаты и значения не должны зависеть от порядка');
  // Источники обрабатываются в порядке координат: (-2, 0) → выход (-1, 0) раньше (0, -2) → (0, -1).
  assertMatchesRule('-1,0=t_1;0,-1=t_2', snapshotTokenIdsByCoord(forward));
  assertMatchesRule(snapshotTokenIdsByCoord(forward), snapshotTokenIdsByCoord(reversed), 'идентификаторы не зависят от порядка');
});

test('ids: transformer outputs are numbered in canonical order within one tick, independent of Map order', () => {
  // Дубликатор, делитель и раскольник срабатывают в одном такте: копия, остаток
  // и половина получают t_N по стабильному порядку событий создания, а не по
  // порядку обхода world.tokens / world.machines.
  const level = levelWithPresets('D-transformer-ids', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('dup', 0, 0, { dir: 0, altDir: 4 }),
    preset('conveyor', -1, 2, { dir: 0 }),
    preset('divmod', 0, 2, { dir: 0, altDir: 4, divisor: 2 }),
    preset('conveyor', -1, 4, { dir: 0 }),
    preset('halver', 0, 4, { dir: 0, altDir: 4 }),
  ], { radius: 6 });

  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    addToken(world, 'a', 2, -1, 0, 1);
    addToken(world, 'b', 5, -1, 2, 2);
    addToken(world, 'c', 8, -1, 4, 3);
    return reverse ? reverseStorageOrder(world) : world;
  };

  const forward = build(false);
  const reversed = build(true);
  stepSimulation(forward);
  stepSimulation(reversed);

  assertMatchesRule(tokensAt(forward), tokensAt(reversed), 'физика не должна зависеть от порядка');
  const expectedIds = '0,-1=t_1;0,0=a;0,1=t_2;0,2=b;0,3=t_3;0,4=c';
  assertMatchesRule(expectedIds, snapshotTokenIdsByCoord(forward));
  assertMatchesRule(snapshotTokenIdsByCoord(forward), snapshotTokenIdsByCoord(reversed), 'идентификаторы не зависят от порядка');

  const transformLog = (world: SimulationWorld) =>
    world.events.filter((e) => e.type === 'transform').map((e) => `${e.coord.q},${e.coord.r}:${e.message}`);
  assertMatchesRule(transformLog(forward), transformLog(reversed), 'порядок событий преобразований стабилен');
});

const adderPresets = (): ReturnType<typeof preset>[] => [
  preset('conveyor', -1, 0, { dir: 0 }),
  preset('conveyor', 0, -1, { dir: 1 }),
  preset('adder', 0, 0, { dir: 0 }),
];

function adderWorld(reverse: boolean, tokens: Array<[string, number, number, number, number]>): SimulationWorld {
  const world = createWorldFromLevel(levelWithPresets('D-adder-survivor', adderPresets(), { radius: 4 }));
  for (const [id, value, q, r, order] of tokens) addToken(world, id, value, q, r, order);
  return reverse ? reverseStorageOrder(world) : world;
}

test('adder: simultaneous arrival keeps the older sphere (smaller spawnOrder) and prints the operands stably', () => {
  const tokens: Array<[string, number, number, number, number]> = [
    ['x', 3, -1, 0, 1],
    ['y', 7, 0, -1, 2],
  ];
  const forward = adderWorld(false, tokens);
  const reversed = adderWorld(true, tokens);
  stepSimulation(forward);
  stepSimulation(reversed);

  assertMatchesRule('10@0,0', tokensAt(forward), 'арифметика не меняется: 3 + 7 = 10');
  assertMatchesRule(tokensAt(forward), tokensAt(reversed));
  assertMatchesRule(['x'], [...forward.tokens.keys()], 'выживает сфера с меньшим spawnOrder');
  assertMatchesRule([...forward.tokens.keys()], [...reversed.tokens.keys()], 'выжившая сфера не зависит от порядка хранения');

  const transformLog = (world: SimulationWorld) =>
    world.events.filter((e) => e.type === 'transform').map((e) => e.message);
  assertMatchesRule(['Сумматор Σ: 3 + 7 = 10'], transformLog(forward));
  assertMatchesRule(transformLog(forward), transformLog(reversed), 'порядок слагаемых в сообщении стабилен');

  const merged = (world: SimulationWorld) => (world.consumedTokens ?? []).map((t) => `${t.id}:${t.value}:${t.kind}`);
  assertMatchesRule(['y:7:merge'], merged(forward));
  assertMatchesRule(merged(forward), merged(reversed), 'журнал поглощённых сфер стабилен');
});

test('adder: the survivor follows spawnOrder first, so a late-created id never wins over the older sphere', () => {
  // Идентификаторы сознательно противоречат spawnOrder: 'a' создана позже (9),
  // 'z' — раньше (2). Сохраняться должна 'z', независимо от Map и от id.
  const tokens: Array<[string, number, number, number, number]> = [
    ['a', 3, -1, 0, 9],
    ['z', 7, 0, -1, 2],
  ];
  const forward = adderWorld(false, tokens);
  const reversed = adderWorld(true, tokens);
  stepSimulation(forward);
  stepSimulation(reversed);

  assertMatchesRule('10@0,0', tokensAt(forward));
  assertMatchesRule(['z'], [...forward.tokens.keys()]);
  assertMatchesRule([...forward.tokens.keys()], [...reversed.tokens.keys()]);
  assertMatchesRule(
    ['Сумматор Σ: 7 + 3 = 10'],
    forward.events.filter((e) => e.type === 'transform').map((e) => e.message),
    'слагаемые печатаются в порядке (выжившая, поглощённая)',
  );
});

test('adder: arrivals in different ticks keep the stored value, then produce the same sum and message', () => {
  const tokens: Array<[string, number, number, number, number]> = [
    ['x', 3, -1, 0, 1],
    ['y', 7, 0, -1, 2],
  ];
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(levelWithPresets('D-adder-sequential', [
      preset('conveyor', -1, 0, { dir: 0 }),
      preset('conveyor', 0, -2, { dir: 1 }),
      preset('conveyor', 0, -1, { dir: 1 }),
      preset('adder', 0, 0, { dir: 0 }),
    ], { radius: 4 }));
    addToken(world, 'y', 7, 0, -2, 2);
    addToken(world, 'x', 3, -1, 0, 1);
    return reverse ? reverseStorageOrder(world) : world;
  };

  const forward = build(false);
  const reversed = build(true);
  stepSimulation(forward);
  stepSimulation(reversed);

  // Первый такт: одно слагаемое уходит в память сумматора, второе ещё в пути.
  assertMatchesRule(3, forward.machines.get('0,0')!.state.memory, 'первое слагаемое сохранено');
  assertMatchesRule(tokensAt(forward), tokensAt(reversed));
  assertMatchesRule('7@0,-1', tokensAt(forward));

  stepSimulation(forward);
  stepSimulation(reversed);

  assertMatchesRule('10@0,0', tokensAt(forward));
  assertMatchesRule(tokensAt(forward), tokensAt(reversed));
  assertMatchesRule(null, forward.machines.get('0,0')!.state.memory, 'память освобождена после сложения');
  const log = (world: SimulationWorld) => world.events.filter((e) => e.type === 'transform' || e.type === 'store').map((e) => e.message);
  assertMatchesRule(
    ['Сумматор Σ сохранил первое слагаемое: 3', 'Сумматор Σ: 3 + 7 = 10'],
    log(forward),
  );
  assertMatchesRule(log(forward), log(reversed), 'диагностика последовательного приёма стабильна');
});

test('scales: simultaneous input sorts stably and keeps the sphere with the smaller spawnOrder', () => {
  const tokens: Array<[string, number, number, number, number]> = [
    ['x', 4, -1, 0, 1],
    ['y', 9, 0, -1, 2],
  ];
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(levelWithPresets('D-scales-survivor', [
      preset('conveyor', -1, 0, { dir: 0 }),
      preset('conveyor', 0, -1, { dir: 1 }),
      preset('scales', 0, 0, { dir: 0, altDir: 4 }),
    ], { radius: 4 }));
    for (const [id, value, q, r, order] of tokens) addToken(world, id, value, q, r, order);
    return reverse ? reverseStorageOrder(world) : world;
  };
  const forward = build(false);
  const reversed = build(true);
  stepSimulation(forward);
  stepSimulation(reversed);

  assertMatchesRule(tokensAt(forward), tokensAt(reversed), 'физика не зависит от порядка');
  // Выживает 'x' (меньший spawnOrder), а половина уходит на боковой выход.
  assertMatchesRule(['t_1=4@0,-1', 'x=9@0,0'], world_ids(forward));
  assertMatchesRule(world_ids(forward), world_ids(reversed), 'идентификаторы новых сфер стабильны');
  const log = (world: SimulationWorld) => world.events.filter((e) => e.type === 'transform').map((e) => e.message);
  assertMatchesRule(['Весы ⚖: 9 > 4'], log(forward));
  assertMatchesRule(log(forward), log(reversed));
});

function world_ids(world: SimulationWorld): string[] {
  return [...world.tokens.values()].map((t) => `${t.id}=${t.value}@${t.coord.q},${t.coord.r}`).sort();
}

test('collisions: two independent collisions in one tick report the conflict hex with the smaller coordinate', () => {
  const level = levelWithPresets('D-two-collisions', [
    preset('conveyor', 0, 0, { dir: 0 }),
    preset('conveyor', 1, -1, { dir: 1 }),
    preset('conveyor', 3, 0, { dir: 0 }),
    preset('conveyor', 4, -1, { dir: 1 }),
  ], { radius: 5 });

  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    const tokens: Array<[string, number, number, number, number]> = [
      ['a', 1, 0, 0, 1],
      ['b', 2, 1, -1, 2],
      ['c', 3, 3, 0, 3],
      ['d', 4, 4, -1, 4],
    ];
    for (const [id, value, q, r, order] of reverse ? [...tokens].reverse() : tokens) {
      addToken(world, id, value, q, r, order);
    }
    return reverse ? reverseStorageOrder(world) : world;
  };

  const forward = build(false);
  const reversed = build(true);
  stepSimulation(forward);
  stepSimulation(reversed);

  // Обе пары накладываются в одном такте: (1,0) и (4,0). Такт отвергается в
  // любом порядке, а сообщение обязано указывать меньший гекс.
  assertMatchesRule('error', forward.status);
  assertMatchesRule('error', reversed.status);
  assertMatchesRule(tokensAt(forward), tokensAt(reversed), 'сферы не двигаются в обоих прогонах');
  assertMatchesRule('Столкновение 2 числовых сфер на гексе (1, 0)', forward.errorReason ?? '');
  assertMatchesRule(forward.errorReason, reversed.errorReason, 'диагностика не зависит от порядка хранения');
  assertMatchesRule([{ q: 1, r: 0 }], forward.errorHighlightHexes);
  assertMatchesRule(forward.errorHighlightHexes, reversed.errorHighlightHexes, 'подсветка не зависит от порядка хранения');
});

test('collisions: only the second conflict present still reports its own hex, so the decision never changes', () => {
  // Контроль: тот же мир без первой пары. Стабилизация выбора не должна
  // «переключать» решение — оставшийся конфликт (4,0) обязан быть обнаружен.
  const level = levelWithPresets('D-one-collision', [
    preset('conveyor', 3, 0, { dir: 0 }),
    preset('conveyor', 4, -1, { dir: 1 }),
  ], { radius: 5 });
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    addToken(world, 'c', 3, 3, 0, 3);
    addToken(world, 'd', 4, 4, -1, 4);
    return reverse ? reverseStorageOrder(world) : world;
  };
  for (const reverse of [false, true]) {
    const world = build(reverse);
    stepSimulation(world);
    assertMatchesRule('error', world.status);
    assertMatchesRule('Столкновение 2 числовых сфер на гексе (4, 0)', world.errorReason ?? '');
  }
});

test('collisions: the class priority of checks is preserved when several violations share one tick', () => {
  // Край платформы важнее наложения: (3,0) → (4,0) падает за платформу radius 3,
  // одновременно две ленты сводят сферы в (1,0).
  const edgeAndOverlap = levelWithPresets('D-edge-priority', [
    preset('conveyor', 3, 0, { dir: 0 }),
    preset('conveyor', 0, 0, { dir: 0 }),
    preset('conveyor', 1, -1, { dir: 1 }),
  ], { radius: 3 });
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(edgeAndOverlap);
    addToken(world, 'faller', 9, 3, 0, 3);
    addToken(world, 'a', 1, 0, 0, 1);
    addToken(world, 'b', 2, 1, -1, 2);
    return reverse ? reverseStorageOrder(world) : world;
  };
  for (const reverse of [false, true]) {
    const world = build(reverse);
    stepSimulation(world);
    assertMatchesRule('error', world.status);
    assertMatchesRule(
      'Падение за край платформы в точке (4, 0)',
      world.errorReason ?? '',
      `край платформы обязан проверяться раньше наложения (reverse=${reverse})`,
    );
  }

  // Встречный обмен важнее наложения: пара (a,b) меняется местами, а (c,d)
  // одновременно претендуют на один гекс.
  const swapAndOverlap = levelWithPresets('D-swap-priority', [
    preset('conveyor', -2, 0, { dir: 0 }),
    preset('conveyor', -1, 0, { dir: 3 }),
    preset('conveyor', 0, 1, { dir: 1 }),
    preset('conveyor', 0, 3, { dir: 4 }),
  ], { radius: 4 });
  const buildSwap = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(swapAndOverlap);
    addToken(world, 'p', 1, -2, 0, 1);
    addToken(world, 'q', 2, -1, 0, 2);
    addToken(world, 'r', 3, 0, 1, 3);
    addToken(world, 's', 4, 0, 3, 4);
    return reverse ? reverseStorageOrder(world) : world;
  };
  for (const reverse of [false, true]) {
    const world = buildSwap(reverse);
    stepSimulation(world);
    assertMatchesRule('error', world.status);
    assertMatchesRule(
      'Встречное столкновение сфер при обмене соседними гексами',
      world.errorReason ?? '',
      `встречный обмен обязан проверяться раньше наложения (reverse=${reverse})`,
    );
  }
});

test('events: flash and transform event order is stable under reversed storage order', () => {
  // Два независимых преобразования в одном такте: порядок событий и вспышек
  // задаётся каноническим обходом, а не порядком Map.
  const level = levelWithPresets('D-event-order', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('add1', 0, 0, { dir: 0 }),
    preset('conveyor', -1, 2, { dir: 0 }),
    preset('mul2', 0, 2, { dir: 0 }),
  ], { radius: 4 });
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    addToken(world, 'a', 2, -1, 0, 1);
    addToken(world, 'b', 3, -1, 2, 2);
    return reverse ? reverseStorageOrder(world) : world;
  };
  const forward = build(false);
  const reversed = build(true);
  for (let tick = 0; tick < 3; tick++) {
    stepSimulation(forward);
    stepSimulation(reversed);
  }
  const eventLog = (world: SimulationWorld) =>
    world.events.map((e) => `${e.id}:${e.tick}:${e.type}:${e.coord.q},${e.coord.r}:${e.message}`);
  assertMatchesRule(eventLog(forward), eventLog(reversed));
  const state = (world: SimulationWorld) =>
    sortedMachinesOf(world).map((m) => `${m.type}@${m.coord.q},${m.coord.r}:flash=${m.state.activeFlashTicks}:last=${m.state.lastActionTick}`);
  assertMatchesRule(state(forward), state(reversed), 'состояния механизмов стабильны');
});

function sortedMachinesOf(world: SimulationWorld) {
  return [...world.machines.values()].sort((a, b) =>
    a.coord.q - b.coord.q || a.coord.r - b.coord.r,
  );
}

// ---------------------------------------------------------------------------
// Сводка аудита
// ---------------------------------------------------------------------------

test('audit summary: no documented divergence remains in the determinism suite', () => {
  const rows = documentedViolations();
  // Все расхождения этого файла исправлены в PR #4B; реестр обязан быть пустым,
  // иначе тест снова начал бы «документировать» дефект вместо проверки правила.
  assert.deepEqual(rows.map((v) => v.id).sort(), []);
  console.log(`\n=== Аудит инвариантов движения: расхождения (${rows.length}) ===\n${formatViolationTable()}\n`);
});
