/**
 * Геометрия вращения (пункт 3.3, PR #4D).
 *
 * Контракт: `docs/rotation-geometry-contract.md`.
 *
 * Группы проверок:
 *  A — математика поворота: R⁶ = id, R³∘R³ = id, сохранение расстояний;
 *  B — точная дуга: радиусы 1..8, 10, 15, оба направления, независимый численный
 *      оракул, аналитические случаи пересечения и касания границы гекса;
 *  C — столкновения: корпус и сфера на дуге, несколько препятствий, cw/ccw,
 *      одновременное движение (правило C), правила D для jumper/swapper;
 *  D — атомарность: отклонённый такт не оставляет частичного вращения;
 *  E — детерминизм: порядок хранения в Map не влияет на диагностику.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arcPassesThroughHex,
  HEX_INRADIUS,
  hexArcOverlap,
  makeArc,
  PENETRATION_EPS,
} from './arc-geometry';
import { createWorldFromLevel, getRotationSweptHexes, stepSimulation } from './hex-engine';
import { ALL_PUZZLE_LEVELS } from './levels';
import {
  generateHexDisk,
  HEX_SIZE,
  hexDistance,
  hexKey,
  hexToWorld,
  rotateAroundPivot,
  rotateAxialOffset,
  worldToHex,
} from './hex-math';
import {
  addToken,
  assertBondGeometry,
  assertMatchesRule,
  bondTokens,
  documentedViolations,
  formatViolationTable,
  levelWithPresets,
  preset,
  tokensAt,
} from './audit-kit';
import type { AxialCoord, SimulationWorld } from './types';

function coords(world: SimulationWorld): Record<string, AxialCoord> {
  const out: Record<string, AxialCoord> = {};
  for (const tok of world.tokens.values()) out[tok.id] = { ...tok.coord };
  return out;
}

function assertUnmoved(world: SimulationWorld, before: Record<string, AxialCoord>): void {
  for (const [id, coord] of Object.entries(before)) {
    assert.deepEqual(world.tokens.get(id)!.coord, coord, `сфера ${id} частично переместилась`);
  }
}

function keys(hexes: readonly AxialCoord[]): string[] {
  return hexes.map(hexKey);
}

/**
 * Вспомогательная плотная выборка дуги (200 точек по умолчанию).
 *
 * Используется только как **детектор расхождений**, а не как эталон: эталон —
 * независимый численный оракул ниже и зафиксированные аналитические случаи.
 */
function denseSweptHexes(coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1, samples = 200): AxialCoord[] {
  if (hexDistance(coord, pivot) <= 1) return [];
  const dest = rotateAroundPivot(coord, pivot, cwSteps);
  const pivotWorld = hexToWorld(pivot);
  const startWorld = hexToWorld(coord);
  const dx = startWorld.x - pivotWorld.x;
  const dz = startWorld.z - pivotWorld.z;
  const total = cwSteps === 1 ? Math.PI / 3 : -Math.PI / 3;
  const seen = new Set([hexKey(coord), hexKey(dest), hexKey(pivot)]);
  const out: AxialCoord[] = [];
  for (let i = 1; i < samples; i++) {
    const angle = total * (i / samples);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const h = worldToHex(pivotWorld.x + (dx * cos - dz * sin), pivotWorld.z + (dx * sin + dz * cos));
    const key = hexKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Независимый численный оракул
//
// Оракул намеренно не использует интервальную алгебру из `arc-geometry.ts`:
// он минимизирует «зазор» до гекса вдоль дуги (сетка + тернарный поиск).
// Расхождение оракула и точного алгоритма — либо пропуск гекса, либо лишний
// гекс; оба случая ловятся тестами группы B.
// ---------------------------------------------------------------------------

const ORACLE_TOL = 1e-9;

interface Point2D {
  x: number;
  z: number;
}

/** Знаковый зазор точки до замкнутого гекса: > 0 снаружи, < 0 внутри. */
function hexClearance(center: Point2D, point: Point2D): number {
  let worst = Number.NEGATIVE_INFINITY;
  for (let edge = 0; edge < 6; edge++) {
    const phi = (Math.PI / 3) * edge;
    const value = Math.cos(phi) * (point.x - center.x) + Math.sin(phi) * (point.z - center.z) - HEX_INRADIUS;
    if (value > worst) worst = value;
  }
  return worst;
}

function arcPointOf(coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1, t: number): Point2D {
  const pivotWorld = hexToWorld(pivot);
  const startWorld = hexToWorld(coord);
  const dx = startWorld.x - pivotWorld.x;
  const dz = startWorld.z - pivotWorld.z;
  const angle = (cwSteps === 1 ? 1 : -1) * t;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: pivotWorld.x + dx * cos - dz * sin, z: pivotWorld.z + dx * sin + dz * cos };
}

/** Минимальный зазор дуги до гекса: сетка + тернарное уточнение. */
function minArcClearance(coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1, center: Point2D, grid = 400): number {
  const span = Math.PI / 3;
  const clearanceAt = (t: number) => hexClearance(center, arcPointOf(coord, pivot, cwSteps, t));
  let best = Number.POSITIVE_INFINITY;
  let bestT = 0;
  for (let i = 0; i <= grid; i++) {
    const t = (span * i) / grid;
    const value = clearanceAt(t);
    if (value < best) {
      best = value;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - span / grid);
  let hi = Math.min(span, bestT + span / grid);
  for (let iteration = 0; iteration < 200; iteration++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (clearanceAt(m1) < clearanceAt(m2)) hi = m2;
    else lo = m1;
  }
  return Math.min(best, clearanceAt((lo + hi) / 2));
}

/** Момент первого входа дуги в гекс (бисекция по зазору), независимо от модуля. */
function firstEntryByBisection(coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1, center: Point2D, grid = 2000): number {
  const span = Math.PI / 3;
  const clearanceAt = (t: number) => hexClearance(center, arcPointOf(coord, pivot, cwSteps, t));
  for (let i = 1; i <= grid; i++) {
    const t = (span * i) / grid;
    if (clearanceAt(t) <= 0) {
      let lo = (span * (i - 1)) / grid;
      let hi = t;
      for (let iteration = 0; iteration < 60; iteration++) {
        const mid = (lo + hi) / 2;
        if (clearanceAt(mid) <= 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Гексы-кандидаты в полосе `|центр − пивот| ≈ ρ`: щедрый диск вокруг пивота. */
function bandHexes(pivot: AxialCoord, coord: AxialCoord): AxialCoord[] {
  const pivotWorld = hexToWorld(pivot);
  const startWorld = hexToWorld(coord);
  const rho = Math.hypot(startWorld.x - pivotWorld.x, startWorld.z - pivotWorld.z);
  const ring = Math.ceil(rho / (HEX_SIZE * Math.sqrt(3))) + 2;
  const out: AxialCoord[] = [];
  for (const offset of generateHexDisk(ring)) {
    const hex = { q: pivot.q + offset.q, r: pivot.r + offset.r };
    const center = hexToWorld(hex);
    const distance = Math.hypot(center.x - pivotWorld.x, center.z - pivotWorld.z);
    if (Math.abs(distance - rho) > HEX_SIZE) continue;
    out.push(hex);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A. Математика поворота
// ---------------------------------------------------------------------------

test('A: rotation math: six 60° turns are the identity and three + three turns cancel out', () => {
  for (let q = -6; q <= 6; q++) {
    for (let r = -6; r <= 6; r++) {
      const start = { q, r };
      let cw = { ...start };
      for (let i = 0; i < 6; i++) cw = rotateAxialOffset(cw, 1);
      assert.deepEqual(cw, start, `R^6 ≠ id для (${q}, ${r})`);

      let ccw = { ...start };
      for (let i = 0; i < 6; i++) ccw = rotateAxialOffset(ccw, -1);
      assert.deepEqual(ccw, start, `R^-6 ≠ id для (${q}, ${r})`);

      const half = rotateAxialOffset(rotateAxialOffset(start, 3), 3);
      assert.deepEqual(half, start, `180° + 180° ≠ id для (${q}, ${r})`);

      // R ∘ R⁻¹ = id в обе стороны, для любого шага 1 и 3.
      for (const steps of [1, 3] as const) {
        assert.deepEqual(rotateAxialOffset(rotateAxialOffset(start, steps), -steps as 1 | -1 | 3), start);
        assert.deepEqual(rotateAxialOffset(rotateAxialOffset(start, -steps as 1 | -1 | 3), steps), start);
      }
    }
  }
});

test('A: rotation math: hex distances between two spheres are invariant under 60° and 180° rotations', () => {
  const pivots: AxialCoord[] = [{ q: 0, r: 0 }, { q: 2, r: -1 }, { q: -3, r: 2 }];
  for (const pivot of pivots) {
    for (let q1 = -4; q1 <= 4; q1++) {
      for (let r1 = -4; r1 <= 4; r1++) {
        for (let q2 = -4; q2 <= 4; q2++) {
          for (let r2 = -4; r2 <= 4; r2++) {
            const a = { q: q1, r: r1 };
            const b = { q: q2, r: r2 };
            const before = hexDistance(a, b);
            for (const steps of [1, -1, 3]) {
              const ra = rotateAroundPivot(a, pivot, steps);
              const rb = rotateAroundPivot(b, pivot, steps);
              assert.equal(hexDistance(ra, rb), before, `d не сохранился: pivot ${hexKey(pivot)}, ${hexKey(a)}/${hexKey(b)}, steps ${steps}`);
            }
          }
        }
      }
    }
  }
});

test('A: rotation math: the rotation is rigid in world coordinates (euclidean distances and angles)', () => {
  const pivot = { q: 1, r: -2 };
  const pivotWorld = hexToWorld(pivot);
  const pairs: Array<[AxialCoord, AxialCoord]> = [
    [{ q: 3, r: 0 }, { q: 4, r: 1 }],
    [{ q: -2, r: 3 }, { q: 0, r: 0 }],
    [{ q: 5, r: -4 }, { q: 2, r: 2 }],
  ];
  for (const [a, b] of pairs) {
    const aWorld = hexToWorld(a);
    const bWorld = hexToWorld(b);
    const beforeDistance = Math.hypot(aWorld.x - bWorld.x, aWorld.z - bWorld.z);
    for (const steps of [1, -1, 2, 3, 4, 5]) {
      const ra = hexToWorld(rotateAroundPivot(a, pivot, steps));
      const rb = hexToWorld(rotateAroundPivot(b, pivot, steps));
      assert.ok(Math.abs(Math.hypot(ra.x - rb.x, ra.z - rb.z) - beforeDistance) < 1e-9, 'евклидово расстояние изменилось');
      // Расстояние до пивота тоже сохраняется — иначе это не поворот.
      const radiusBefore = Math.hypot(aWorld.x - pivotWorld.x, aWorld.z - pivotWorld.z);
      const radiusAfter = Math.hypot(ra.x - pivotWorld.x, ra.z - pivotWorld.z);
      assert.ok(Math.abs(radiusAfter - radiusBefore) < 1e-9, 'радиус вращения изменился');
    }
  }
});

// ---------------------------------------------------------------------------
// B. Точная дуга
// ---------------------------------------------------------------------------

test('B: radius 1 has no intermediate hexes, and start/dest/pivot are never on the arc', () => {
  const pivots: AxialCoord[] = [{ q: 0, r: 0 }, { q: 2, r: -1 }, { q: -3, r: 2 }];
  for (const pivot of pivots) {
    // Радиус 0 и 1: дуга пуста при любом направлении.
    assert.deepEqual(getRotationSweptHexes(pivot, pivot, 1), []);
    for (const neighbor of generateHexDisk(1)) {
      if (neighbor.q === 0 && neighbor.r === 0) continue;
      const start = { q: pivot.q + neighbor.q, r: pivot.r + neighbor.r };
      assert.deepEqual(getRotationSweptHexes(start, pivot, 1), [], 'радиус 1: промежуточных гексов нет');
      assert.deepEqual(getRotationSweptHexes(start, pivot, -1), [], 'радиус 1: промежуточных гексов нет');
    }

    for (let dq = -7; dq <= 7; dq++) {
      for (let dr = -7; dr <= 7; dr++) {
        const coord = { q: pivot.q + dq, r: pivot.r + dr };
        for (const steps of [1, -1] as const) {
          const swept = keys(getRotationSweptHexes(coord, pivot, steps));
          const dest = rotateAroundPivot(coord, pivot, steps);
          assert.ok(!swept.includes(hexKey(coord)), `стартовый гекс ${hexKey(coord)} попал в дугу`);
          assert.ok(!swept.includes(hexKey(dest)), `гекс назначения ${hexKey(dest)} попал в дугу`);
          assert.ok(!swept.includes(hexKey(pivot)), 'гекс пивота попал в дугу');
          // Дублей быть не может.
          assert.equal(new Set(swept).size, swept.length, 'в дуге есть повторяющиеся гексы');
        }
      }
    }
  }
});

test('B: canonical arcs (radius 2..6, both directions) match the geometric sector', () => {
  const pivot = { q: 0, r: 0 };
  const cases: Array<[AxialCoord, 1 | -1, string[]]> = [
    [{ q: 2, r: 0 }, 1, ['1,1']],
    [{ q: 2, r: 0 }, -1, ['2,-1']],
    [{ q: 1, r: 1 }, 1, ['0,2']],
    [{ q: 1, r: 1 }, -1, ['2,0']],
    [{ q: 3, r: 0 }, 1, ['2,1', '2,2', '1,2']],
    [{ q: 3, r: 0 }, -1, ['3,-1', '4,-2', '3,-2']],
    [{ q: 4, r: 0 }, 1, ['3,1', '3,2', '2,2', '2,3', '1,3']],
    [{ q: 4, r: 0 }, -1, ['4,-1', '5,-2', '4,-2', '5,-3', '4,-3']],
    [{ q: 4, r: 1 }, 1, ['3,2', '2,3', '1,4', '0,5']],
    [{ q: -6, r: 1 }, 1, ['-6,0', '-5,-1', '-4,-2', '-4,-3', '-3,-3', '-3,-4', '-2,-4']],
    [{ q: -6, r: 1 }, -1, ['-6,2', '-7,3', '-6,3', '-7,4', '-6,4', '-6,5', '-6,6']],
  ];
  for (const [coord, steps, expected] of cases) {
    assert.deepEqual(keys(getRotationSweptHexes(coord, pivot, steps)), expected, `дуга ${hexKey(coord)} steps=${steps}`);
  }
});

test('B: the exact arc matches an independent numeric oracle for radii 1..8, 10, 15 in both directions', () => {
  const pivot = { q: 0, r: 0 };
  const radii = [1, 2, 3, 4, 5, 6, 7, 8, 10, 15];
  let checkedArcs = 0;
  let checkedHexes = 0;

  for (const radius of radii) {
    const ring = generateHexDisk(radius)
      .map((offset) => ({ q: pivot.q + offset.q, r: pivot.r + offset.r }))
      .filter((h) => hexDistance(h, pivot) === radius);
    // Для больших радиусов берём разреженную выборку направлений, чтобы тест
    // оставался быстрым; малые радиусы проверяются полностью.
    const stride = radius <= 5 ? 1 : radius <= 8 ? 3 : Math.ceil(ring.length / 8);
    for (let i = 0; i < ring.length; i += stride) {
      const coord = ring[i];
      for (const steps of [1, -1] as const) {
        const exact = new Set(keys(getRotationSweptHexes(coord, pivot, steps)));
        const excluded = new Set([hexKey(coord), hexKey(rotateAroundPivot(coord, pivot, steps)), hexKey(pivot)]);
        for (const hex of bandHexes(pivot, coord)) {
          if (excluded.has(hexKey(hex))) continue;
          checkedHexes += 1;
          const clearance = minArcClearance(coord, pivot, steps, hexToWorld(hex));
          const reason = `radius ${radius}, coord ${hexKey(coord)}, steps ${steps}, hex ${hexKey(hex)}, clearance ${clearance.toExponential(3)}`;
          if (clearance < -ORACLE_TOL) {
            assert.ok(exact.has(hexKey(hex)), `дуга пропустила гекс: ${reason}`);
          } else if (clearance > ORACLE_TOL) {
            assert.ok(!exact.has(hexKey(hex)), `дуга содержит лишний гекс без пересечения: ${reason}`);
          }
        }
        // Плотная выборка — только детектор расхождений: каждый её гекс обязан
        // быть в точной дуге (обратное неверно: выборка может пропустить гекс).
        for (const hex of denseSweptHexes(coord, pivot, steps, 2000)) {
          assert.ok(exact.has(hexKey(hex)), `точная дуга не содержит гекс плотной выборки: ${hexKey(hex)}`);
        }
        checkedArcs += 1;
      }
    }
  }

  assert.ok(checkedArcs > 100, `проверено дуг: ${checkedArcs}`);
  assert.ok(checkedHexes > 2000, `проверено гексов: ${checkedHexes}`);
});

test('B: the swept list is ordered by first entry into the hex, ties by coordinate', () => {
  const pivot = { q: 0, r: 0 };
  const cases: AxialCoord[] = [
    { q: -6, r: 1 },
    { q: 4, r: 0 },
    { q: 3, r: 0 },
    { q: 7, r: -3 },
    { q: -5, r: 2 },
    { q: 0, r: 8 },
  ];
  for (const coord of cases) {
    for (const steps of [1, -1] as const) {
      const swept = getRotationSweptHexes(coord, pivot, steps);
      assert.ok(swept.length >= 2, `подготовка теста: дуга ${hexKey(coord)} должна содержать несколько гексов`);
      const entries = swept.map((hex) => firstEntryByBisection(coord, pivot, steps, hexToWorld(hex)));
      for (let i = 0; i + 1 < swept.length; i++) {
        const delta = entries[i + 1] - entries[i];
        assert.ok(
          delta >= -1e-6,
          `порядок нарушен: ${hexKey(swept[i])} входит позже ${hexKey(swept[i + 1])} (${delta.toExponential(3)})`,
        );
        if (Math.abs(delta) <= 1e-6) {
          const sameQ = swept[i].q === swept[i + 1].q;
          assert.ok(swept[i].q < swept[i + 1].q || (sameQ && swept[i].r < swept[i + 1].r), 'при равном входе порядок по координате нарушен');
        }
      }
      // Порядок повторяем: вызов не зависит от предыдущих вызовов.
      assert.deepEqual(keys(getRotationSweptHexes(coord, pivot, steps)), keys(swept));
    }
  }
});

test('B: the arc does not depend on a sample count — dense sampling never finds a hex the exact arc misses', () => {
  const pivot = { q: 0, r: 0 };
  let checked = 0;
  for (const pivotShift of [{ q: 0, r: 0 }, { q: 1, r: -2 }, { q: -2, r: 1 }]) {
    for (let q = -7; q <= 7; q++) {
      for (let r = -7; r <= 7; r++) {
        const coord = { q, r };
        const distance = hexDistance(coord, pivotShift);
        if (distance < 2 || distance > 8) continue;
        for (const steps of [1, -1] as const) {
          const exact = new Set(keys(getRotationSweptHexes(coord, pivotShift, steps)));
          for (const hex of denseSweptHexes(coord, pivotShift, steps, 2000)) {
            assert.ok(exact.has(hexKey(hex)), `дуга не содержит ${hexKey(hex)}: pivot ${hexKey(pivotShift)}, coord ${hexKey(coord)}, steps ${steps}`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 200, `проверено дуг: ${checked}`);
});

test('B: radius 6 regression — the exact sector of (-6,1) contains every hex of the dense arc', () => {
  const pivot = { q: 0, r: 0 };
  const far = { q: -6, r: 1 };
  const exact = keys(getRotationSweptHexes(far, pivot, 1));
  const dense = keys(denseSweptHexes(far, pivot, 1, 2000));
  const missed = dense.filter((hex) => !exact.includes(hex));
  assert.deepEqual(missed, [], 'плотная дуга содержит гексы, которых нет в точной');
  assert.ok(exact.includes('-4,-3'), `гекс -4,-3 обязан быть в секторе: ${exact.join(' ')}`);
  assert.deepEqual(exact, ['-6,0', '-5,-1', '-4,-2', '-4,-3', '-3,-3', '-3,-4', '-2,-4']);
});

test('B: analytic tangency — an arc that only touches a hex border does not penetrate it', () => {
  const rho = 5;
  const pivot = { x: 0, z: 0 };
  // Дуга от −30° до +30°: середина дуги приходится на угол 0°.
  const arcAcross = makeArc(pivot, { x: rho * Math.cos(-Math.PI / 6), z: rho * Math.sin(-Math.PI / 6) }, 1);
  // Гекс снаружи круга: его ближнее ребро (нормаль 0°) ровно на расстоянии ρ.
  const edgeTangent = { x: rho + HEX_INRADIUS, z: 0 };
  assert.ok(Math.abs(hexClearance(edgeTangent, { x: rho, z: 0 })) < 1e-12, 'подготовка теста: касание должно быть точным');
  assert.equal(arcPassesThroughHex(arcAcross, edgeTangent), false, 'касание ребра не должно считаться столкновением');
  assert.equal(hexArcOverlap(arcAcross, edgeTangent).penetration, 0);
  assert.equal(arcPassesThroughHex(arcAcross, { x: rho + HEX_INRADIUS + 1e-3, z: 0 }), false, 'зазор не должен считаться столкновением');
  assert.equal(arcPassesThroughHex(arcAcross, { x: rho + HEX_INRADIUS - 1e-3, z: 0 }), true, 'проникновение на 1e-3 обязано считаться');
  assert.ok(PENETRATION_EPS <= 1e-6, 'порог проникновения должен быть на уровне численного шума');

  // Касание вершиной: дуга 60°..120°, вершина гекса ровно на окружности.
  const arcTop = makeArc(pivot, { x: rho * Math.cos(Math.PI / 3), z: rho * Math.sin(Math.PI / 3) }, 1);
  const vertexTangent = { x: 0, z: rho + HEX_SIZE };
  assert.equal(arcPassesThroughHex(arcTop, vertexTangent), false, 'касание вершины не должно считаться столкновением');
  assert.equal(hexArcOverlap(arcTop, vertexTangent).penetration, 0);
  assert.equal(arcPassesThroughHex(arcTop, { x: 0, z: rho + HEX_SIZE + 1e-3 }), false);
  assert.equal(arcPassesThroughHex(arcTop, { x: 0, z: rho + HEX_SIZE - 1e-3 }), true, 'вершина внутри круга на 1e-3 обязана считаться');
});

test('B: level data already exposes rotation sectors of radius 7', () => {
  let maxDistance = 0;
  let where = '';
  for (const level of ALL_PUZZLE_LEVELS) {
    const world = createWorldFromLevel(level, level.demoSolution ?? []);
    const rotators = [...world.machines.values()].filter((m) => m.type === 'rotator');
    for (const rotator of rotators) {
      for (const key of world.platformHexes) {
        const [q, r] = key.split(',').map(Number);
        const distance = hexDistance(rotator.coord, { q, r });
        if (distance > maxDistance) {
          maxDistance = distance;
          where = `${level.id}: ротатор ${hexKey(rotator.coord)} → гекс ${key}`;
        }
      }
    }
  }
  assert.ok(maxDistance >= 6, `максимальное расстояние от ротатора до гекса платформы: ${maxDistance} (${where})`);
  console.log(`\nАудит вращения: максимум ${maxDistance} гексов от ротатора до платформы (${where}); точная дуга проверяет сектор при любом радиусе.\n`);
});

// ---------------------------------------------------------------------------
// C. Столкновения на дуге
// ---------------------------------------------------------------------------

const RADIUS6_PATH: AxialCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: -1 }, { q: -2, r: -1 },
  { q: -3, r: -1 }, { q: -4, r: -1 }, { q: -5, r: 0 }, { q: -6, r: 1 },
];

/** Уровень с ротатором в пивоте (0,0) и 9-звенным полимером на радиусе 6. */
function radius6World(pushers: AxialCoord[], rotMode: 'cw' | 'ccw' = 'cw', reverseInsertion = false): SimulationWorld {
  const world = createWorldFromLevel(levelWithPresets('R60-radius6', [
    preset('rotator', 0, 0, { dir: 0, rotMode }),
    ...pushers.map((p) => preset('pusher', p.q, p.r, { dir: 3 })),
  ], { radius: 7 }));
  const order = RADIUS6_PATH.map((coord, index) => ({ coord, index }));
  if (reverseInsertion) order.reverse();
  for (const { coord, index } of order) addToken(world, `p${index}`, index + 1, coord.q, coord.r, index + 1);
  for (let i = 0; i < RADIUS6_PATH.length - 1; i++) bondTokens(world, `p${i}`, `p${i + 1}`);
  return world;
}

test('C: a polymer rotates freely in empty space and keeps its bonds', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-free', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
  ], { radius: 5 }));
  addToken(world, 's1', 1, 1, 0, 1);
  addToken(world, 's2', 2, 2, 0, 2);
  addToken(world, 's3', 3, 3, 0, 3);
  bondTokens(world, 's1', 's2');
  bondTokens(world, 's2', 's3');
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  for (const [id, coord] of Object.entries(before)) {
    assert.deepEqual(world.tokens.get(id)!.coord, rotateAroundPivot(coord, { q: 0, r: 0 }, 1), `сфера ${id} должна повернуться на 60°`);
  }
  assertBondGeometry(world, 'free rotation');
});

test('C: a solid housing on the swept arc blocks the rotation and is reported in the highlight', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-solid', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', 1, 1, { dir: 3 }),
  ], { radius: 5 }));
  addToken(world, 'near', 1, 1, 0, 1);
  addToken(world, 'far', 2, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  const before = coords(world);

  assert.deepEqual(keys(getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1)), ['1,1']);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /дуге поворота/);
  assert.match(world.errorReason ?? '', /корпус механизма \(pusher\)/);
  assert.ok(keys(world.errorHighlightHexes).includes('1,1'), `подсветка должна содержать гекс корпуса: ${keys(world.errorHighlightHexes).join(' ')}`);
  assertUnmoved(world, before);
  assertBondGeometry(world, 'solid arc');
});

test('C: a solid housing outside the swept arc does not block the rotation', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-outside', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', 2, 1, { dir: 1 }),
  ], { radius: 5 }));
  addToken(world, 'near', 1, 1, 0, 1);
  addToken(world, 'far', 2, 2, 0, 2);
  bondTokens(world, 'near', 'far');

  assert.ok(!keys(getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1)).includes('2,1'));

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('near')!.coord, { q: 0, r: 1 });
  assert.deepEqual(world.tokens.get('far')!.coord, { q: 0, r: 2 });
});

test('C: a rotator may not rotate a polymer onto a solid machine body', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-destination', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', 0, 2, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'near', 1, 1, 0, 1);
  addToken(world, 'far', 2, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /корпусом механизма/);
  assertUnmoved(world, before);
});

test('C: with several obstacles the first one along the arc is reported', () => {
  const firstObstacle = { q: -6, r: 0 };
  const laterObstacle = { q: -4, r: -3 };
  const arc = keys(getRotationSweptHexes({ q: -6, r: 1 }, { q: 0, r: 0 }, 1));
  assert.ok(arc.indexOf(hexKey(firstObstacle)) < arc.indexOf(hexKey(laterObstacle)), 'подготовка теста: порядок препятствий в дуге');

  const world = radius6World([laterObstacle, firstObstacle]);
  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /корпус механизма \(pusher\)/);
  assert.deepEqual(keys(world.errorHighlightHexes), ['0,0', '-6,1', '-6,0'], 'первое препятствие по ходу дуги');
  assertUnmoved(world, coords(world));
  assertBondGeometry(world, 'several obstacles');
});

test('C: a 9-link polymer at radius 6 is stopped by a pusher body inside its sector', () => {
  // Минимальное воспроизведение дефекта `rotation-sweep-housing-slip`:
  // пивот (0,0), дальняя сфера (-6,1), корпус (-4,-3), поворот cw на 60°.
  const world = radius6World([{ q: -4, r: -3 }]);
  stepSimulation(world);

  assert.equal(world.status, 'error', 'поворот сквозь корпус должен быть отклонён');
  assert.match(world.errorReason ?? '', /дуге поворота/);
  assert.match(world.errorReason ?? '', /корпус механизма \(pusher\)/);
  assert.ok(keys(world.errorHighlightHexes).includes('-4,-3'), 'гекс корпуса обязан быть в подсветке');
  for (const token of world.tokens.values()) {
    assert.deepEqual(token.coord, RADIUS6_PATH[Number(token.id.slice(1))], `сфера ${token.id} осталась на месте`);
  }
  assertBondGeometry(world, 'radius 6 housing');
});

test('C: the same 9-link polymer is stopped on a counter-clockwise rotation too', () => {
  // Для ccw сектор дальней сферы идёт в другую сторону: (-6,2) лежит на дуге.
  const world = radius6World([{ q: -6, r: 2 }], 'ccw');
  assert.ok(keys(getRotationSweptHexes({ q: -5, r: 0 }, { q: 0, r: 0 }, -1)).includes('-6,2'));

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /корпус механизма \(pusher\)/);
  assert.ok(keys(world.errorHighlightHexes).includes('-6,2'));
  assertBondGeometry(world, 'ccw housing');
});

test('C: a sphere parked on the swept arc blocks the rotation', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-external', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
  ], { radius: 6 }));
  addToken(world, 'near', 1, 1, 0, 1);
  addToken(world, 'far', 2, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'parked', 9, 1, 1, 3);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /сектор поворота занят другой сферой/);
  assertUnmoved(world, before);
});

test('C: rule C — a sphere that vacates a swept hex in the same tick does not block the rotation', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-vacating', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('conveyor', 1, 1, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'leaver', 9, 1, 1, 3);

  assert.ok(keys(getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1)).includes('1,1'), 'гекс 1,1 лежит на дуге');

  stepSimulation(world);

  // Правило C: сравниваются только конечные позиции, поэтому уход с гекса
  // сектора в этом же такте разрешает поворот.
  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('near')!.coord, { q: 0, r: 1 });
  assert.deepEqual(world.tokens.get('far')!.coord, { q: 0, r: 2 });
  assert.deepEqual(world.tokens.get('leaver')!.coord, { q: 2, r: 1 }, 'сфера уезжает по конвейеру');
  assertBondGeometry(world, 'vacating sphere');
});

test('C: rule C — a sphere that ends the tick on a swept hex blocks the rotation', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-onto', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('conveyor', 1, 2, { dir: 4 }),
  ], { radius: 5 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'intruder', 9, 1, 2, 3);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /сектор поворота занят другой сферой/);
  assert.deepEqual(keys(world.errorHighlightHexes), ['0,0', '1,1'], 'подсветка — пивот и гекс сектора');
  assertUnmoved(world, before);
});

test('C: rule C — two spheres ending on the same hex are caught by the overlap check', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-overlap', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('conveyor', 0, 3, { dir: 4 }),
  ], { radius: 5 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'intruder', 9, 0, 3, 3);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Столкновение 2 числовых сфер на гексе \(0, 2\)/, world.errorReason ?? '');
  assertUnmoved(world, before);
});

test('C: rule D — jumper keeps skipping the intermediate hex, even a solid housing', () => {
  const world = createWorldFromLevel(levelWithPresets('J-solid', [
    preset('jumper', 0, 0, { dir: 0 }),
    preset('pusher', 1, 0, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'j', 1, 0, 0, 1);

  stepSimulation(world);

  // Промежуточный гекс (1,0) занят корпусом, но трамплин его перепрыгивает.
  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('j')!.coord, { q: 2, r: 0 });
});

// ---------------------------------------------------------------------------
// C. 180°: сваппер (правило D — поведение не меняется)
// ---------------------------------------------------------------------------

test('C: 180°: the swapper rotates a bonded polymer as a rigid body and keeps the bond', () => {
  const world = createWorldFromLevel(levelWithPresets('R180-polymer', [
    preset('swapper', 0, 0, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'a', 4, 1, 0, 1);
  addToken(world, 'b', 5, 2, 0, 2);
  addToken(world, 'c', 6, -1, 0, 3);
  bondTokens(world, 'a', 'b');

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('a')!.coord, { q: -1, r: 0 });
  assert.deepEqual(world.tokens.get('b')!.coord, { q: -2, r: 0 });
  assert.deepEqual(world.tokens.get('c')!.coord, { q: 1, r: 0 });
  assertBondGeometry(world, 'swapper polymer');
});

test('C: 180°: a swapper cannot rotate a polymer onto a solid body, and the tick stays atomic', () => {
  const world = createWorldFromLevel(levelWithPresets('R180-solid', [
    preset('swapper', 0, 0, { dir: 0 }),
    preset('pusher', -2, 0, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'a', 4, 1, 0, 1);
  addToken(world, 'b', 5, 2, 0, 2);
  bondTokens(world, 'a', 'b');
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /корпусом механизма/);
  assertUnmoved(world, before);
  assertBondGeometry(world, 'swapper solid');
});

test('C: 180°: two swapper exchanges in a row return the pair to the starting hexes', () => {
  const world = createWorldFromLevel(levelWithPresets('R180-back', [
    preset('swapper', 0, 0, { dir: 0 }),
  ], { radius: 4 }));
  addToken(world, 'left', 1, -1, 0, 1);
  addToken(world, 'right', 2, 1, 0, 2);
  const start = tokensAt(world);

  stepSimulation(world);
  const swapped = tokensAt(world);
  stepSimulation(world);
  const restored = tokensAt(world);

  assert.notEqual(swapped, start);
  assert.equal(restored, start);
  assertMatchesRule(start, restored);
});

// ---------------------------------------------------------------------------
// D. Атомарность
// ---------------------------------------------------------------------------

test('D: a rejected rotation leaves no partial turn — positions, prevCoords and bonds are intact', () => {
  const world = radius6World([{ q: -4, r: -3 }]);
  const before = coords(world);
  const bondsBefore = world.bonds.map((b) => `${b.a}-${b.b}`).sort();

  stepSimulation(world);

  assert.equal(world.status, 'error');
  for (const [id, coord] of Object.entries(before)) {
    const token = world.tokens.get(id)!;
    assert.deepEqual(token.coord, coord, `сфера ${id} повернулась частично`);
    assert.deepEqual(token.prevCoord, coord, `prevCoord сферы ${id} изменился при отказе`);
  }
  assert.deepEqual(world.bonds.map((b) => `${b.a}-${b.b}`).sort(), bondsBefore, 'связи изменились при отказе');
  assert.ok(world.events.filter((e) => e.severity === 'error').length >= 1);
  assertBondGeometry(world, 'atomic rejection');
});

test('D: an allowed rotation moves every sphere of the polymer and keeps prevCoord', () => {
  const world = radius6World([]);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  for (const [id, coord] of Object.entries(before)) {
    const token = world.tokens.get(id)!;
    assert.deepEqual(token.coord, rotateAroundPivot(coord, { q: 0, r: 0 }, 1), `сфера ${id} не повернулась`);
    assert.deepEqual(token.prevCoord, coord, `prevCoord сферы ${id}`);
  }
  assertBondGeometry(world, 'full rotation');
});

// ---------------------------------------------------------------------------
// E. Детерминизм
// ---------------------------------------------------------------------------

test('E: diagnostics do not depend on the insertion order of world.tokens and world.machines', () => {
  const forward = radius6World([{ q: -6, r: 0 }, { q: -4, r: -3 }]);
  const reversed = radius6World([{ q: -6, r: 0 }, { q: -4, r: -3 }], 'cw', true);

  // Обратный порядок вставки в Map на уровне самих хранилищ.
  const machineEntries = [...reversed.machines.entries()].reverse();
  reversed.machines.clear();
  for (const [key, machine] of machineEntries) reversed.machines.set(key, machine);
  const tokenEntries = [...reversed.tokens.entries()].reverse();
  reversed.tokens.clear();
  for (const [key, token] of tokenEntries) reversed.tokens.set(key, token);

  stepSimulation(forward);
  stepSimulation(reversed);

  assert.equal(reversed.status, forward.status);
  assert.equal(reversed.errorReason, forward.errorReason);
  assert.deepEqual(reversed.errorHighlightHexes, forward.errorHighlightHexes);
  assert.deepEqual(reversed.events, forward.events);

  // Порядок обхода дуги — свойство геометрии, а не хранилища: у обеих сфер
  // компонента он совпадает и начинается с ближайшего по ходу поворота гекса.
  assert.deepEqual(keys(getRotationSweptHexes({ q: -6, r: 1 }, { q: 0, r: 0 }, 1))[0], '-6,0');
});

// ---------------------------------------------------------------------------
// Сводка аудита вращения
// ---------------------------------------------------------------------------

test('rotation audit summary: this suite documents no divergences any more (PR #4D)', () => {
  const ids = documentedViolations().map((v) => v.id).sort();
  assert.deepEqual(ids, [], 'все дефекты вращения исправлены: расхождений быть не должно');
  console.log(`\n=== Аудит вращения: расхождения (${ids.length}) ===\n${formatViolationTable()}\n`);
});
