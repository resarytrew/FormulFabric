/**
 * PR #4D — воспроизводимый замер стоимости точной проверки дуги поворота.
 *
 * Запуск (скрипт не входит в `npm test` и не замедляет обычный прогон):
 *
 *   npx tsx scripts/perf-rotation-sweep.ts
 *   npx tsx scripts/perf-rotation-sweep.ts --json   # только машиночитаемый вывод
 *
 * Что измеряется:
 *
 *  A. `getRotationSweptHexes` — чистая геометрия дуги для одной сферы.
 *     - «старый» — 10 равномерных выборок по дуге (копия кода до PR #4D);
 *     - «новый» — точное пересечение дуги с гексами (`rotation.ts` +
 *       `arc-geometry.ts`).
 *
 *  B. Полная фаза проверки дуги компонента (`findRotationArcObstacle`):
 *     перебор сфер полимера × гексы дуги × корпуса/чужие сферы, для трёх
 *     конфигураций — пустая дуга, одно препятствие, несколько препятствий.
 *
 * Методика: прогревочные прогоны, несколько повторений, медиана, одинаковые
 * входные данные. Жёстких порогов времени здесь нет: скрипт печатает числа,
 * решение принимает человек. Сравнение «старый/новый» — **только по времени**.
 * Корректность нового алгоритма доказывают тесты (`rotation-geometry.test.ts`):
 * на радиусах ≥ 6 старый и новый списки гексов расходятся по построению, и это
 * ровно исправленный дефект, а не ошибка замера. Скрипт лишь сообщает, на скольких
 * конфигурациях результаты различаются, и не трактует это как оценку верности.
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { findRotationArcObstacle } from '../src/engine/collisions';
import { compareCoords } from '../src/engine/deterministic-order';
import { createWorldFromLevel } from '../src/engine/hex-engine';
import { createMachineInstance } from '../src/engine/world';
import {
  generateHexDisk,
  hexDistance,
  hexKey,
  hexToWorld,
  rotateAroundPivot,
  worldToHex,
} from '../src/engine/hex-math';
import { getRotationSweptHexes } from '../src/engine/rotation';
import type { ConnectedComponent } from '../src/engine/components';
import type { ComponentIntent } from '../src/engine/movement-types';
import type { AxialCoord, HexKey, LevelDefinition, SimulationWorld, Token } from '../src/engine/types';

// ---------------------------------------------------------------------------
// Измерительный каркас (та же методика, что в scripts/perf-movement-indexes.ts)
// ---------------------------------------------------------------------------

interface TimingOptions {
  warmup?: number;
  reps?: number;
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
const fmtRatio = (slow: number, fast: number): string => `${(slow / Math.max(fast, 1e-9)).toFixed(2)}×`;

// ---------------------------------------------------------------------------
// «Старая» реализация дуги: копия алгоритма до PR #4D (10 выборок)
// ---------------------------------------------------------------------------

const LEGACY_SAMPLES = 10;

function legacySweptHexes(coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1): AxialCoord[] {
  if (hexDistance(coord, pivot) <= 1) return [];
  const dest = rotateAroundPivot(coord, pivot, cwSteps);
  const pivotWorld = hexToWorld(pivot);
  const startWorld = hexToWorld(coord);
  const dx = startWorld.x - pivotWorld.x;
  const dz = startWorld.z - pivotWorld.z;
  const total = cwSteps === 1 ? Math.PI / 3 : -Math.PI / 3;
  const seen = new Set<HexKey>([hexKey(coord), hexKey(dest), hexKey(pivot)]);
  const out: AxialCoord[] = [];
  for (let i = 1; i < LEGACY_SAMPLES; i++) {
    const angle = total * (i / LEGACY_SAMPLES);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hex = worldToHex(
      pivotWorld.x + (dx * cos - dz * sin),
      pivotWorld.z + (dx * sin + dz * cos),
    );
    const key = hexKey(hex);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hex);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Фикстуры: полимеры и уровни для фазы проверки дуги
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

function addSolidMachine(world: SimulationWorld, type: 'pusher' | 'spawner', coord: AxialCoord): void {
  const machine = createMachineInstance(`m_${world.machines.size + 1}`, type, coord, true, {
    dir: 3,
    sequence: [1],
    spawnInterval: 1,
    loopSequence: false,
  });
  world.machines.set(hexKey(coord), machine);
}

function addTokenAt(world: SimulationWorld, id: string, coord: AxialCoord, order: number): Token {
  const token: Token = {
    id,
    value: order,
    prevValue: order,
    coord: { ...coord },
    prevCoord: { ...coord },
    spawnOrder: order,
  };
  world.tokens.set(id, token);
  return token;
}

/** Кольцо гексов на расстоянии `radius` от пивота (0,0), в каноническом порядке. */
function ring(radius: number): AxialCoord[] {
  return generateHexDisk(radius)
    .filter((hex) => hexDistance(hex, { q: 0, r: 0 }) === radius)
    .sort(compareCoords);
}

/**
 * Полимер из `length` сфер, заканчивающийся на кольце радиуса `radius`.
 * Сферы стоят подряд по кольцу и на соседних кольцах — для замера важна только
 * геометрия дуг, а не связность цепочки.
 */
function polymerCoords(radius: number, length: number): AxialCoord[] {
  const out: AxialCoord[] = [];
  const outer = ring(radius);
  for (let i = 0; i < outer.length && out.length < length; i += Math.max(1, Math.floor(outer.length / length))) {
    out.push(outer[i]);
  }
  let innerRadius = radius - 1;
  while (out.length < length && innerRadius >= 2) {
    const inner = ring(innerRadius);
    out.push(inner[out.length % inner.length]);
    innerRadius -= 1;
  }
  while (out.length < length) out.push({ q: out.length + 2, r: 0 });
  return out.slice(0, length);
}

// ---------------------------------------------------------------------------
// A. Чистая геометрия: одна сфера
// ---------------------------------------------------------------------------

interface GeometryRow {
  radius: number;
  coord: HexKey;
  cwSteps: 1 | -1;
  legacyHexes: number;
  exactHexes: number;
  sameSet: boolean;
  legacyMs: number;
  exactMs: number;
}

function benchGeometry(): GeometryRow[] {
  const rows: GeometryRow[] = [];
  for (const radius of [2, 4, 6, 8, 15]) {
    const candidates = ring(radius);
    const stride = Math.max(1, Math.floor(candidates.length / 4));
    for (let i = 0; i < candidates.length; i += stride) {
      const coord = candidates[i];
      for (const steps of [1, -1] as const) {
        const legacy = legacySweptHexes(coord, { q: 0, r: 0 }, steps).map(hexKey);
        const exact = getRotationSweptHexes(coord, { q: 0, r: 0 }, steps).map(hexKey);
        const legacyMs = measure(() => legacySweptHexes(coord, { q: 0, r: 0 }, steps), { inner: 200 });
        const exactMs = measure(() => getRotationSweptHexes(coord, { q: 0, r: 0 }, steps), { inner: 200 });
        rows.push({
          radius,
          coord: hexKey(coord),
          cwSteps: steps,
          legacyHexes: legacy.length,
          exactHexes: exact.length,
          sameSet: [...legacy].sort().join(' ') === [...exact].sort().join(' '),
          legacyMs,
          exactMs,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// B. Фаза проверки дуги компонента
// ---------------------------------------------------------------------------

type ArcScenario = 'пустая дуга' | 'одно препятствие' | 'несколько препятствий';

interface PhaseFixture {
  world: SimulationWorld;
  component: ConnectedComponent;
  intent: Extract<ComponentIntent, { kind: 'rotate' }>;
  orderedProposed: Array<[string, AxialCoord]>;
}

function buildPhaseFixture(radius: number, length: number, scenario: ArcScenario): PhaseFixture {
  const platformRadius = Math.max(radius + 2, 6);
  const world = createWorldFromLevel(emptyLevel(`perf-rotation-${radius}-${length}`, platformRadius));
  const pivot = { q: 0, r: 0 };
  const coords = polymerCoords(radius, length);
  const tokenIds: string[] = [];
  coords.forEach((coord, index) => {
    const id = `p${String(index).padStart(2, '0')}`;
    addTokenAt(world, id, coord, index + 1);
    tokenIds.push(id);
  });
  tokenIds.sort();

  const farCoord = coords[coords.length - 1];
  const farArc = getRotationSweptHexes(farCoord, pivot, 1);
  const blockedHexes = farArc.filter((hex) => world.platformHexes.has(hexKey(hex)));
  if (scenario !== 'пустая дуга' && blockedHexes.length > 0) {
    addSolidMachine(world, 'pusher', blockedHexes[Math.floor(blockedHexes.length / 2)]);
  }
  if (scenario === 'несколько препятствий') {
    for (const hex of blockedHexes.slice(0, 3)) {
      if (!world.machines.has(hexKey(hex))) addSolidMachine(world, 'pusher', hex);
    }
    for (const hex of blockedHexes.slice(-2)) {
      if (world.machines.has(hexKey(hex))) continue;
      addTokenAt(world, `foreign_${hexKey(hex)}`, hex, 100);
      world.tokens.get(`foreign_${hexKey(hex)}`)!.moveSource = 'conveyor';
    }
  }

  const orderedTokens = [...world.tokens.values()].sort((a, b) => a.spawnOrder - b.spawnOrder);
  const orderedProposed: Array<[string, AxialCoord]> = orderedTokens.map((token) => [
    token.id,
    rotateAroundPivot(token.coord, pivot, 1),
  ]);

  const component: ConnectedComponent = {
    id: tokenIds[0],
    tokenIds,
    bondIndices: [],
  };
  const intent: Extract<ComponentIntent, { kind: 'rotate' }> = {
    kind: 'rotate',
    pivot: { ...pivot },
    cwSteps: 1,
    tier: 2,
    signature: 'rot:0,0:1',
    sourceCoord: { ...pivot },
    sourceMachineType: 'rotator',
  };
  return { world, component, intent, orderedProposed };
}

interface PhaseRow {
  radius: number;
  length: number;
  scenario: ArcScenario;
  found: boolean | null;
  exactMs: number;
}

/**
 * Замер фазы проверки дуги текущей (точной) реализацией.
 *
 * «Старая» фаза здесь не воспроизводится целиком: её стоимость отличается только
 * числом гексов дуги, и это уже измерено в части A. Строка сценария показывает,
 * сколько стоит полная проверка компонента в реальных условиях — с ранним
 * выходом на первом препятствии.
 */
function benchPhase(): PhaseRow[] {
  const rows: PhaseRow[] = [];
  for (const radius of [2, 4, 6, 8, 15]) {
    for (const length of [2, 9]) {
      for (const scenario of ['пустая дуга', 'одно препятствие', 'несколько препятствий'] as ArcScenario[]) {
        const fixture = buildPhaseFixture(radius, length, scenario);
        const result = findRotationArcObstacle(fixture.world, fixture.component, fixture.intent, fixture.orderedProposed);
        const exactMs = measure(
          () => findRotationArcObstacle(fixture.world, fixture.component, fixture.intent, fixture.orderedProposed),
          { inner: 50 },
        );
        rows.push({ radius, length, scenario, found: result ? result.kind === 'housing' : null, exactMs });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Вывод
// ---------------------------------------------------------------------------

function main(): void {
  const json = process.argv.includes('--json');
  const geometry = benchGeometry();
  const phase = benchPhase();

  const rowsByRadius = new Map<number, GeometryRow[]>();
  for (const row of geometry) {
    const list = rowsByRadius.get(row.radius) ?? [];
    list.push(row);
    rowsByRadius.set(row.radius, list);
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          node: process.version,
          platform: `${os.platform()} ${os.arch()}`,
          cpu: os.cpus()[0]?.model ?? 'unknown',
          legacySamples: LEGACY_SAMPLES,
          geometry,
          phase,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log(`\nPR #4D — стоимость точной дуги поворота (${process.version}, ${os.platform()} ${os.arch()})`);
  console.log(`CPU: ${os.cpus()[0]?.model ?? 'unknown'}\n`);

  console.log('A. getRotationSweptHexes: одна сфера, медиана на вызов');
  console.log('   радиус | сфера   | напр. | гексов старый→новый | старый, мс | новый, мс | отношение');
  console.log('   --------+---------+-------+---------------------+------------+-----------+----------');
  for (const [radius, rows] of rowsByRadius) {
    for (const row of rows) {
      console.log(
        `   ${String(radius).padStart(6)} | ${row.coord.padEnd(7)} | ${row.cwSteps === 1 ? 'cw ' : 'ccw'}   | ` +
          `${String(row.legacyHexes).padStart(8)} → ${String(row.exactHexes).padEnd(2)}       | ` +
          `${fmtMs(row.legacyMs).padStart(10)} | ${fmtMs(row.exactMs).padStart(9)} | ` +
          `${fmtRatio(row.exactMs, row.legacyMs).padStart(8)}`,
      );
    }
  }

  const differ = geometry.filter((row) => !row.sameSet);
  console.log(
    `\n   Конфигураций, где наборы гексов различаются: ${differ.length} из ${geometry.length}. ` +
      'Это исправленный дефект #4D (старая выборка неполна на радиусах ≥ 6), а не оценка корректности замера.',
  );
  console.log('   Отношение указано как «новый / старый»: > 1 означает, что точная проверка дороже.\n');

  console.log('B. findRotationArcObstacle: полная проверка дуги компонента, медиана на вызов');
  console.log('   радиус | полимер | сценарий              | препятствие | время, мс');
  console.log('   --------+---------+-----------------------+-------------+----------');
  for (const row of phase) {
    console.log(
      `   ${String(row.radius).padStart(6)} | ${String(row.length).padStart(7)} | ${row.scenario.padEnd(21)} | ` +
        `${(row.found === null ? '—' : 'да').padStart(11)} | ${fmtMs(row.exactMs).padStart(9)}`,
    );
  }
  console.log('\nПорогов времени в CI нет: числа приведены для сравнения реализаций между собой.\n');
}

main();
