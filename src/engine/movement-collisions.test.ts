/**
 * Столкновения: встречный обмен, цепочки, несколько толкателей/магнитов/источников,
 * одновременные входы, а также эквивалентность индексного поиска встречного обмена
 * (пункт 3.1 плана, PR #4C): индекс обязан принимать те же решения, что и
 * прежний O(n²)-перебор, включая выбор конфликтующей пары и порядок подсветки.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel, getConnectedComponents, stepSimulation } from './hex-engine';
import { buildTokenStartIndex, findHeadOnSwapConflict, resolveMovement } from './collisions';
import { sortedTokens } from './deterministic-order';
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
// PR #4C: индекс встречного обмена обязан принимать те же решения, что и
// прежний O(n²)-перебор (пункт 3.1 плана)
// ---------------------------------------------------------------------------
//
// Эталон ниже — независимая копия ПРЕЖНЕГО алгоритма: двойной цикл по всем
// парам сфер в каноническом порядке. Оптимизированная функция движка
// сравнивается с ней, а не сама с собой. Проверяются:
//
//  - факт столкновения;
//  - выбранная конфликтующая пара и порядок координат в подсветке;
//  - текст ошибки и `errorHighlightHexes` в полной фазе разрешения;
//  - исключение `swapper` (легальный обмен и обмен трамплинами);
//  - совпадение при обратном порядке хранения в `Map`.

/** Намерение сферы в сценарии: шаг, прыжок через гекс или обмен сваппера. */
interface SwapIntentSpec {
  kind: 'move' | 'jump' | 'swap';
  dir?: number;
  pivot?: AxialCoord;
}

interface SwapScenario {
  world: SimulationWorld;
  components: ConnectedComponent[];
  tokenToComponent: Map<string, ConnectedComponent>;
  intentsByComp: Map<string, ComponentIntent[]>;
  resolvedIntentByComp: Map<string, ComponentIntent | null>;
  proposed: Map<string, AxialCoord>;
}

interface SwapPair {
  first: AxialCoord;
  second: AxialCoord;
}

const sameCoord = (a: AxialCoord, b: AxialCoord): boolean => a.q === b.q && a.r === b.r;

/** Направление шага от `from` к соседнему гексу `to` (или `null`, если не сосед). */
function dirTowards(from: AxialCoord, to: AxialCoord): number | null {
  for (let dir = 0; dir < 6; dir++) {
    if (hexKey(hexNeighbor(from, dir as 0 | 1 | 2 | 3 | 4 | 5)) === hexKey(to)) return dir;
  }
  return null;
}

/** Канонический порядок сфер — независимая копия правила PR #4B. */
function canonicalTokenIds(world: SimulationWorld): string[] {
  return [...world.tokens.values()]
    .sort((a, b) => {
      const byOrder = (a.spawnOrder ?? Number.MAX_SAFE_INTEGER) - (b.spawnOrder ?? Number.MAX_SAFE_INTEGER);
      if (byOrder !== 0) return byOrder;
      if (a.coord.q !== b.coord.q) return a.coord.q - b.coord.q;
      if (a.coord.r !== b.coord.r) return a.coord.r - b.coord.r;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((tok) => tok.id);
}

/**
 * Эталон (поведение до PR #4C): полный двойной перебор пар.
 * Возвращает все встречные обмены в порядке, в котором их нашёл бы старый код,
 * кроме пар, разрешённых общим сваппером.
 */
function referenceSwapPairs(
  scenario: SwapScenario,
  options: { ignoreSwapperException?: boolean } = {},
): Array<{ firstId: string; secondId: string }> {
  const tokenIds = canonicalTokenIds(scenario.world);
  const pairs: Array<{ firstId: string; secondId: string }> = [];
  for (let i = 0; i < tokenIds.length; i++) {
    for (let j = i + 1; j < tokenIds.length; j++) {
      const id1 = tokenIds[i];
      const id2 = tokenIds[j];
      const old1 = scenario.world.tokens.get(id1)!.coord;
      const old2 = scenario.world.tokens.get(id2)!.coord;
      const new1 = scenario.proposed.get(id1)!;
      const new2 = scenario.proposed.get(id2)!;
      if (
        !sameCoord(old1, new1) &&
        !sameCoord(old2, new2) &&
        sameCoord(new1, old2) &&
        sameCoord(new2, old1)
      ) {
        if (options.ignoreSwapperException) {
          pairs.push({ firstId: id1, secondId: id2 });
          continue;
        }
        const intent1 = scenario.resolvedIntentByComp.get(scenario.tokenToComponent.get(id1)!.id);
        const intent2 = scenario.resolvedIntentByComp.get(scenario.tokenToComponent.get(id2)!.id);
        const validSwapperPair =
          intent1?.kind === 'swap' &&
          intent2?.kind === 'swap' &&
          sameCoord(intent1.pivot, intent2.pivot);
        if (!validSwapperPair) pairs.push({ firstId: id1, secondId: id2 });
      }
    }
  }
  return pairs;
}

/** Эталонный вердикт: первая пара и её координаты в порядке старой подсветки. */
function referenceSwapConflict(scenario: SwapScenario): SwapPair | null {
  const first = referenceSwapPairs(scenario)[0];
  if (!first) return null;
  return {
    first: { ...scenario.world.tokens.get(first.firstId)!.coord },
    second: { ...scenario.world.tokens.get(first.secondId)!.coord },
  };
}

/** Что вернула оптимизированная функция движка, в том же формате. */
function engineSwapConflict(scenario: SwapScenario): SwapPair | null {
  const ordered = sortedTokens(scenario.world);
  const index = buildTokenStartIndex(ordered);
  const conflict = findHeadOnSwapConflict(
    scenario.world,
    index,
    ordered,
    scenario.tokenToComponent,
    scenario.resolvedIntentByComp,
    scenario.proposed,
  );
  if (!conflict) return null;
  return { first: { ...conflict.firstCoord }, second: { ...conflict.secondCoord } };
}

/**
 * Сценарий с явными намерениями: намерения задаются на компонент (по его первой
 * сфере), предложенные координаты считаются по правилам move/swap.
 */
function buildSwapScenario(
  world: SimulationWorld,
  dirs: Map<string, SwapIntentSpec>,
  reverseOrder = false,
): SwapScenario {
  if (reverseOrder) reverseStorageOrder(world);
  const components = getConnectedComponents(world);
  const tokenToComponent = new Map<string, ConnectedComponent>();
  const intentsByComp = new Map<string, ComponentIntent[]>();
  const resolvedIntentByComp = new Map<string, ComponentIntent | null>();
  const proposed = new Map<string, AxialCoord>();

  for (const comp of components) {
    for (const id of comp.tokenIds) tokenToComponent.set(id, comp);
    const spec = dirs.get(comp.tokenIds[0]);
    const intent: ComponentIntent | null = !spec
      ? null
      : spec.kind === 'move'
        ? {
            kind: 'move',
            dir: spec.dir as never,
            tier: 1,
            signature: `move:${spec.dir}`,
            sourceCoord: { q: 0, r: 0 },
            sourceMachineType: 'conveyor',
          }
        : spec.kind === 'jump'
        ? {
            kind: 'jump',
            dir: spec.dir as never,
            tier: 2,
            signature: `jump:${spec.dir}`,
            sourceCoord: { q: 0, r: 0 },
            sourceMachineType: 'jumper',
          }
        : {
            kind: 'swap',
            pivot: { ...spec.pivot! },
            tier: 2,
            signature: `swap:${spec.pivot!.q},${spec.pivot!.r}`,
            sourceCoord: { ...spec.pivot! },
            sourceMachineType: 'swapper',
          };
    intentsByComp.set(comp.id, intent ? [intent] : []);
    resolvedIntentByComp.set(comp.id, intent);

    for (const id of comp.tokenIds) {
      const tok = world.tokens.get(id)!;
      if (!intent) proposed.set(id, { ...tok.coord });
      else if (intent.kind === 'move') proposed.set(id, hexNeighbor(tok.coord, intent.dir));
      else if (intent.kind === 'jump') proposed.set(id, hexNeighbor(hexNeighbor(tok.coord, intent.dir), intent.dir));
      else if (intent.kind === 'swap') proposed.set(id, rotateAroundPivot(tok.coord, intent.pivot, 3));
      else proposed.set(id, { ...tok.coord });
    }
  }

  return { world, components, tokenToComponent, intentsByComp, resolvedIntentByComp, proposed };
}

interface SwapCase {
  level: ReturnType<typeof auditLevel>;
  tokens: Array<{ id: string; value: number; q: number; r: number; order: number }>;
  dirs: Map<string, SwapIntentSpec>;
}

/** Воспроизводимая конфигурация: до 7 сфер на диске радиуса 3 и их намерения. */
function makeSwapCase(trial: number, rnd: () => number): SwapCase {
  const level = auditLevel({ id: `swap-index-${trial}`, radius: 3 });
  const probe = createWorldFromLevel(level);
  const hexes = generateHexDisk(3);
  const chosen: AxialCoord[] = [];
  const tokenCount = 2 + Math.floor(rnd() * 6);

  // В трети конфигураций первая пара сфер — гарантированная пара сваппера
  // (pivot ± dir): так исключение `swapper` попадает в выборку вместе с
  // обычными обменами, в том числе в одном такте с ними.
  const swapperPairByCoord = new Map<string, AxialCoord>();
  if (rnd() < 0.35) {
    for (let attempt = 0; attempt < 8 && swapperPairByCoord.size === 0; attempt++) {
      const pivot = hexes[Math.floor(rnd() * hexes.length)];
      const dir = Math.floor(rnd() * 6) as 0 | 1 | 2 | 3 | 4 | 5;
      const from = hexNeighbor(pivot, dir);
      const to = hexNeighbor(pivot, ((dir + 3) % 6) as 0 | 1 | 2 | 3 | 4 | 5);
      if (!probe.platformHexes.has(hexKey(from)) || !probe.platformHexes.has(hexKey(to))) continue;
      chosen.push(from, to);
      swapperPairByCoord.set(hexKey(from), pivot);
      swapperPairByCoord.set(hexKey(to), pivot);
    }
  }

  for (let i = 0; i < tokenCount; i++) {
    const hex = hexes[Math.floor(rnd() * hexes.length)];
    if (chosen.some((c) => hexKey(c) === hexKey(hex))) continue;
    chosen.push(hex);
  }
  chosen.forEach((hex, index) => {
    addToken(probe, `t${index + 1}`, index + 1, hex.q, hex.r, index + 1);
  });

  const dirs = new Map<string, SwapIntentSpec>();
  const tokenList = [...probe.tokens.values()];
  for (const tok of tokenList) {
    const swapperPivot = swapperPairByCoord.get(hexKey(tok.coord));
    if (swapperPivot) {
      dirs.set(tok.id, { kind: 'swap', pivot: { ...swapperPivot } });
      continue;
    }
    const roll = rnd();
    // Часть случаев — намерение swapper, чтобы исключение тоже попало в выборку.
    if (roll < 0.25) {
      const pivot = hexNeighbor(tok.coord, Math.floor(rnd() * 6) as 0 | 1 | 2 | 3 | 4 | 5);
      const dest = rotateAroundPivot(tok.coord, pivot, 3);
      if (!probe.platformHexes.has(hexKey(pivot)) || !probe.platformHexes.has(hexKey(dest))) continue;
      dirs.set(tok.id, { kind: 'swap', pivot });
      continue;
    }

    // Треть случаев намеренно направлена на соседнюю сферу: это повышает долю
    // встречных обменов и тактов с несколькими обменами, не делая выборку
    // искусственной (платформа и ограничения намерений те же).
    let dir: number | null = null;
    if (roll < 0.6) {
      const other = tokenList[Math.floor(rnd() * tokenList.length)];
      if (other.id !== tok.id) dir = dirTowards(tok.coord, other.coord);
    }
    if (dir === null) dir = Math.floor(rnd() * 6);
    // Намерения ограничены платформой, чтобы проверка обмена действительно
    // выполнялась (иначе такт отклоняется раньше — край или корпус).
    if (!probe.platformHexes.has(hexKey(hexNeighbor(tok.coord, dir as 0 | 1 | 2 | 3 | 4 | 5)))) continue;
    dirs.set(tok.id, { kind: 'move', dir });
  }

  // Гарантированные встречные обмены: в половине конфигураций 1–2 пары
  // соседних сфер направляются друг на друга. Это повышает плотность проверки
  // обмена и даёт такты с несколькими независимыми обменами сразу.
  const exchangeTargets = rnd() < 0.6 ? 2 : 0;
  const usedInExchange = new Set<string>();
  for (let pair = 0; pair < exchangeTargets; pair++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const first = tokenList[Math.floor(rnd() * tokenList.length)];
      const second = tokenList[Math.floor(rnd() * tokenList.length)];
      if (!first || !second || first.id === second.id) continue;
      if (usedInExchange.has(first.id) || usedInExchange.has(second.id)) continue;
      const firstToSecond = dirTowards(first.coord, second.coord);
      const secondToFirst = dirTowards(second.coord, first.coord);
      if (firstToSecond === null || secondToFirst === null) continue;
      if (!probe.platformHexes.has(hexKey(hexNeighbor(first.coord, firstToSecond as 0 | 1 | 2 | 3 | 4 | 5)))) continue;
      dirs.set(first.id, { kind: 'move', dir: firstToSecond });
      dirs.set(second.id, { kind: 'move', dir: secondToFirst });
      usedInExchange.add(first.id);
      usedInExchange.add(second.id);
      break;
    }
  }

  return {
    level,
    tokens: [...probe.tokens.values()].map((tok) => ({
      id: tok.id,
      value: tok.value,
      q: tok.coord.q,
      r: tok.coord.r,
      order: tok.spawnOrder,
    })),
    dirs,
  };
}

function instantiateSwapCase(spec: SwapCase, reverseOrder: boolean): SwapScenario {
  const world = createWorldFromLevel(spec.level);
  for (const tok of spec.tokens) addToken(world, tok.id, tok.value, tok.q, tok.r, tok.order);
  return buildSwapScenario(world, spec.dirs, reverseOrder);
}

test('swap index (PR #4C): the index search picks the same conflicting pair as the old O(n²) scan on 1500 seeded configurations', () => {
  const rnd = mulberry32(20260101);
  let collisions = 0;
  let allowed = 0;
  let multiSwap = 0;
  let swapperExcused = 0;

  for (let trial = 0; trial < 1500; trial++) {
    const spec = makeSwapCase(trial, rnd);
    const forward = instantiateSwapCase(spec, false);
    const backward = instantiateSwapCase(spec, true);

    const refForward = referenceSwapConflict(forward);
    const refBackward = referenceSwapConflict(backward);
    assert.deepEqual(refBackward, refForward, `trial ${trial}: эталон обязан быть независим от порядка Map`);

    const newForward = engineSwapConflict(forward);
    const newBackward = engineSwapConflict(backward);
    assert.deepEqual(
      newForward,
      refForward,
      `trial ${trial}: индекс и перебор выбрали разные пары (index=${JSON.stringify(newForward)}, ref=${JSON.stringify(refForward)})`,
    );
    assert.deepEqual(newBackward, refForward, `trial ${trial}: обратный порядок Map изменил решение`);

    if (refForward) collisions += 1;
    else allowed += 1;
    if (referenceSwapPairs(forward).length > 1) multiSwap += 1;
    // Исключение swapper действительно встречается в выборке: обмен есть, но
    // он разрешён общим пивотом двух свапперов.
    if (referenceSwapPairs(forward, { ignoreSwapperException: true }).length >
        referenceSwapPairs(forward).length) {
      swapperExcused += 1;
    }
  }

  assert.equal(collisions + allowed, 1500);
  assert.ok(collisions > 100, `выборка должна содержать встречные столкновения (${collisions})`);
  assert.ok(allowed > 10, `выборка должна содержать легальные обмены (${allowed})`);
  assert.ok(multiSwap > 5, `выборка должна содержать такты с несколькими обменами одновременно (${multiSwap})`);
  assert.ok(swapperExcused > 5, `выборка должна содержать обмены, разрешённые сваппером (${swapperExcused})`);
  console.log(
    `\n=== PR #4C: индекс обмена — 1500 конфигураций × 2 порядка Map: ` +
      `${collisions} обменов, ${allowed} без обмена, ${multiSwap} с несколькими обменами одновременно, ` +
      `${swapperExcused} обменов, разрешённых сваппером ===\n`,
  );
});

test('swap index (PR #4C): the collision phase reports the same pair, message and highlight as the reference on 1500 configurations', () => {
  const rnd = mulberry32(20260202);
  let swapTicks = 0;
  let earlierChecks = 0;

  for (let trial = 0; trial < 1500; trial++) {
    const spec = makeSwapCase(trial, rnd);
    for (const reverseOrder of [false, true]) {
      const scenario = instantiateSwapCase(spec, reverseOrder);
      const reference = referenceSwapConflict(scenario);
      const result = resolveMovement(
        scenario.world,
        scenario.components,
        scenario.tokenToComponent,
        scenario.intentsByComp,
      );
      const reason = scenario.world.errorReason ?? '';
      const reportedSwap = result === null && reason === 'Встречное столкновение сфер при обмене соседними гексами';

      if (reference) {
        // Встречный обмен обязан отклонить такт — либо этой проверкой, либо
        // более ранним классом (край, корпус, разлом, наложение).
        assert.equal(result, null, `trial ${trial}: обмен обнаружен эталоном, но такт принят (reverse=${reverseOrder})`);
      }

      assert.equal(
        reportedSwap,
        reference !== null && reason === 'Встречное столкновение сфер при обмене соседними гексами',
        `trial ${trial}: класс ошибки не совпал с эталоном (reason=${reason}, reverse=${reverseOrder})`,
      );
      if (reportedSwap) {
        assert.deepEqual(
          scenario.world.errorHighlightHexes,
          [reference!.first, reference!.second],
          `trial ${trial}: подсветка пары не совпала с эталоном (reverse=${reverseOrder})`,
        );
        swapTicks += 1;
      } else if (reference) {
        // Обмен найден, но такт отклонён более ранним классом проверок.
        earlierChecks += 1;
      } else {
        // Обмена нет: движок не должен сообщать «Встречное столкновение».
        assert.notEqual(reason, 'Встречное столкновение сфер при обмене соседними гексами');
      }
    }
  }

  assert.ok(swapTicks > 10, `выборка должна содержать такты, отклонённые проверкой обмена (${swapTicks})`);
  console.log(`\n=== PR #4C: обмены — ${swapTicks} тактов отклонено проверкой обмена, ${earlierChecks} — более ранним классом ===\n`);
});

test('swap index (PR #4C): several simultaneous exchanges report the pair that is first in canonical order, not the first in Map order', () => {
  // Две независимые пары обмена в одном такте: (a,b) на (-2,0)/(-1,0) и (c,d) на
  // (2,0)/(3,0). Меньший spawnOrder — у пары справа, поэтому канонический порядок
  // выбирает именно её, хотя по координате она дальше. Старый двойной цикл и
  // индексный поиск обязаны выбрать одну и ту же пару при любом порядке Map.
  const level = levelWithPresets('C-two-swaps', [
    preset('conveyor', -2, 0, { dir: 0 }),
    preset('conveyor', -1, 0, { dir: 3 }),
    preset('conveyor', 2, 0, { dir: 0 }),
    preset('conveyor', 3, 0, { dir: 3 }),
  ], { radius: 4 });

  // `reverseSpawn=false`: меньший spawnOrder у правой пары (d, c), поэтому
  // первой обязана идти она — несмотря на бо́льшую координату `q`.
  // `reverseSpawn=true`: порядок происхождения перевёрнут, первой идёт левая пара.
  const build = (reverseStorage: boolean, reverseSpawn: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    const rows: Array<[string, number, number, number, number]> = reverseSpawn
      ? [['a', 1, -2, 0, 1], ['b', 2, -1, 0, 2], ['c', 3, 2, 0, 3], ['d', 4, 3, 0, 4]]
      : [['a', 1, -2, 0, 4], ['b', 2, -1, 0, 3], ['c', 3, 2, 0, 2], ['d', 4, 3, 0, 1]];
    for (const [id, value, q, r, order] of rows) addToken(world, id, value, q, r, order);
    return reverseStorage ? reverseStorageOrder(world) : world;
  };

  for (const reverseStorage of [false, true]) {
    for (const reverseSpawn of [false, true]) {
      const world = build(reverseStorage, reverseSpawn);
      const dirs = new Map<string, SwapIntentSpec>();
      for (const tok of world.tokens.values()) {
        dirs.set(tok.id, { kind: 'move', dir: tok.id === 'a' || tok.id === 'c' ? 0 : 3 });
      }
      const scenario = buildSwapScenario(world, dirs);

      // Эталон перебирает пары в каноническом порядке и берёт первую.
      const reference = referenceSwapConflict(scenario);
      assert.ok(reference, 'эталон обязан найти обмен');
      assert.deepEqual(engineSwapConflict(scenario), reference);

      // Первой в подсветке идёт сфера, которая раньше в каноническом порядке:
      // при `reverseSpawn=false` это `d` на (3,0), при `true` — `a` на (-2,0).
      const expectedFirst = reverseSpawn ? { q: -2, r: 0 } : { q: 3, r: 0 };
      const expectedSecond = reverseSpawn ? { q: -1, r: 0 } : { q: 2, r: 0 };
      assert.deepEqual(reference.first, expectedFirst, 'выбор пары обязан опираться на spawnOrder, а не на координату');
      assert.deepEqual(reference.second, expectedSecond);

      const result = resolveMovement(scenario.world, scenario.components, scenario.tokenToComponent, scenario.intentsByComp);
      assert.equal(result, null);
      assert.equal(
        scenario.world.errorReason,
        'Встречное столкновение сфер при обмене соседними гексами',
        `reverseStorage=${reverseStorage}, reverseSpawn=${reverseSpawn}: проверка обмена обязана срабатывать раньше наложения`,
      );
      assert.deepEqual(scenario.world.errorHighlightHexes, [expectedFirst, expectedSecond], 'подсветка обязана совпасть с эталоном');
    }
  }
});

test('swap index (PR #4C): both sides of one swapper stay legal in the reference and in the engine', () => {
  const swapperWorld = createWorldFromLevel(levelWithPresets('C-swap-exception', [
    preset('swapper', 0, 0, { dir: 0 }),
  ], { radius: 3 }));
  addToken(swapperWorld, 'left', 1, -1, 0, 1);
  addToken(swapperWorld, 'right', 2, 1, 0, 2);
  const dirs = new Map<string, SwapIntentSpec>([
    ['left', { kind: 'swap', pivot: { q: 0, r: 0 } }],
    ['right', { kind: 'swap', pivot: { q: 0, r: 0 } }],
  ]);

  for (const reverseOrder of [false, true]) {
    const scenario = buildSwapScenario(swapperWorldClone(reverseOrder), dirs, false);
    assert.equal(referenceSwapConflict(scenario), null, 'исключение swapper обязано работать в эталоне');
    assert.equal(engineSwapConflict(scenario), null, 'исключение swapper обязано работать в индексе');

    const result = resolveMovement(scenario.world, scenario.components, scenario.tokenToComponent, scenario.intentsByComp);
    assert.notEqual(result, null, 'разрешённый обмен сваппера не должен отклонять такт');
    assert.equal(scenario.world.errorReason, null);
  }

  function swapperWorldClone(reverseOrder: boolean): SimulationWorld {
    const world = createWorldFromLevel(levelWithPresets('C-swap-exception-clone', [
      preset('swapper', 0, 0, { dir: 0 }),
    ], { radius: 3 }));
    addToken(world, 'left', 1, -1, 0, 1);
    addToken(world, 'right', 2, 1, 0, 2);
    return reverseOrder ? reverseStorageOrder(world) : world;
  }
});

test('swap index (PR #4C): the swapper exception covers its own two-hex exchange, while two jumpers exchanging spheres collide', () => {
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

  // Эталон на той же конфигурации: прыжки строят те же предложенные координаты.
  const scenario = buildSwapScenario(
    (() => {
      const probe = createWorldFromLevel(levelWithPresets('C-jumper-exchange-ref', [
        preset('jumper', -1, 0, { dir: 0 }),
        preset('jumper', 1, 0, { dir: 3 }),
      ], { radius: 4 }));
      addToken(probe, 'left', 1, -1, 0, 1);
      addToken(probe, 'right', 2, 1, 0, 2);
      return probe;
    })(),
    new Map<string, SwapIntentSpec>([
      ['left', { kind: 'jump', dir: 0 }],
      ['right', { kind: 'jump', dir: 3 }],
    ]),
  );
  const reference = referenceSwapConflict(scenario);
  assert.deepEqual(reference, { first: { q: -1, r: 0 }, second: { q: 1, r: 0 } });
  assert.deepEqual(engineSwapConflict(scenario), reference);
  assert.deepEqual(world.errorHighlightHexes, [reference!.first, reference!.second]);
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

test('intents: equal tier+signature intents resolve to the machine with the smaller source coordinate, independent of Map order', () => {
  const build = (reverseMap: boolean): SimulationWorld => {
    const presets = [
      preset('conveyor', 0, 0, { dir: 0 }),
      preset('conveyor', 1, 0, { dir: 0 }),
    ];
    const world = createWorldFromLevel(levelWithPresets(`C-equal-intent-${reverseMap}`, reverseMap ? [...presets].reverse() : presets, { radius: 4 }));
    addToken(world, 'a', 2, 0, 0, 1);
    addToken(world, 'b', 3, 1, 0, 2);
    bondTokens(world, 'a', 'b');
    return reverseMap ? reverseStorageOrder(world) : world;
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
  assertMatchesRule(tokensAt(forward), tokensAt(reverse), 'координаты обязаны совпадать');
  assertMatchesRule('2@1,0 3@2,0', tokensAt(forward), 'полимер едет целиком');
  assertMatchesRule(flash(forward), flash(reverse), 'вспышка механизма не зависит от порядка хранения');
  assertMatchesRule('0,0=1,1,0=0', flash(forward), 'источником действия считается лента с меньшей координатой');
});

test('intents: pusher and magnet pulling one sphere in the same direction pick the same source and moveSource regardless of Map order', () => {
  const build = (reverseMap: boolean): SimulationWorld => {
    const presets = [
      preset('pusher', -1, 0, { dir: 0 }),
      preset('magnet', 2, 0, { dir: 3 }),
    ];
    const world = createWorldFromLevel(levelWithPresets(`C-pusher-magnet-${reverseMap}`, reverseMap ? [...presets].reverse() : presets, { radius: 4 }));
    addToken(world, 't', 5, 0, 0, 1);
    return reverseMap ? reverseStorageOrder(world) : world;
  };
  const forward = build(false);
  const reverse = build(true);
  stepSimulation(forward);
  stepSimulation(reverse);

  assertMatchesRule(tokensAt(forward), tokensAt(reverse), 'координаты обязаны совпадать');
  assertMatchesRule('5@1,0', tokensAt(forward));
  const source = (world: SimulationWorld) => ({
    moveSource: world.tokens.get('t')!.moveSource,
    pushChainIndex: world.tokens.get('t')!.pushChainIndex,
  });
  assertMatchesRule(source(forward), source(reverse), 'метаданные источника не зависят от порядка хранения');
  assertMatchesRule({ moveSource: 'pusher', pushChainIndex: 0 }, source(forward), 'побеждает источник с меньшей координатой');
});

test('collision audit summary: no documented divergence remains in the collision suite', () => {
  const ids = documentedViolations().map((v) => v.id).sort();
  // Все расхождения этого файла исправлены в PR #4B (общий выход источников,
  // равнозначные намерения, метаданные источника). Реестр обязан быть пустым.
  assert.deepEqual(ids, []);
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
