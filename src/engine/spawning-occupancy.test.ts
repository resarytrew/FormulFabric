/**
 * PR #4C, задача B: индекс занятости выходов источников.
 *
 * `activateSpawners` проверяет занятость выходного гекса по локальному
 * `Set<HexKey>` вместо перебора всех сфер на каждый источник. Здесь собраны:
 *
 *  - эталонная реализация ПРЕЖНЕГО поведения (перебор всех сфер через
 *    `Array.from(world.tokens.values()).some(...)`), независимая от движка;
 *  - сценарные проверки из таблицы C2: пустой выход, занятый выход, гекс,
 *    освобождённый движением в этом такте, общий выход двух и трёх источников,
 *    независимые источники, ожидание без потери значения, обратный порядок
 *    `world.machines`;
 *  - воспроизводимый фаззинг (`mulberry32`) с попарным сравнением старой и
 *    новой реализаций и сравнением прямого/обратного порядка хранения.
 *
 * Сравниваются не только координаты: `spawnIndex`, `cooldown`,
 * `activeFlashTicks`, `lastActionTick`, `nextTokenId`, `nextSpawnOrder`,
 * идентификаторы и `spawnOrder` новых сфер, журнал событий и подсветка ошибок.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneWorld, createWorldFromLevel, stepSimulation } from './hex-engine';
import { activateSpawners } from './spawning';
import { sortedMachines } from './deterministic-order';
import { pushEvent, triggerError } from './events';
import { hexEqual, hexKey, hexNeighbor } from './hex-math';
import { isInRange } from './operations';
import { SOLID_MACHINE_TYPES } from './world';
import {
  addToken,
  auditLevel,
  levelWithPresets,
  mulberry32,
  preset,
  reverseStorageOrder,
  snapshotPhysicalState,
  tokensAt,
} from './audit-kit';
import type { PresetSpec } from './audit-kit';
import type { SimulationWorld, Token } from './types';

// ---------------------------------------------------------------------------
// Эталон: реализация `activateSpawners` до PR #4C (перебор всех сфер)
// ---------------------------------------------------------------------------

/**
 * Независимая копия прежнего алгоритма. Намеренно повторяет старый код
 * дословно, включая `Array.from(world.tokens.values()).some(...)`: сравнение
 * идёт с ним, а не с оптимизированной функцией самого движка.
 */
function activateSpawnersBeforePR4C(world: SimulationWorld, movedTokenIds: Set<string>): boolean {
  for (const machine of sortedMachines(world)) {
    if (machine.type !== 'spawner') continue;
    const seq = machine.config.sequence ?? [];
    if (seq.length === 0) continue;

    if (machine.state.cooldown > 0) {
      machine.state.cooldown -= 1;
      continue;
    }

    if (machine.state.spawnIndex >= seq.length) {
      if (machine.config.loopSequence) {
        machine.state.spawnIndex = 0;
      } else {
        continue;
      }
    }

    const spawnCoord = hexNeighbor(machine.coord, machine.config.dir);
    const spawnKey = hexKey(spawnCoord);
    if (!world.platformHexes.has(spawnKey)) {
      triggerError(
        world,
        'Источник направлен за пределы платформы',
        [machine.coord, spawnCoord],
        'error',
      );
      return false;
    }

    const spawnDestMachine = world.machines.get(spawnKey);
    if (spawnDestMachine && SOLID_MACHINE_TYPES.has(spawnDestMachine.type)) {
      triggerError(
        world,
        `Источник направлен внутрь корпуса механизма (${spawnDestMachine.type})`,
        [machine.coord, spawnCoord],
        'collision',
      );
      return false;
    }

    const occupied = Array.from(world.tokens.values()).some((t) =>
      hexEqual(t.coord, spawnCoord),
    );
    if (occupied) {
      pushEvent(world, {
        type: 'blocked',
        coord: spawnCoord,
        message: 'Выход источника занят — ожидание освобождения гекса',
        severity: 'warning',
      });
      continue;
    }

    const val = seq[machine.state.spawnIndex];
    if (!isInRange(val, world.minValue, world.maxValue)) {
      triggerError(
        world,
        `Входное значение ${val} выходит за допустимый диапазон [${world.minValue}, ${world.maxValue}]`,
        [machine.coord],
        'error',
      );
      return false;
    }

    const newTok: Token = {
      id: `t_${world.nextTokenId++}`,
      value: val,
      prevValue: val,
      coord: { ...spawnCoord },
      prevCoord: { ...machine.coord },
      moveSource: 'spawner',
      spawnOrder: world.nextSpawnOrder++,
    };
    world.tokens.set(newTok.id, newTok);
    movedTokenIds.add(newTok.id);
    machine.state.spawnIndex += 1;
    machine.state.cooldown = Math.max(0, (machine.config.spawnInterval ?? 2) - 1);
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;

    pushEvent(world, {
      type: 'spawn',
      coord: spawnCoord,
      message: `Выпущено число ${val}`,
      severity: 'info',
    });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Полный снимок фазы источников
// ---------------------------------------------------------------------------

function spawnPhaseSnapshot(
  world: SimulationWorld,
  movedTokenIds: Set<string>,
  ok: boolean,
): Record<string, unknown> {
  return {
    ok,
    tokens: [...world.tokens.values()]
      .map(
        (t) =>
          `${t.id}|${t.value}|${hexKey(t.coord)}|prev=${hexKey(t.prevCoord)}|order=${t.spawnOrder}|src=${t.moveSource ?? '-'}`,
      )
      .sort(),
    machines: sortedMachines(world).map(
      (m) =>
        `${hexKey(m.coord)}|${m.type}|spawnIndex=${m.state.spawnIndex}|cooldown=${m.state.cooldown}|` +
        `flash=${m.state.activeFlashTicks}|lastAction=${m.state.lastActionTick}`,
    ),
    events: world.events.map(
      (e) => `${e.id}|${e.tick}|${e.type}|${hexKey(e.coord)}|${e.message}|${e.severity}`,
    ),
    nextTokenId: world.nextTokenId,
    nextSpawnOrder: world.nextSpawnOrder,
    moved: [...movedTokenIds].sort(),
    status: world.status,
    errorReason: world.errorReason,
    highlight: world.errorHighlightHexes.map(hexKey),
  };
}

/** Прогон новой и прежней реализации на одинаковом состоянии. */
function comparePhase(world: SimulationWorld, label: string): Record<string, unknown> {
  const optimizedWorld = world;
  const referenceWorld = cloneWorld(world);
  const optimizedMoved = new Set<string>();
  const referenceMoved = new Set<string>();
  const optimizedOk = activateSpawners(optimizedWorld, optimizedMoved);
  const referenceOk = activateSpawnersBeforePR4C(referenceWorld, referenceMoved);

  const optimized = spawnPhaseSnapshot(optimizedWorld, optimizedMoved, optimizedOk);
  const reference = spawnPhaseSnapshot(referenceWorld, referenceMoved, referenceOk);
  assert.deepEqual(optimized, reference, `${label}: индекс занятости и перебор разошлись`);
  return optimized;
}

/** Один и тот же мир в двух порядках хранения: снимок обязан совпасть. */
function compareStorageOrders(world: SimulationWorld, label: string): Record<string, unknown> {
  const forward = comparePhase(cloneWorld(world), `${label} (прямой порядок)`);
  const reversed = comparePhase(reverseStorageOrder(cloneWorld(world)), `${label} (обратный порядок)`);
  assert.deepEqual(reversed, forward, `${label}: результат зависит от порядка хранения механизмов`);
  return forward;
}

function countEvents(snapshot: Record<string, unknown>, type: string): number {
  const events = snapshot.events as string[];
  return events.filter((e) => e.split('|')[2] === type).length;
}

const spawner = (
  q: number,
  r: number,
  dir: number,
  sequence: number[],
  spawnInterval: number,
  loopSequence = false,
): PresetSpec => preset('spawner', q, r, { dir: dir as never, sequence, spawnInterval, loopSequence });

// ---------------------------------------------------------------------------
// C2: сценарии таблицы
// ---------------------------------------------------------------------------

test('spawn occupancy: a free exit releases the next value of the sequence', () => {
  const world = createWorldFromLevel(
    levelWithPresets('C2-free-exit', [spawner(-1, 0, 0, [2, 4], 1)], { radius: 3 }),
  );
  world.tick = 1;

  const snapshot = compareStorageOrders(world, 'пустой выход');

  assert.deepEqual(snapshot.moved, ['t_1']);
  assert.deepEqual(snapshot.tokens, ['t_1|2|0,0|prev=-1,0|order=1|src=spawner']);
  assert.equal(snapshot.nextTokenId, 2);
  assert.equal(snapshot.nextSpawnOrder, 2);
  assert.ok((snapshot.machines as string[])[0].includes('spawnIndex=1'), 'индекс последовательности сдвинулся');
  assert.ok((snapshot.machines as string[])[0].includes('cooldown=0'), 'интервал 1 не оставляет перезарядки');
  assert.equal(countEvents(snapshot, 'spawn'), 1);
  assert.equal(countEvents(snapshot, 'blocked'), 0);
});

test('spawn occupancy: an exit held by an immobile sphere keeps the source waiting without spending its value', () => {
  const world = createWorldFromLevel(
    levelWithPresets('C2-blocked-exit', [spawner(-1, 0, 0, [7], 2)], { radius: 3 }),
  );
  world.tick = 1;
  addToken(world, 'fixed', 5, 0, 0, 1);

  const snapshot = compareStorageOrders(world, 'занятый выход');

  assert.deepEqual(snapshot.moved, [], 'новая сфера не создаётся');
  assert.equal((snapshot.tokens as string[]).length, 1);
  assert.equal(countEvents(snapshot, 'blocked'), 1, 'ожидание фиксируется событием');
  assert.equal(countEvents(snapshot, 'spawn'), 0);
  assert.ok((snapshot.machines as string[])[0].includes('spawnIndex=0'), 'значение не израсходовано');
  assert.ok((snapshot.machines as string[])[0].includes('cooldown=0'), 'ожидание не запускает перезарядку');
  assert.equal(snapshot.nextTokenId, 1, 'идентификатор не выделялся');
  assert.equal(snapshot.nextSpawnOrder, 1);
});

test('spawn occupancy: a hex freed by movement in the same tick is available immediately', () => {
  // Состояние ПОСЛЕ фазы движения: сфера ушла с (0,0) на (1,0) в этом же такте.
  const world = createWorldFromLevel(
    levelWithPresets('C2-freed-exit', [
      spawner(-1, 0, 0, [7], 1),
      preset('conveyor', 0, 0, { dir: 0 }),
    ], { radius: 4 }),
  );
  world.tick = 1;
  const leaving = addToken(world, 'leaving', 5, 0, 0, 1);
  leaving.coord = { q: 1, r: 0 };
  leaving.prevCoord = { q: 0, r: 0 };
  leaving.moveSource = 'conveyor';

  const snapshot = compareStorageOrders(world, 'освобождённый выход');
  assert.deepEqual(snapshot.moved, ['t_1'], 'источник обязан занять освободившийся гекс');
  assert.ok(
    // `spawnOrder` нового значения — 1: ручная вставка сферы счётчик не двигала.
    (snapshot.tokens as string[]).includes('t_1|7|0,0|prev=-1,0|order=1|src=spawner'),
    `новая сфера должна встать на (0,0): ${(snapshot.tokens as string[]).join(' ; ')}`,
  );

  // Сквозная проверка через полный такт: индекс строится после движения.
  const e2e = createWorldFromLevel(
    levelWithPresets('C2-freed-exit-e2e', [
      spawner(-1, 0, 0, [7], 1),
      preset('conveyor', 0, 0, { dir: 0 }),
    ], { radius: 4 }),
  );
  addToken(e2e, 'leaving', 5, 0, 0, 1);
  stepSimulation(e2e);
  assert.equal(tokensAt(e2e), '5@1,0 7@0,0');
});

test('spawn occupancy: two sources sharing one exit — the smaller coordinate emits, the other waits', () => {
  const world = createWorldFromLevel(
    levelWithPresets('C2-shared-two', [
      spawner(-2, 0, 0, [2], 5),
      spawner(-1, -1, 1, [3], 5),
    ], { radius: 3 }),
  );
  world.tick = 1;

  const snapshot = compareStorageOrders(world, 'общий выход двух источников');

  assert.deepEqual(snapshot.tokens, ['t_1|2|-1,0|prev=-2,0|order=1|src=spawner'], 'выпустил источник с меньшей координатой');
  const machines = snapshot.machines as string[];
  assert.ok(machines[0].includes('spawnIndex=1'), 'победитель сдвинул последовательность');
  assert.ok(machines[0].includes('cooldown=4'), 'победитель перезаряжается');
  assert.ok(machines[1].includes('spawnIndex=0'), 'проигравший сохранил значение');
  assert.ok(machines[1].includes('cooldown=0'), 'проигравший не потратил такт перезарядки');
  assert.deepEqual(snapshot.events, [
    '1|1|spawn|-1,0|Выпущено число 2|info',
    '2|1|blocked|-1,0|Выход источника занят — ожидание освобождения гекса|warning',
  ]);
});

test('spawn occupancy: three sources sharing one exit create exactly one sphere', () => {
  const shared = (): PresetSpec[] => [
    spawner(-1, 0, 0, [2], 1),
    spawner(0, -1, 1, [4], 1),
    spawner(1, -1, 2, [6], 1),
  ];
  // (-1,0) → (0,0); (0,-1) → (0,0); (1,-1) → (0,0): три источника, один выход.
  for (const spec of shared()) {
    assert.equal(hexKey(hexNeighbor(spec.coord, spec.config!.dir!)), '0,0', 'выходы совпадают');
  }

  const world = createWorldFromLevel(levelWithPresets('C2-shared-three', shared(), { radius: 3 }));
  world.tick = 1;
  const snapshot = compareStorageOrders(world, 'общий выход трёх источников');

  assert.equal((snapshot.tokens as string[]).length, 1, 'создана ровно одна сфера');
  assert.deepEqual(snapshot.tokens, ['t_1|2|0,0|prev=-1,0|order=1|src=spawner'], 'победил источник с меньшей `q`');
  assert.equal(countEvents(snapshot, 'spawn'), 1);
  assert.equal(countEvents(snapshot, 'blocked'), 2, 'двое остальных ждут');
  const machines = snapshot.machines as string[];
  assert.deepEqual(
    machines.map((m) => m.match(/spawnIndex=(\d+)/)![1]),
    ['1', '0', '0'],
    'сдвинулся только индекс победителя',
  );
  assert.equal(snapshot.nextTokenId, 2, 'выделен один идентификатор');
  assert.equal(snapshot.nextSpawnOrder, 2);

  // Долгий прогон: выход остаётся занятым сферой победителя (она не движется),
  // поэтому больше сфер не появляется и значения проигравших не расходуются.
  const longRun = createWorldFromLevel(levelWithPresets('C2-shared-three-long', shared(), { radius: 3 }));
  for (let tick = 0; tick < 6; tick++) stepSimulation(longRun);
  assert.equal(longRun.tokens.size, 1, 'на общем выходе остаётся одна сфера');
  for (const machine of [...longRun.machines.values()].sort((a, b) => a.coord.q - b.coord.q)) {
    const expected = hexKey(machine.coord) === '-1,0' ? 1 : 0;
    assert.equal(machine.state.spawnIndex, expected, `источник ${hexKey(machine.coord)}`);
  }
});

test('spawn occupancy: independent sources all release their values in one tick', () => {
  const world = createWorldFromLevel(
    levelWithPresets('C2-independent', [
      spawner(-2, 0, 0, [2], 1),
      spawner(-2, 2, 0, [3], 5),
      spawner(2, 0, 3, [4], 1),
    ], { radius: 4 }),
  );
  world.tick = 1;

  const snapshot = compareStorageOrders(world, 'независимые источники');

  assert.deepEqual(
    snapshot.tokens,
    [
      't_1|2|-1,0|prev=-2,0|order=1|src=spawner',
      't_2|3|-1,2|prev=-2,2|order=2|src=spawner',
      't_3|4|1,0|prev=2,0|order=3|src=spawner',
    ],
    'идентификаторы и spawnOrder выданы в каноническом порядке источников',
  );
  assert.equal(countEvents(snapshot, 'spawn'), 3);
  assert.equal(countEvents(snapshot, 'blocked'), 0);
  assert.equal(snapshot.nextTokenId, 4);
  assert.equal(snapshot.nextSpawnOrder, 4);
  const machines = snapshot.machines as string[];
  assert.ok(machines[0].includes('cooldown=0'));
  assert.ok(machines[1].includes('cooldown=4'), 'интервал 5 оставляет перезарядку 4');
  assert.ok(machines[2].includes('cooldown=0'));
});

test('spawn occupancy: a source that waited emits its value later without losing it', () => {
  const world = createWorldFromLevel(
    levelWithPresets('C2-waiting-release', [
      spawner(-2, 0, 0, [2], 1),
      spawner(-1, -1, 1, [3], 1),
    ], { radius: 3 }),
  );

  stepSimulation(world);
  assert.equal(tokensAt(world), '2@-1,0', 'первым выпустил источник с меньшей координатой');
  const waitingBefore = [...world.machines.values()].find((m) => hexKey(m.coord) === '-1,-1')!;
  assert.equal(waitingBefore.state.spawnIndex, 0);
  assert.equal(waitingBefore.state.cooldown, 0);

  world.tokens.delete([...world.tokens.keys()][0]);
  stepSimulation(world);

  assert.equal(tokensAt(world), '3@-1,0', 'проигравший выпускает сохранённое значение');
  const released = [...world.tokens.values()][0];
  assert.equal(released.id, 't_2');
  assert.equal(released.spawnOrder, 2);
  assert.equal(waitingBefore.state.spawnIndex, 1);
  assert.equal(waitingBefore.state.cooldown, 0);
  assert.ok(
    world.events.some((e) => e.type === 'spawn' && e.coord.q === -1 && e.coord.r === 0),
    'ожидание завершилось событием выпуска',
  );
  assert.equal(world.nextTokenId, 3);
  assert.equal(world.nextSpawnOrder, 3);
});

test('spawn occupancy: reversing world.machines changes nothing at all', () => {
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(
      levelWithPresets(`C2-reverse-${reverse}`, [
        spawner(-2, 0, 0, [2, 4], 1),
        spawner(-1, -1, 1, [3, 5], 1),
        spawner(1, 1, 3, [6], 2),
        spawner(2, 0, 3, [8], 1),
      ], { radius: 4 }),
    );
    return reverse ? reverseStorageOrder(world) : world;
  };

  const forward = build(false);
  const reversed = build(true);
  for (let tick = 0; tick < 8; tick++) {
    const forwardSnapshot = comparePhase(forward, `прямой порядок, такт ${tick + 1}`);
    const reversedSnapshot = comparePhase(reversed, `обратный порядок, такт ${tick + 1}`);
    assert.deepEqual(reversedSnapshot, forwardSnapshot, `такт ${tick + 1}: порядок хранения механизмов наблюдаем`);
    // Мир после сравнения с эталоном мутирован только в копии эталона, поэтому
    // дальше идём полным тактом движка.
    stepSimulation(forward);
    stepSimulation(reversed);
    assert.equal(snapshotPhysicalState(forward), snapshotPhysicalState(reversed), `такт ${tick + 1}`);
  }
});

// ---------------------------------------------------------------------------
// C3: воспроизводимый фаззинг фазы источников
// ---------------------------------------------------------------------------

interface SpawnFuzzCase {
  level: ReturnType<typeof auditLevel>;
  presetMachines: PresetSpec[];
  tokens: Array<{ id: string; value: number; q: number; r: number; order: number }>;
}

function makeSpawnFuzzCase(trial: number, rnd: () => number): SpawnFuzzCase {
  const radius = 4;
  const spawnerCount = 1 + Math.floor(rnd() * 5);
  const presetMachines: PresetSpec[] = [];
  const occupiedCoords = new Set<string>();

  while (presetMachines.length < spawnerCount) {
    const q = Math.floor(rnd() * (radius + 1)) - radius;
    const r = Math.floor(rnd() * (radius + 1)) - radius;
    const key = `${q},${r}`;
    if (occupiedCoords.has(key)) continue;
    if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 >= radius) continue;
    occupiedCoords.add(key);
    const dir = Math.floor(rnd() * 6);
    const seqLen = 1 + Math.floor(rnd() * 3);
    const sequence = Array.from({ length: seqLen }, () => Math.floor(rnd() * 9) + 1);
    presetMachines.push(
      spawner(q, r, dir, sequence, 1 + Math.floor(rnd() * 4), rnd() < 0.35),
    );
  }

  // Сферы сажаем на допустимые гексы, в том числе прямо на выходы источников:
  // это и создаёт конкуренцию за общий выход и «занятый выход».
  const tokens: SpawnFuzzCase['tokens'] = [];
  const tokenCount = Math.floor(rnd() * 6);
  const disk: Array<{ q: number; r: number }> = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 <= radius) disk.push({ q, r });
    }
  }
  const exitKeys = presetMachines.map((m) => hexKey(hexNeighbor(m.coord, m.config!.dir as never)));
  for (let i = 0; i < tokenCount; i++) {
    const useExit = exitKeys.length > 0 && rnd() < 0.5;
    const hex = useExit
      ? (() => {
          const [q, r] = exitKeys[Math.floor(rnd() * exitKeys.length)].split(',').map(Number);
          return { q, r };
        })()
      : disk[Math.floor(rnd() * disk.length)];
    const key = hexKey(hex);
    if (tokens.some((t) => hexKey({ q: t.q, r: t.r }) === key)) continue;
    tokens.push({ id: `x${tokens.length + 1}`, value: tokens.length + 1, q: hex.q, r: hex.r, order: tokens.length + 1 });
  }

  return { level: auditLevel({ id: `spawn-fuzz-${trial}`, radius }), presetMachines, tokens };
}

function instantiateSpawnFuzzCase(spec: SpawnFuzzCase, reverse: boolean): SimulationWorld {
  const world = createWorldFromLevel({ ...spec.level, presetMachines: spec.presetMachines.map((p) => ({
    type: p.type,
    coord: { ...p.coord },
    locked: p.locked ?? true,
    config: { dir: 0, ...p.config },
  })) });
  for (const tok of spec.tokens) addToken(world, tok.id, tok.value, tok.q, tok.r, tok.order);
  world.tick = 1;
  return reverse ? reverseStorageOrder(world) : world;
}

test('spawn occupancy fuzz: 1500 seeded phases give identical results in the old and new implementation', () => {
  const rnd = mulberry32(20260303);
  let spawned = 0;
  let blocked = 0;
  let errorCases = 0;

  for (let trial = 0; trial < 1500; trial++) {
    const spec = makeSpawnFuzzCase(trial, rnd);
    const snapshot = comparePhase(instantiateSpawnFuzzCase(spec, false), `trial ${trial}`);
    const reversedSnapshot = comparePhase(instantiateSpawnFuzzCase(spec, true), `trial ${trial} (reverse)`);
    assert.deepEqual(reversedSnapshot, snapshot, `trial ${trial}: обратный порядок Map изменил фазу источников`);

    spawned += countEvents(snapshot, 'spawn');
    blocked += countEvents(snapshot, 'blocked');
    if (snapshot.status === 'error') errorCases += 1;
  }

  assert.ok(spawned > 500, `выборка должна содержать успешные выпуски (${spawned})`);
  assert.ok(blocked > 500, `выборка должна содержать ожидания занятого выхода (${blocked})`);
  assert.ok(errorCases > 0, `выборка должна содержать отклонённые фазы (${errorCases})`);
  console.log(
    `\n=== PR #4C: источники — 1500 фаз × 2 порядка Map: выпусков ${spawned}, ожиданий ${blocked}, ошибок ${errorCases} ===\n`,
  );
});

test('spawn occupancy fuzz: multi-source worlds stay identical in both storage orders over many ticks', () => {
  const rnd = mulberry32(20260404);
  for (let trial = 0; trial < 120; trial++) {
    const spec = makeSpawnFuzzCase(trial + 5000, rnd);
    // Только источники и статичные сферы: движение не участвует, поэтому
    // сравнение изолирует фазу источников и её индекс занятости.
    const forward = instantiateSpawnFuzzCase(spec, false);
    const reversed = instantiateSpawnFuzzCase(spec, true);
    for (let tick = 0; tick < 12; tick++) {
      stepSimulation(forward);
      stepSimulation(reversed);
      assert.equal(
        snapshotPhysicalState(forward),
        snapshotPhysicalState(reversed),
        `trial ${trial}, такт ${tick + 1}: порядок хранения механизмов наблюдаем`,
      );
      assert.equal(forward.nextTokenId, reversed.nextTokenId);
      assert.equal(forward.nextSpawnOrder, reversed.nextSpawnOrder);
    }
  }
});
