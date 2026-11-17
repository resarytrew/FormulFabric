/**
 * PR #4C — воспроизводимые измерения производительности двух оптимизаций.
 *
 * Запуск (не входит в `npm test` и не замедляет обычный прогон):
 *
 *   npx tsx scripts/perf-movement-indexes.ts
 *   npx tsx scripts/perf-movement-indexes.ts --json   # только машиночитаемый вывод
 *
 * Что измеряется:
 *
 *  A. Проверка встречного обмена (`collisions.ts`).
 *     - «старый» алгоритм — двойной цикл по всем парам сфер (копия кода до #4C);
 *     - «новый» — каноническая сортировка + локальный индекс `гекс → сфера` +
 *       один проход. Время построения индекса и время поиска измеряются
 *       отдельно, а также вместе с сортировкой (полная фаза проверки).
 *
 *  B. Занятость выходов источников (`spawning.ts`).
 *     - «старый» — `Array.from(world.tokens.values()).some(...)` на каждый источник;
 *     - «новый» — локальный `Set<HexKey>`: построение индекса и проверки `has`
 *       измеряются отдельно, плюс полная фаза `activateSpawners` обеих версий.
 *
 * Методика: прогревочные прогоны, несколько повторений, медиана, одинаковые
 * входные данные. Перед измерениями обе реализации сверяются на каждом наборе
 * данных (иначе замер бессмыслен). Жёстких порогов времени здесь нет: скрипт
 * печатает числа, решение принимает человек.
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { createMachineInstance, createWorldFromLevel, getConnectedComponents } from '../src/engine/hex-engine';
import { activateSpawners } from '../src/engine/spawning';
import { buildTokenStartIndex, findHeadOnSwapConflict } from '../src/engine/collisions';
import { sortedMachines, sortedTokens } from '../src/engine/deterministic-order';
import { generateHexDisk, hexKey, hexNeighbor } from '../src/engine/hex-math';
import { pushEvent, triggerError } from '../src/engine/events';
import { isInRange } from '../src/engine/operations';
import { SOLID_MACHINE_TYPES } from '../src/engine/world';
import type { ConnectedComponent } from '../src/engine/components';
import type { ComponentIntent } from '../src/engine/movement-types';
import type {
  AxialCoord,
  HexKey,
  LevelDefinition,
  SimulationWorld,
  Token,
} from '../src/engine/types';

// ---------------------------------------------------------------------------
// Измерительный каркас
// ---------------------------------------------------------------------------

interface TimingOptions {
  /** Прогревочные прогоны (не учитываются). */
  warmup?: number;
  /** Число повторений; результат — медиана. */
  reps?: number;
  /** Сколько раз вызвать измеряемую операцию внутри одного повторения. */
  inner?: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Медианное время одной операции в миллисекундах. */
function measure(operation: () => void, options: TimingOptions = {}): number {
  const { warmup = 8, reps = 15, inner = 1 } = options;
  for (let i = 0; i < warmup; i++) {
    for (let k = 0; k < inner; k++) operation();
  }
  const samples: number[] = [];
  for (let r = 0; r < reps; r++) {
    const started = performance.now();
    for (let k = 0; k < inner; k++) operation();
    samples.push((performance.now() - started) / inner);
  }
  return median(samples);
}

const fmtMs = (ms: number): string => (ms >= 1 ? ms.toFixed(3) : ms.toFixed(5));
const fmtSpeedup = (slow: number, fast: number): string =>
  `${(slow / Math.max(fast, 1e-9)).toFixed(2)}×`;

// ---------------------------------------------------------------------------
// Общие вспомогательные функции
// ---------------------------------------------------------------------------

function emptyLevel(id: string, radius: number): LevelDefinition {
  return {
    id,
    index: 999,
    title: id,
    subtitle: '',
    tier: 'Средний',
    radius,
    availableTools: [],
    requiredDeliveries: 1,
    presetMachines: [],
    pedagogyNote: '',
    bonusGoalText: '',
  };
}

function addSpawnerMachine(
  world: SimulationWorld,
  coord: AxialCoord,
  dir: 0 | 1 | 2 | 3 | 4 | 5,
  sequence: number[],
  spawnInterval: number,
): void {
  const machine = createMachineInstance(
    `m_${world.machines.size + 1}`,
    'spawner',
    coord,
    true,
    { dir, sequence, spawnInterval, loopSequence: false },
  );
  world.machines.set(hexKey(coord), machine);
}

function addTokenAt(world: SimulationWorld, id: string, value: number, coord: AxialCoord, order: number): Token {
  const token: Token = {
    id,
    value,
    prevValue: value,
    coord: { ...coord },
    prevCoord: { ...coord },
    spawnOrder: order,
  };
  world.tokens.set(id, token);
  return token;
}

// ---------------------------------------------------------------------------
// A. Встречный обмен
// ---------------------------------------------------------------------------

/** Координаты для `count` сфер на диске достаточно большого радиуса. */
function hexesFor(count: number): AxialCoord[] {
  let radius = 1;
  while (generateHexDisk(radius).length < count) radius += 1;
  return generateHexDisk(radius).slice(0, count);
}

interface SwapBenchState {
  world: SimulationWorld;
  ordered: Token[];
  tokenToComponent: Map<string, ConnectedComponent>;
  resolvedIntentByComp: Map<string, ComponentIntent | null>;
  proposed: Map<string, AxialCoord>;
  /** Сколько сфер участвует в обмене (для сверки реализаций). */
  expectedConflict: string | null;
}

/**
 * `swaps`: 0 — обменов нет (худший случай для старого перебора),
 * 1 — один обмен в самом конце канонического порядка (старый перебор обязан
 * пройти почти все пары прежде чем найти его).
 */
function buildSwapBench(count: number, swaps: 0 | 1): SwapBenchState {
  const hexes = hexesFor(count);
  const world = createWorldFromLevel(emptyLevel(`perf-swap-${count}-${swaps}`, 2));
  const orderedTokens = hexes.map((coord, index) =>
    addTokenAt(world, `t${index + 1}`, index + 1, coord, index + 1),
  );

  const proposed = new Map<string, AxialCoord>();
  for (const tok of orderedTokens) {
    // Все сферы двигаются на восток: это типичный такт ленты и заодно заставляет
    // индексный поиск реально обращаться к Map на каждой сфере.
    proposed.set(tok.id, { q: tok.coord.q + 1, r: tok.coord.r });
  }

  let expectedConflict: string | null = null;
  if (swaps === 1 && count >= 2) {
    const a = orderedTokens[count - 2];
    const b = orderedTokens[count - 1];
    proposed.set(a.id, { ...b.coord });
    proposed.set(b.id, { ...a.coord });
    expectedConflict = `${hexKey(a.coord)}<->${hexKey(b.coord)}`;
  }

  const components = getConnectedComponents(world);
  const tokenToComponent = new Map<string, ConnectedComponent>();
  const resolvedIntentByComp = new Map<string, ComponentIntent | null>();
  for (const comp of components) {
    for (const id of comp.tokenIds) tokenToComponent.set(id, comp);
    resolvedIntentByComp.set(comp.id, null);
  }

  return {
    world,
    ordered: sortedTokens(world),
    tokenToComponent,
    resolvedIntentByComp,
    proposed,
    expectedConflict,
  };
}

/** Копия проверки обмена до PR #4C: двойной цикл по всем парам. */
function oldSwapScan(state: SwapBenchState): string | null {
  const tokenIds = state.ordered.map((tok) => tok.id);
  for (let i = 0; i < tokenIds.length; i++) {
    for (let j = i + 1; j < tokenIds.length; j++) {
      const id1 = tokenIds[i];
      const id2 = tokenIds[j];
      const old1 = state.world.tokens.get(id1)!.coord;
      const old2 = state.world.tokens.get(id2)!.coord;
      const new1 = state.proposed.get(id1)!;
      const new2 = state.proposed.get(id2)!;
      const same = (a: AxialCoord, b: AxialCoord) => a.q === b.q && a.r === b.r;
      if (!same(old1, new1) && !same(old2, new2) && same(new1, old2) && same(new2, old1)) {
        const intent1 = state.resolvedIntentByComp.get(state.tokenToComponent.get(id1)!.id);
        const intent2 = state.resolvedIntentByComp.get(state.tokenToComponent.get(id2)!.id);
        const validSwapperPair =
          intent1?.kind === 'swap' && intent2?.kind === 'swap' && same(intent1.pivot, intent2.pivot);
        if (!validSwapperPair) return `${hexKey(old1)}<->${hexKey(old2)}`;
      }
    }
  }
  return null;
}

function newSwapScan(state: SwapBenchState, index = buildTokenStartIndex(state.ordered)): string | null {
  const conflict = findHeadOnSwapConflict(
    state.world,
    index,
    state.ordered,
    state.tokenToComponent,
    state.resolvedIntentByComp,
    state.proposed,
  );
  return conflict ? `${hexKey(conflict.firstCoord)}<->${hexKey(conflict.secondCoord)}` : null;
}

// ---------------------------------------------------------------------------
// B. Занятость выходов источников
// ---------------------------------------------------------------------------

interface SpawnBenchState {
  world: SimulationWorld;
  exits: HexKey[];
}

/**
 * Все выходы заняты сферой, поэтому обе реализации фазы не меняют состояние
 * (кроме журнала событий) и замер можно повторять на одном мире.
 */
function buildSpawnBench(spawnerCount: number, tokenCount: number): SpawnBenchState {
  // Запас в 3 гекса: источники ставим только там, где выход гарантированно
  // остаётся на платформе, иначе фаза обрывается ошибкой и замер бессмыслен.
  const radius = Math.max(4, Math.ceil(Math.sqrt(Math.max(spawnerCount, tokenCount) / 2)) + 4);
  const world = createWorldFromLevel(emptyLevel(`perf-spawn-${spawnerCount}-${tokenCount}`, radius));
  const hexes = generateHexDisk(radius);

  const innerHexes = hexes.filter((h) => (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2 <= radius - 3);
  if (innerHexes.length < spawnerCount) {
    throw new Error(`недостаточно гексов для ${spawnerCount} источников (${innerHexes.length})`);
  }
  // Источники расставляем так, чтобы ни один выход не попадал в корпус другого
  // источника: иначе фаза обрывается ошибкой «источник направлен внутрь корпуса»
  // и замер перестаёт что-либо измерять.
  const spawnerCoords: AxialCoord[] = [];
  const usedKeys = new Set<HexKey>();
  const exits: HexKey[] = [];
  for (const coord of innerHexes) {
    if (spawnerCoords.length >= spawnerCount) break;
    const exitKey = hexKey(hexNeighbor(coord, 3));
    if (usedKeys.has(hexKey(coord)) || usedKeys.has(exitKey)) continue;
    spawnerCoords.push(coord);
    usedKeys.add(hexKey(coord));
    usedKeys.add(exitKey);
    exits.push(exitKey);
  }
  if (spawnerCoords.length < spawnerCount) {
    throw new Error(`не удалось расставить ${spawnerCount} источников (${spawnerCoords.length})`);
  }
  for (const coord of spawnerCoords) addSpawnerMachine(world, coord, 3, [1, 2, 3], 1);

  // По одной сфере на каждый выход (занято) + остальные на свободные гексы.
  let order = 1;
  const blocked = new Set<string>();
  for (const key of exits) {
    if (blocked.has(key)) continue;
    const [q, r] = key.split(',').map(Number);
    addTokenAt(world, `b${order}`, order, { q, r }, order);
    blocked.add(key);
    order += 1;
  }
  for (const hex of hexes) {
    if (order > tokenCount) break;
    if (blocked.has(hexKey(hex))) continue;
    if (world.machines.has(hexKey(hex))) continue;
    addTokenAt(world, `t${order}`, order, hex, order);
    blocked.add(hexKey(hex));
    order += 1;
  }

  return { world, exits };
}

/** Копия `activateSpawners` до PR #4C: перебор всех сфер на каждый источник. */
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
      if (machine.config.loopSequence) machine.state.spawnIndex = 0;
      else continue;
    }
    const spawnCoord = hexNeighbor(machine.coord, machine.config.dir);
    const spawnKey = hexKey(spawnCoord);
    if (!world.platformHexes.has(spawnKey)) {
      triggerError(world, 'Источник направлен за пределы платформы', [machine.coord, spawnCoord], 'error');
      return false;
    }
    const spawnDestMachine = world.machines.get(spawnKey);
    if (spawnDestMachine && SOLID_MACHINE_TYPES.has(spawnDestMachine.type)) {
      triggerError(world, `Источник направлен внутрь корпуса механизма (${spawnDestMachine.type})`, [machine.coord, spawnCoord], 'collision');
      return false;
    }
    const occupied = Array.from(world.tokens.values()).some((t) => t.coord.q === spawnCoord.q && t.coord.r === spawnCoord.r);
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
      triggerError(world, `Входное значение ${val} выходит за допустимый диапазон [${world.minValue}, ${world.maxValue}]`, [machine.coord], 'error');
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
    pushEvent(world, { type: 'spawn', coord: spawnCoord, message: `Выпущено число ${val}`, severity: 'info' });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Сверка реализаций перед измерениями
// ---------------------------------------------------------------------------

function assertEquivalentSwap(count: number, swaps: 0 | 1): SwapBenchState {
  const state = buildSwapBench(count, swaps);
  const oldResult = oldSwapScan(state);
  const newResult = newSwapScan(state);
  if (oldResult !== state.expectedConflict || newResult !== state.expectedConflict) {
    throw new Error(
      `swap benchmark ${count}/${swaps}: old=${oldResult}, new=${newResult}, expected=${state.expectedConflict}`,
    );
  }
  return state;
}

function assertEquivalentSpawn(spawnerCount: number, tokenCount: number): SpawnBenchState {
  const state = buildSpawnBench(spawnerCount, tokenCount);
  const newWorld = structuredClone(state.world);
  const oldWorld = structuredClone(state.world);
  activateSpawners(newWorld, new Set());
  activateSpawnersBeforePR4C(oldWorld, new Set());
  const signature = (world: SimulationWorld): string =>
    JSON.stringify({
      tokens: world.tokens.size,
      events: world.events.map((e) => `${e.type}:${hexKey(e.coord)}`),
      machines: sortedMachines(world).map((m) => `${m.state.spawnIndex}/${m.state.cooldown}`),
    });
  if (signature(newWorld) !== signature(oldWorld)) {
    throw new Error(`spawn benchmark ${spawnerCount}/${tokenCount}: реализации разошлись`);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

interface Row {
  [column: string]: string | number;
}

function printTable(title: string, columns: string[], rows: Row[]): void {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((row) => String(row[c] ?? '').length)));
  const line = (cells: string[]) => `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  console.log(`\n${title}`);
  console.log(line(columns));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const row of rows) console.log(line(columns.map((c) => String(row[c] ?? ''))));
}

function main(): void {
  const jsonOnly = process.argv.includes('--json');
  if (!jsonOnly) {
    console.log('FormulFabric — измерения PR #4C (оптимизация движения)');
    console.log(`Node ${process.version} · ${os.cpus()[0]?.model ?? 'unknown CPU'} · ${process.platform}/${process.arch}`);
    console.log('Методика: прогревочные прогоны, 15 повторений, медиана. Время — миллисекунды на одну операцию.');
  }

  const json: Record<string, unknown> = { environment: { node: process.version, cpu: os.cpus()[0]?.model, platform: process.platform } };

  // --- A. Встречный обмен ---------------------------------------------------
  // 10/20 — реалистичный размер игрового такта (в поставляемых уровнях
  // одновременно в мире не больше 5 сфер), 50–1000 — требуемые планом размеры.
  const swapSizes = [10, 20, 50, 100, 300, 1000];
  const swapRows: Row[] = [];
  for (const size of swapSizes) {
    const noSwap = assertEquivalentSwap(size, 0);
    const lateSwap = assertEquivalentSwap(size, 1);
    const lateIndex = buildTokenStartIndex(lateSwap.ordered);

    const oldNoSwap = measure(() => oldSwapScan(noSwap));
    const newNoSwapFull = measure(() => newSwapScan(noSwap));
    const newNoSwapIndex = measure(() => buildTokenStartIndex(noSwap.ordered));
    const prebuiltNoSwap = buildTokenStartIndex(noSwap.ordered);
    const newNoSwapLookup = measure(() => newSwapScan(noSwap, prebuiltNoSwap));

    const oldLate = measure(() => oldSwapScan(lateSwap));
    const newLateFull = measure(() => newSwapScan(lateSwap));
    const newLateLookup = measure(() => newSwapScan(lateSwap, lateIndex));

    const sortOnly = measure(() => sortedTokens(noSwap.world));

    swapRows.push({
      'сфер': size,
      'пар (старый)': (size * (size - 1)) / 2,
      'старый, без обмена': fmtMs(oldNoSwap),
      'новый: индекс': fmtMs(newNoSwapIndex),
      'новый: поиск': fmtMs(newNoSwapLookup),
      'новый: сортировка': fmtMs(sortOnly),
      'новый: фаза целиком': fmtMs(newNoSwapFull),
      'ускорение (без обмена)': fmtSpeedup(oldNoSwap, newNoSwapFull),
      'старый, обмен в конце': fmtMs(oldLate),
      'новый, обмен в конце': fmtMs(newLateFull),
      'ускорение (обмен в конце)': fmtSpeedup(oldLate, newLateFull),
    });

    json[`swap_${size}`] = {
      pairs: (size * (size - 1)) / 2,
      old_ms: oldNoSwap,
      new_index_build_ms: newNoSwapIndex,
      new_lookup_ms: newNoSwapLookup,
      new_sort_ms: sortOnly,
      new_full_phase_ms: newNoSwapFull,
      old_late_ms: oldLate,
      new_late_full_ms: newLateFull,
      new_late_lookup_ms: newLateLookup,
    };
  }

  printTable(
    'A. Проверка встречного обмена (indexed search vs двойной цикл)',
    [
      'сфер',
      'пар (старый)',
      'старый, без обмена',
      'новый: индекс',
      'новый: поиск',
      'новый: сортировка',
      'новый: фаза целиком',
      'ускорение (без обмена)',
      'старый, обмен в конце',
      'новый, обмен в конце',
      'ускорение (обмен в конце)',
    ],
    swapRows,
  );

  // --- B. Занятость выходов источников -------------------------------------
  const spawnConfigs: Array<[number, number]> = [
    // Первые две строки — реалистичный игровой масштаб (в поставляемых уровнях
    // не больше 3 источников и не больше 5 сфер одновременно).
    [1, 5],
    [3, 5],
    [1, 50],
    [10, 100],
    [50, 500],
    [200, 1000],
    [200, 5000],
  ];
  const spawnRows: Row[] = [];
  for (const [spawnerCount, tokenCount] of spawnConfigs) {
    const state = assertEquivalentSpawn(spawnerCount, tokenCount);
    const world = state.world;

    const buildSet = measure(() => {
      const set = new Set<HexKey>();
      for (const tok of world.tokens.values()) set.add(hexKey(tok.coord));
    });
    const newChecks = measure(() => {
      const set = new Set<HexKey>();
      for (const tok of world.tokens.values()) set.add(hexKey(tok.coord));
      for (const machine of state.exits) {
        if (set.has(machine)) continue;
      }
    });
    const oldChecks = measure(() => {
      for (const exit of state.exits) {
        const [q, r] = exit.split(',').map(Number);
        Array.from(world.tokens.values()).some((t) => t.coord.q === q && t.coord.r === r);
      }
    });

    // Полная фаза: обе реализации на одинаковом мире с занятыми выходами.
    const newPhaseWorld = structuredClone(world);
    const oldPhaseWorld = structuredClone(world);
    const clearEvents = (w: SimulationWorld) => {
      w.events.length = 0;
    };
    const newPhase = measure(() => {
      clearEvents(newPhaseWorld);
      activateSpawners(newPhaseWorld, new Set());
    });
    const oldPhase = measure(() => {
      clearEvents(oldPhaseWorld);
      activateSpawnersBeforePR4C(oldPhaseWorld, new Set());
    });

    spawnRows.push({
      'источников': spawnerCount,
      'сфер': world.tokens.size,
      'старый: проверки': fmtMs(oldChecks),
      'новый: Set': fmtMs(buildSet),
      'новый: Set + проверки': fmtMs(newChecks),
      'старый: фаза': fmtMs(oldPhase),
      'новый: фаза': fmtMs(newPhase),
      'ускорение (фаза)': fmtSpeedup(oldPhase, newPhase),
    });

    json[`spawn_${spawnerCount}_${tokenCount}`] = {
      spawners: spawnerCount,
      tokens: world.tokens.size,
      old_checks_ms: oldChecks,
      new_set_build_ms: buildSet,
      new_set_and_checks_ms: newChecks,
      old_phase_ms: oldPhase,
      new_phase_ms: newPhase,
    };
  }

  // --- B2. Такты, в которых проверка занятости не выполняется вовсе ---------
  const idleRows: Row[] = [];
  const idleState = assertEquivalentSpawn(200, 1000);
  const coolingWorld = structuredClone(idleState.world);
  for (const machine of coolingWorld.machines.values()) {
    if (machine.type === 'spawner') machine.state.cooldown = 1_000_000;
  }
  const coolingOld = measure(() => {
    coolingWorld.events.length = 0;
    activateSpawnersBeforePR4C(coolingWorld, new Set());
  });
  const coolingNew = measure(() => {
    coolingWorld.events.length = 0;
    activateSpawners(coolingWorld, new Set());
  });

  const noSpawnerWorld = createWorldFromLevel(emptyLevel('perf-spawn-none', 27));
  const noSpawnerHexes = generateHexDisk(27).filter((h) => (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2 <= 24);
  for (const coord of noSpawnerHexes.slice(0, 50)) {
    const machine = createMachineInstance(`m_${noSpawnerWorld.machines.size + 1}`, 'conveyor', coord, true, { dir: 0 });
    noSpawnerWorld.machines.set(hexKey(coord), machine);
  }
  let noSpawnerOrder = 1;
  for (const hex of generateHexDisk(27)) {
    if (noSpawnerOrder > 1000) break;
    if (noSpawnerWorld.machines.has(hexKey(hex))) continue;
    addTokenAt(noSpawnerWorld, `t${noSpawnerOrder}`, noSpawnerOrder, hex, noSpawnerOrder);
    noSpawnerOrder += 1;
  }
  const noSpawnerOld = measure(() => {
    noSpawnerWorld.events.length = 0;
    activateSpawnersBeforePR4C(noSpawnerWorld, new Set());
  });
  const noSpawnerNew = measure(() => {
    noSpawnerWorld.events.length = 0;
    activateSpawners(noSpawnerWorld, new Set());
  });

  idleRows.push(
    {
      'состояние': '200 источников, 1000 сфер, все на перезарядке',
      'старый: фаза': fmtMs(coolingOld),
      'новый: фаза': fmtMs(coolingNew),
      'новый: индекс': 'не строится',
      'отношение': fmtSpeedup(coolingOld, coolingNew),
    },
    {
      'состояние': 'нет источников (50 механизмов, 1000 сфер)',
      'старый: фаза': fmtMs(noSpawnerOld),
      'новый: фаза': fmtMs(noSpawnerNew),
      'новый: индекс': 'не строится',
      'отношение': fmtSpeedup(noSpawnerOld, noSpawnerNew),
    },
  );
  json['spawn_idle'] = {
    cooling_old_ms: coolingOld,
    cooling_new_ms: coolingNew,
    no_spawner_old_ms: noSpawnerOld,
    no_spawner_new_ms: noSpawnerNew,
  };

  printTable(
    'B. Занятость выходов источников (Set vs перебор всех сфер)',
    [
      'источников',
      'сфер',
      'старый: проверки',
      'новый: Set',
      'новый: Set + проверки',
      'старый: фаза',
      'новый: фаза',
      'ускорение (фаза)',
    ],
    spawnRows,
  );

  printTable(
    'B2. Такты, где проверка занятости не нужна (индекс строится лениво)',
    ['состояние', 'старый: фаза', 'новый: фаза', 'новый: индекс', 'отношение'],
    idleRows,
  );

  if (!jsonOnly) {
    console.log(
      '\nЗамечание: ускорение зависит от размера состояния и от загрузки машины; ' +
        'в CI жёсткие пороги времени не используются.',
    );
  }
  console.log(`\nJSON:\n${JSON.stringify(json, null, 2)}`);
}

main();
