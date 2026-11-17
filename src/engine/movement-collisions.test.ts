/**
 * Столкновения: встречный обмен, цепочки, несколько толкателей/магнитов/источников,
 * одновременные входы, а также эквивалентность поиска встречного обмена (пункт 3.1
 * плана оптимизации): линейный индекс обязан принимать те же решения, что и
 * текущий O(n²)-перебор.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel, getConnectedComponents, stepSimulation } from './hex-engine';
import { resolveMovement } from './collisions';
import { generateHexDisk, hexDistance as hexDistanceBetween, hexKey, hexNeighbor, rotateAroundPivot } from './hex-math';
import {
  addToken,
  assertMatchesRule,
  assertMovementInvariants,
  auditLevel,
  bondTokens,
  documentDivergence,
  documentedViolations,
  formatViolationTable,
  levelWithPresets,
  mulberry32,
  preset,
  reverseStorageOrder,
  snapshotPhysicalState,
  tokensAt,
} from './audit-kit';
import type { ConnectedComponent } from './components';
import type { ComponentIntent } from './movement-types';
import type { AxialCoord, SimulationWorld } from './types';

function coords(world: SimulationWorld): Record<string, AxialCoord> {
  const out: Record<string, AxialCoord> = {};
  for (const tok of world.tokens.values()) out[tok.id] = { ...tok.coord };
  return out;
}

function assertUnmoved(world: SimulationWorld, before: Record<string, AxialCoord>): void {
  for (const [id, coord] of Object.entries(before)) {
    const tok = world.tokens.get(id);
    assert.ok(tok, `сфера ${id} исчезла при столкновении`);
    assert.deepEqual(tok!.coord, coord, `сфера ${id} частично переместилась`);
  }
}

// ---------------------------------------------------------------------------
// Встречные столкновения
// ---------------------------------------------------------------------------

test('head-on: two belts driving neighbouring spheres into each other collide and neither moves', () => {
  const world = createWorldFromLevel(levelWithPresets('C-conveyor-head-on', [
    preset('conveyor', 0, 0, { dir: 0 }),
    preset('conveyor', 1, 0, { dir: 3 }),
  ], { radius: 4 }));
  addToken(world, 'a', 1, 0, 0, 1);
  addToken(world, 'b', 2, 1, 0, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.equal(world.errorReason, 'Встречное столкновение сфер при обмене соседними гексами');
  assert.deepEqual(world.errorHighlightHexes, [{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  assertUnmoved(world, before);
});

test('head-on: two pushers driving neighbouring spheres into each other are rejected by the actuator-conflict rule', () => {
  // Цепная передача толкателя добавляет второй сфере намерение tier 2, поэтому
  // конфликт приводов обнаруживается раньше проверки встречного обмена. Такт
  // отвергается в любом случае, но диагностика другая — это зафиксировано тестом.
  const world = createWorldFromLevel(levelWithPresets('C-pusher-head-on', [
    preset('pusher', -1, 0, { dir: 0 }),
    preset('pusher', 2, 0, { dir: 3 }),
  ], { radius: 4 }));
  addToken(world, 'a', 1, 0, 0, 1);
  addToken(world, 'b', 2, 1, 0, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.equal(world.errorReason, 'Конфликт векторов тяги: разные приводы тянут полимер в противоположных направлениях');
  assert.equal(world.errorHighlightHexes.length, 2);
  assertUnmoved(world, before);
});

test('head-on: a pusher overpowers an opposing belt and pushes the whole train instead of swapping', () => {
  // Иерархия tier 2 > tier 1: встречный конвейер не создаёт обмен,
  // цепь толкателя переводит обе сферы на восток.
  const world = createWorldFromLevel(levelWithPresets('C-pusher-belt-head-on', [
    preset('pusher', -1, 0, { dir: 0 }),
    preset('conveyor', 1, 0, { dir: 3 }),
  ], { radius: 4 }));
  addToken(world, 'a', 1, 0, 0, 1);
  addToken(world, 'b', 2, 1, 0, 2);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.equal(tokensAt(world), '1@1,0 2@2,0');
  assert.equal(world.tokens.get('b')!.moveSource, 'pusher', 'встречный конвейер перебит толкателем');
  assertMovementInvariants(world, 'pusher vs belt');
});

test('collision: magnet pull and belt feed competing for one hex collide instead of stacking', () => {
  // Магнит втягивает сферу из (0,0) в (-1,0), конвейер везёт вторую сферу из (-1,1) туда же.
  const world = createWorldFromLevel(levelWithPresets('C-magnet-belt-collision', [
    preset('magnet', -2, 0, { dir: 0 }),
    preset('conveyor', -1, 1, { dir: 4 }),
  ], { radius: 4 }));
  addToken(world, 'pulled', 5, 0, 0, 1);
  addToken(world, 'belted', 6, -1, 1, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.equal(world.errorReason, 'Столкновение 2 числовых сфер на гексе (-1, 0)');
  assertUnmoved(world, before);
});

test('collision: two pushers driving separate spheres onto one hex collide', () => {
  const world = createWorldFromLevel(levelWithPresets('C-two-pushers-merge', [
    preset('pusher', -1, 0, { dir: 0 }),
    preset('pusher', 3, 0, { dir: 3 }),
  ], { radius: 4 }));
  // Первый толкатель гонит сферу (0,0) → (1,0), второй — сферу (2,0) → (1,0).
  addToken(world, 'a', 1, 0, 0, 1);
  addToken(world, 'b', 2, 2, 0, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.equal(world.errorReason, 'Столкновение 2 числовых сфер на гексе (1, 0)');
  assertUnmoved(world, before);
});

// ---------------------------------------------------------------------------
// Трамплин: промежуточный гекс по правилу не проверяется
// ---------------------------------------------------------------------------

test('jumper: flies over an occupied intermediate hex by rule and only needs a free landing hex', () => {
  const world = createWorldFromLevel(levelWithPresets('C-jumper-over-token', [
    preset('jumper', 0, 0, { dir: 0 }),
  ], { radius: 4 }));
  addToken(world, 'flyer', 4, 0, 0, 1);
  addToken(world, 'bystander', 9, 1, 0, 2);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('flyer')!.coord, { q: 2, r: 0 }, 'трамплин перебрасывает сферу через занятый гекс');
  assert.deepEqual(world.tokens.get('bystander')!.coord, { q: 1, r: 0 }, 'сфера под траекторией не сдвигается');
  assertMovementInvariants(world, 'jump over token');
});

test('jumper: flies over a solid machine body (documented trampoline rule, not a sweep check)', () => {
  const world = createWorldFromLevel(levelWithPresets('C-jumper-over-solid', [
    preset('jumper', 0, 0, { dir: 0 }),
    preset('pusher', 1, 0, { dir: 4 }),
  ], { radius: 4 }));
  addToken(world, 'flyer', 4, 0, 0, 1);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('flyer')!.coord, { q: 2, r: 0 });
});

test('jumper: landing on an occupied hex is a collision', () => {
  const world = createWorldFromLevel(levelWithPresets('C-jumper-landing', [
    preset('jumper', 0, 0, { dir: 0 }),
  ], { radius: 4 }));
  addToken(world, 'flyer', 4, 0, 0, 1);
  addToken(world, 'blocker', 9, 2, 0, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.equal(world.errorReason, 'Столкновение 2 числовых сфер на гексе (2, 0)');
  assertUnmoved(world, before);
});

// ---------------------------------------------------------------------------
// Несколько толкателей / магнитов / источников
// ---------------------------------------------------------------------------

test('pushers: three spheres move as one pushed train, four collide with the overload rule', () => {
  const build = (count: number): SimulationWorld => {
    const world = createWorldFromLevel(levelWithPresets(`C-pusher-train-${count}`, [
      preset('pusher', -2, 0, { dir: 0 }),
    ], { radius: 5 }));
    for (let i = 0; i < count; i++) addToken(world, `s${i}`, i + 1, -1 + i, 0, i + 1);
    return world;
  };

  const three = build(3);
  stepSimulation(three);
  assert.equal(three.status, 'running', three.errorReason ?? '');
  assert.equal(tokensAt(three), '1@0,0 2@1,0 3@2,0');

  const four = build(4);
  const before = coords(four);
  stepSimulation(four);
  assert.equal(four.status, 'error');
  assert.match(four.errorReason ?? '', /Перегрузка толкателя/);
  assertUnmoved(four, before);
});

test('pushers: two independent pushers move their own three-sphere trains in the same tick', () => {
  // Ёмкость толкателя (3 сферы) считается на каждый толкатель, а не на такт.
  const world = createWorldFromLevel(levelWithPresets('C-two-pushers-parallel', [
    preset('pusher', -2, 0, { dir: 0 }),
    preset('pusher', -2, 2, { dir: 0 }),
  ], { radius: 5 }));
  for (let i = 0; i < 3; i++) addToken(world, `a${i}`, i + 1, -1 + i, 0, i + 1);
  for (let i = 0; i < 3; i++) addToken(world, `b${i}`, i + 4, -1 + i, 2, i + 4);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(world.tokens.get(`a${i}`)!.coord, { q: i, r: 0 });
    assert.deepEqual(world.tokens.get(`b${i}`)!.coord, { q: i, r: 2 });
  }
  assertMovementInvariants(world, 'two pushers');
});

test('magnets: two magnets pulling the same sphere in opposite directions are a thrust conflict, not a silent pick', () => {
  const world = createWorldFromLevel(levelWithPresets('C-two-magnets-conflict', [
    preset('magnet', -2, 0, { dir: 0 }),
    preset('magnet', 2, 0, { dir: 3 }),
  ], { radius: 4 }));
  addToken(world, 't', 5, 0, 0, 1);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Конфликт векторов тяги/);
  assertUnmoved(world, before);
});

test('sources: a spawner waits while its exit is occupied and emits as soon as the hex is free', () => {
  const world = createWorldFromLevel(levelWithPresets('C-spawner-wait', [
    preset('spawner', -1, 0, { dir: 0, sequence: [2], loopSequence: false, spawnInterval: 1 }),
  ], { radius: 3 }));
  addToken(world, 'blocker', 5, 0, 0, 1);

  stepSimulation(world);
  assert.equal(world.tokens.size, 1, 'выход занят — новая сфера не появляется');
  assert.ok(world.events.some((e) => e.type === 'blocked'), 'должно быть событие ожидания');

  world.tokens.delete('blocker');
  stepSimulation(world);
  assert.equal(tokensAt(world), '2@0,0');
});

test('sources: occupancy is checked after movement, so a hex freed in the same tick can be used immediately', () => {
  // Критерий для пункта 3.4: любой индекс занятости обязан быть актуальным
  // после движения — иначе источник «не увидит» освободившийся гекс.
  const world = createWorldFromLevel(levelWithPresets('C-spawner-fresh-occupancy', [
    preset('spawner', -1, 0, { dir: 0, sequence: [7], loopSequence: false, spawnInterval: 1 }),
    preset('conveyor', 0, 0, { dir: 0 }),
  ], { radius: 4 }));
  addToken(world, 'leaving', 5, 0, 0, 1);

  stepSimulation(world);

  assert.equal(tokensAt(world), '5@1,0 7@0,0', 'источник обязан занять гекс, освобождённый движением в этом же такте');
  assertMovementInvariants(world, 'fresh occupancy');
});

test('sources: two spawners feeding one belt queue their values instead of overwriting them', () => {
  const world = createWorldFromLevel(levelWithPresets('C-two-sources', [
    preset('spawner', -3, 1, { dir: 0, sequence: [2, 4], loopSequence: false, spawnInterval: 1 }),
    preset('spawner', -3, -1, { dir: 0, sequence: [3, 5], loopSequence: false, spawnInterval: 1 }),
  ], { radius: 4 }));
  const seen: string[] = [];
  for (let tick = 0; tick < 12; tick++) {
    stepSimulation(world);
    seen.push(tokensAt(world));
    assertMovementInvariants(world, `two sources tick ${world.tick}`);
  }
  assert.ok(seen.some((s) => s.includes('2@') && s.includes('3@')), `оба источника должны выпустить значения: ${seen.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// Пункт 3.1: линейный индекс встречного обмена обязан давать те же решения
// ---------------------------------------------------------------------------

/**
 * Независимая эталонная реализация проверки встречного обмена из пункта 3.1:
 * индекс «гекс на старте → сфера» и один проход по сферам вместо двойного цикла.
 * Возвращает true, если обмен должен считаться столкновением.
 */
function linearSwapCollision(
  world: SimulationWorld,
  tokenToComponent: Map<string, ConnectedComponent>,
  resolvedIntentByComp: Map<string, ComponentIntent | null>,
  proposed: Map<string, AxialCoord>,
): boolean {
  const tokenAtStart = new Map<string, string>();
  for (const tok of world.tokens.values()) tokenAtStart.set(hexKey(tok.coord), tok.id);

  for (const tok of world.tokens.values()) {
    const next = proposed.get(tok.id)!;
    if (next.q === tok.coord.q && next.r === tok.coord.r) continue;
    const otherId = tokenAtStart.get(hexKey(next));
    if (!otherId || otherId === tok.id) continue;
    const other = world.tokens.get(otherId)!;
    const otherNext = proposed.get(otherId)!;
    const otherMoves = !(otherNext.q === other.coord.q && otherNext.r === other.coord.r);
    const isEdgeSwap = otherMoves && otherNext.q === tok.coord.q && otherNext.r === tok.coord.r;
    if (!isEdgeSwap) continue;

    const intentA = resolvedIntentByComp.get(tokenToComponent.get(tok.id)!.id);
    const intentB = resolvedIntentByComp.get(tokenToComponent.get(otherId)!.id);
    const validSwapperPair =
      intentA?.kind === 'swap' &&
      intentB?.kind === 'swap' &&
      intentA.pivot.q === intentB.pivot.q &&
      intentA.pivot.r === intentB.pivot.r;
    if (!validSwapperPair) return true;
  }
  return false;
}

function runSwapCheck(
  world: SimulationWorld,
  dirs: Map<string, { kind: 'move'; dir: number } | { kind: 'swap'; pivot: AxialCoord }>,
): { collided: boolean; predicted: boolean; reason: string | null } {
  const components = getConnectedComponents(world);
  const tokenToComponent = new Map<string, ConnectedComponent>();
  const intentsByComp = new Map<string, ComponentIntent[]>();
  for (const comp of components) {
    for (const id of comp.tokenIds) tokenToComponent.set(id, comp);
    const spec = dirs.get(comp.tokenIds[0]);
    if (!spec) {
      intentsByComp.set(comp.id, []);
      continue;
    }
    intentsByComp.set(comp.id, [
      spec.kind === 'move'
        ? {
            kind: 'move',
            dir: spec.dir as never,
            tier: 1,
            signature: `move:${spec.dir}`,
            sourceCoord: { q: 0, r: 0 },
            sourceMachineType: 'conveyor',
          }
        : {
            kind: 'swap',
            pivot: { ...spec.pivot },
            tier: 2,
            signature: `swap:${spec.pivot.q},${spec.pivot.r}`,
            sourceCoord: { ...spec.pivot },
            sourceMachineType: 'swapper',
          },
    ]);
  }

  // Предлагаемые координаты повторяют правила намерений (move/swap).
  const proposed = new Map<string, AxialCoord>();
  const resolvedIntentByComp = new Map<string, ComponentIntent | null>();
  for (const comp of components) {
    const intents = intentsByComp.get(comp.id)!;
    const intent = intents[0] ?? null;
    resolvedIntentByComp.set(comp.id, intent);
    for (const id of comp.tokenIds) {
      const tok = world.tokens.get(id)!;
      if (!intent) proposed.set(id, { ...tok.coord });
      else if (intent.kind === 'move') proposed.set(id, hexNeighbor(tok.coord, intent.dir));
      else if (intent.kind === 'swap') proposed.set(id, rotateAroundPivot(tok.coord, intent.pivot, 3));
      else proposed.set(id, { ...tok.coord });
    }
  }

  const predicted = linearSwapCollision(world, tokenToComponent, resolvedIntentByComp, proposed);
  const result = resolveMovement(world, components, tokenToComponent, intentsByComp);
  const collided = result === null && (world.errorReason ?? '').startsWith('Встречное столкновение');
  return { collided, predicted, reason: world.errorReason };
}

test('swap index: linear index and the O(n²) scan agree on 1500 seeded configurations with the swapper exception', () => {
  const rnd = mulberry32(20260101);
  let collisions = 0;
  let allowed = 0;
  let compared = 0;

  for (let trial = 0; trial < 1500; trial++) {
    const world = createWorldFromLevel(auditLevel({ id: `swap-index-${trial}`, radius: 3 }));
    const hexes = generateHexDisk(3);
    const chosen: AxialCoord[] = [];
    const tokenCount = 2 + Math.floor(rnd() * 6);
    for (let i = 0; i < tokenCount; i++) {
      const hex = hexes[Math.floor(rnd() * hexes.length)];
      if (chosen.some((c) => hexKey(c) === hexKey(hex))) continue;
      chosen.push(hex);
      addToken(world, `t${chosen.length}`, chosen.length, hex.q, hex.r, chosen.length);
    }

    const dirs = new Map<string, { kind: 'move'; dir: number } | { kind: 'swap'; pivot: AxialCoord }>();
    for (const tok of world.tokens.values()) {
      // Намерения ограничены платформой, чтобы проверка обмена действительно
      // выполнялась (иначе такт отклоняется раньше — край или корпус).
      // Четверть случаев — намерение swapper, чтобы исключение тоже попало в выборку.
      if (rnd() < 0.25) {
        const pivot = hexNeighbor(tok.coord, Math.floor(rnd() * 6) as 0 | 1 | 2 | 3 | 4 | 5);
        const dest = rotateAroundPivot(tok.coord, pivot, 3);
        if (!world.platformHexes.has(hexKey(pivot)) || !world.platformHexes.has(hexKey(dest))) continue;
        dirs.set(tok.id, { kind: 'swap', pivot });
      } else {
        const dir = Math.floor(rnd() * 6);
        if (!world.platformHexes.has(hexKey(hexNeighbor(tok.coord, dir as 0 | 1 | 2 | 3 | 4 | 5)))) continue;
        dirs.set(tok.id, { kind: 'move', dir });
      }
    }

    const { collided, predicted, reason } = runSwapCheck(world, dirs);
    const earlyError = reason !== null && !reason.startsWith('Встречное столкновение');
    if (earlyError) {
      // Проверка обмена не выполнялась: такт отклонён раньше (край платформы,
      // корпус механизма, перекрытие целей). Такие случаи вне сравнения.
      continue;
    }
    assert.equal(
      collided,
      predicted,
      `trial ${trial}: перебор и линейный индекс разошлись (engine=${collided}, index=${predicted}, reason=${reason})`,
    );
    compared += 1;
    if (collided) collisions += 1;
    else allowed += 1;
  }

  assert.ok(compared > 400, `слишком мало сравнимых случаев: ${compared}`);
  assert.ok(collisions > 10, `выборка должна содержать встречные столкновения (${collisions})`);
  assert.ok(allowed > 10, `выборка должна содержать легальные обмены (${allowed})`);
});

test('swap index: both sides of one swapper stay legal', () => {
  const swapperWorld = createWorldFromLevel(levelWithPresets('C-swap-exception', [
    preset('swapper', 0, 0, { dir: 0 }),
  ], { radius: 3 }));
  addToken(swapperWorld, 'left', 1, -1, 0, 1);
  addToken(swapperWorld, 'right', 2, 1, 0, 2);
  const swapOk = runSwapCheck(swapperWorld, new Map([
    ['left', { kind: 'swap', pivot: { q: 0, r: 0 } }],
    ['right', { kind: 'swap', pivot: { q: 0, r: 0 } }],
  ]));
  assertMatchesRule({ collided: false }, { collided: swapOk.collided });
});

test('swap index: the swapper exception covers its own two-hex exchange, while two jumpers exchanging spheres collide', () => {
  // 180°-поворот сваппера переставляет сферы через две клетки (pivot ± dir),
  // поэтому проверка обмена обязана узнавать и такие пары. Исключение сделано
  // только для пары с общим pivot; обмен прыжками через трамплины — столкновение.
  const pivot = { q: 0, r: 0 };
  const a = hexNeighbor(pivot, 0);
  const b = hexNeighbor(pivot, 3);
  assert.deepEqual(rotateAroundPivot(a, pivot, 3), b, 'сваппер переставляет сферу на противоположную клетку');
  assert.equal(hexDistanceBetween(a, b), 2, 'пара сваппера стоит через две клетки, а не на соседних');

  const world = createWorldFromLevel(levelWithPresets('C-jumper-exchange', [
    preset('jumper', -1, 0, { dir: 0 }),
    preset('jumper', 1, 0, { dir: 3 }),
  ], { radius: 4 }));
  addToken(world, 'left', 1, -1, 0, 1);
  addToken(world, 'right', 2, 1, 0, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.equal(world.errorReason, 'Встречное столкновение сфер при обмене соседними гексами');
  assertUnmoved(world, before);
});

// ---------------------------------------------------------------------------
// P1 (PR #4B): два источника с общим выходом — стабильное правило выбора
// ---------------------------------------------------------------------------

const sharedExitPresets = (): ReturnType<typeof preset>[] => [
  preset('spawner', -2, 0, { dir: 0, sequence: [2], loopSequence: false, spawnInterval: 5 }),
  preset('spawner', -1, -1, { dir: 1, sequence: [3], loopSequence: false, spawnInterval: 5 }),
];

/** Механизм по координате: `id` (m_N) не зависит от того, как читать тест, а координата — да. */
function machineAt(world: SimulationWorld, q: number, r: number) {
  const machine = world.machines.get(hexKey({ q, r }));
  assert.ok(machine, `нет механизма на (${q}, ${r})`);
  return machine!;
}

test('sources: two spawners sharing one exit hex — the source with the smaller coordinate wins, independent of Map order', () => {
  const level = levelWithPresets('C-shared-exit', sharedExitPresets(), { radius: 3 });
  const forward = createWorldFromLevel(level);
  assert.equal(forward.status, 'idle', 'подготовка: раскладка с общим выходом источников допустима');
  const reverse = reverseStorageOrder(createWorldFromLevel(level));

  stepSimulation(forward);
  stepSimulation(reverse);

  // Правило: при конкуренции за гекс первым считается источник с меньшей `q`,
  // при равенстве — с меньшей `r`. Здесь это источник на (-2, 0), он и выпускает.
  assertMatchesRule('2@-1,0', tokensAt(forward));
  assertMatchesRule(tokensAt(forward), tokensAt(reverse), 'результат не должен зависеть от порядка хранения');

  const winner = machineAt(forward, -2, 0);
  assertMatchesRule(1, winner.state.spawnIndex, 'победитель сдвинул свою последовательность');
  assertMatchesRule(4, winner.state.cooldown, 'победитель начал перезарядку');
  const waiting = machineAt(forward, -1, -1);
  assertMatchesRule(0, waiting.state.spawnIndex, 'проигравший не сдвигает последовательность');
  assertMatchesRule(0, waiting.state.cooldown, 'проигравший не тратит значение и не перезаряжается');
  assertMatchesRule(3, waiting.config.sequence![waiting.state.spawnIndex], 'значение проигравшего сохранено');

  const eventLog = (world: SimulationWorld) => world.events.map((e) => `${e.id}:${e.type}:${e.coord.q},${e.coord.r}`);
  assertMatchesRule(eventLog(forward), eventLog(reverse), 'порядок событий тоже обязан совпадать');
  assertMatchesRule(
    ['1:spawn:-1,0', '2:blocked:-1,0'],
    eventLog(forward),
    'сначала выпуск победителя, затем ожидание проигравшего',
  );
});

test('sources: shared exit — the waiting source keeps its value and emits it once the hex frees up', () => {
  const build = (reverseMap: boolean): SimulationWorld => {
    const world = createWorldFromLevel(levelWithPresets('C-shared-exit-free', sharedExitPresets(), { radius: 3 }));
    return reverseMap ? reverseStorageOrder(world) : world;
  };

  for (const reverseMap of [false, true]) {
    const world = build(reverseMap);
    stepSimulation(world);
    assertMatchesRule('2@-1,0', tokensAt(world), 'подготовка: первым выпустил источник с меньшей координатой');

    // Освобождаем общий выход и даём ещё один такт.
    world.tokens.delete([...world.tokens.keys()][0]);
    stepSimulation(world);

    assertMatchesRule('3@-1,0', tokensAt(world), `reverse=${reverseMap}: проигравший выпускает своё значение`);
    const emitted = [...world.tokens.values()][0];
    assertMatchesRule(2, emitted.spawnOrder, 'новая сфера получает следующий стабильный spawnOrder');
    const waiting = machineAt(world, -1, -1);
    assertMatchesRule(1, waiting.state.spawnIndex, 'после выпуска индекс проигравшего сдвинулся ровно на один');
    assertMatchesRule(4, waiting.state.cooldown, 'после выпуска проигравший получил обычную перезарядку');
    assert.ok(
      world.events.some((e) => e.type === 'spawn' && e.coord.q === -1 && e.coord.r === 0),
      'ожидание завершилось событием выпуска',
    );
  }
});

test('sources: shared exit — no value is lost over a long run, and every value is released exactly once', () => {
  const released: number[] = [];
  const world = createWorldFromLevel(levelWithPresets('C-shared-exit-drain', [
    preset('spawner', -2, 0, { dir: 0, sequence: [2, 4], loopSequence: false, spawnInterval: 1 }),
    preset('spawner', -1, -1, { dir: 1, sequence: [3, 5], loopSequence: false, spawnInterval: 1 }),
  ], { radius: 6 }));

  for (let tick = 0; tick < 40; tick++) {
    // Сразу отдаём выпущенное «наружу», чтобы выход освобождался каждый такт.
    for (const tok of [...world.tokens.values()]) {
      released.push(tok.value);
      world.tokens.delete(tok.id);
    }
    stepSimulation(world);
    if (world.tokens.size === 0 && world.machines.size > 0) {
      const drained = [...world.machines.values()].every(
        (m) => m.type !== 'spawner' || m.state.spawnIndex >= (m.config.sequence ?? []).length,
      );
      if (drained) break;
    }
  }

  assertMatchesRule([2, 4, 3, 5], released, `каждое значение выпущено ровно один раз: ${released.join(',')}`);
});

test('[P2] equal tier+signature intents: only the first machine in storage order flashes', () => {
  const build = (reverse: boolean): SimulationWorld => {
    const presets = [
      preset('conveyor', 0, 0, { dir: 0 }),
      preset('conveyor', 1, 0, { dir: 0 }),
    ];
    const world = createWorldFromLevel(levelWithPresets(`C-equal-intent-${reverse}`, reverse ? [...presets].reverse() : presets, { radius: 4 }));
    addToken(world, 'a', 2, 0, 0, 1);
    addToken(world, 'b', 3, 1, 0, 2);
    bondTokens(world, 'a', 'b');
    return world;
  };
  const forward = build(false);
  const reverse = build(true);
  stepSimulation(forward);
  stepSimulation(reverse);

  const flash = (world: SimulationWorld) =>
    [...world.machines.values()]
      .map((m) => `${hexKey(m.coord)}=${m.state.activeFlashTicks}`)
      .sort()
      .join(',');
  assert.equal(tokensAt(forward), tokensAt(reverse), 'координаты обязаны совпадать');

  documentDivergence({
    id: 'equal-intent-choice',
    severity: 'P2',
    title: 'Равнозначные намерения (одинаковый tier и signature): источник действия выбирается по порядку Map',
    expected: 'стабильный compareIntents после проверки tier/signature (pushChainIndex, координата источника, тип механизма), как в п. 3.2',
    actual: 'выбирается первое намерение в массиве, то есть механизм, который раньше лежит в world.machines — вспышку получает только он',
    note: 'Координаты сфер совпадают; расходятся метаданные источника, вспышка механизма и события (влияет на анимацию и трассы).',
  }, flash(forward), flash(reverse));
});

test('[P2] pusher and magnet pushing one sphere: moveSource depends on storage order', () => {
  const build = (reverse: boolean): SimulationWorld => {
    const presets = [
      preset('pusher', -1, 0, { dir: 0 }),
      preset('magnet', 2, 0, { dir: 3 }),
    ];
    const world = createWorldFromLevel(levelWithPresets(`C-pusher-magnet-${reverse}`, reverse ? [...presets].reverse() : presets, { radius: 4 }));
    addToken(world, 't', 5, 0, 0, 1);
    return world;
  };
  const forward = build(false);
  const reverse = build(true);
  stepSimulation(forward);
  stepSimulation(reverse);

  assert.equal(tokensAt(forward), tokensAt(reverse), 'координаты обязаны совпадать');
  documentDivergence({
    id: 'pusher-magnet-move-source',
    severity: 'P2',
    title: 'Толкатель и магнит тянут одну сферу в одну сторону: moveSource/pushChainIndex зависят от порядка хранения',
    expected: 'детерминированный выбор источника (п. 3.2) — одинаковый moveSource при одинаковом мире',
    actual: 'moveSource равен типу того механизма, который первым лежит в world.machines (pusher либо magnet)',
    note: 'Физические координаты и значения совпадают; расходятся анимационные метаданные сферы.',
  }, forward.tokens.get('t')!.moveSource, reverse.tokens.get('t')!.moveSource);
});

test('collision audit summary: documented divergences of this suite', () => {
  const ids = documentedViolations().map((v) => v.id).sort();
  assert.deepEqual(ids, ['equal-intent-choice', 'pusher-magnet-move-source']);
  console.log(`\n=== Аудит столкновений: расхождения (${ids.length}) ===\n${formatViolationTable()}\n`);
});

test('determinism guard: the collision suites compare whole snapshots, not Map order', () => {
  const build = (): SimulationWorld => {
    const world = createWorldFromLevel(levelWithPresets('C-snapshot-guard', [
      preset('conveyor', 0, 0, { dir: 0 }),
    ], { radius: 4 }));
    addToken(world, 'a', 2, 0, 0, 1);
    return world;
  };
  const forward = build();
  const reverse = reverseStorageOrder(build());
  stepSimulation(forward);
  stepSimulation(reverse);
  assert.equal(snapshotPhysicalState(forward), snapshotPhysicalState(reverse));

  const mutated = build();
  stepSimulation(mutated);
  mutated.tokens.get('a')!.value = 99;
  assert.notEqual(snapshotPhysicalState(forward), snapshotPhysicalState(mutated), 'снимок обязан замечать изменения значений');
});
