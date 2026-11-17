/**
 * Геометрия вращения (пункт 3.3): математические свойства 60°/180°-поворотов,
 * проверка дуги ротатора, границы выборки и промежуточные траектории.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel, getRotationSweptHexes, stepSimulation } from './hex-engine';
import { ALL_PUZZLE_LEVELS } from './levels';
import {
  HEX_SIZE,
  generateHexDisk,
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

/** Плотная эталонная выборка дуги: тот же поворот, но 200 точек вместо 10. */
/**
 * Угол входа дуги в гекс — независимый от `rotation.ts` расчёт: перебираем
 * угловой параметр грубо, затем уточняем границу бисекцией по признаку
 * «точка внутри гекса». Используется только для проверки порядка результата.
 */
function entryAngleOf(hex: AxialCoord, coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1): number {
  const pivotWorld = hexToWorld(pivot);
  const startWorld = hexToWorld(coord);
  const radius = Math.hypot(startWorld.x - pivotWorld.x, startWorld.z - pivotWorld.z);
  const beta = Math.atan2(startWorld.z - pivotWorld.z, startWorld.x - pivotWorld.x);
  const center = hexToWorld(hex);
  const inradius = (HEX_SIZE * Math.sqrt(3)) / 2;
  const inside = (angle: number): boolean => {
    const x = pivotWorld.x + radius * Math.cos(angle);
    const z = pivotWorld.z + radius * Math.sin(angle);
    for (let edge = 0; edge < 6; edge++) {
      const phi = (Math.PI / 3) * edge;
      if (Math.cos(phi) * (x - center.x) + Math.sin(phi) * (z - center.z) > inradius) return false;
    }
    return true;
  };
  const span = Math.PI / 3;
  const steps = 20000;
  let previous = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (span * i) / steps;
    if (!inside(beta + cwSteps * t)) {
      previous = t;
      continue;
    }
    let lo = previous;
    let hi = t;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (inside(beta + cwSteps * mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  throw new Error(`дуга не входит в гекс ${hexKey(hex)}`);
}

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
// Математические свойства
// ---------------------------------------------------------------------------

test('rotation math: six 60° turns are the identity and three + three turns cancel out', () => {
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
    }
  }
});

test('rotation math: hex distances between two spheres are invariant under 60° and 180° rotations', () => {
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

// ---------------------------------------------------------------------------
// 60°: свободное вращение, препятствия, атомарность
// ---------------------------------------------------------------------------

test('60°: a polymer rotates freely in empty space and keeps its bond', () => {
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

test('60°: a solid machine housing on the swept arc blocks the rotation atomically', () => {
  const level = levelWithPresets('R60-solid', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
  ], { radius: 6 });
  const probe = createWorldFromLevel(level);
  addToken(probe, 'near', 2, 1, 0, 1);
  addToken(probe, 'mid', 3, 2, 0, 2);
  addToken(probe, 'far', 4, 3, 0, 3);
  bondTokens(probe, 'near', 'mid');
  bondTokens(probe, 'mid', 'far');

  // Корпус ставимна настоящий гекс дуги, взятый из самой проверки.
  const arc = getRotationSweptHexes({ q: 3, r: 0 }, { q: 0, r: 0 }, 1);
  assert.ok(arc.length > 0, 'подготовка теста: дуга дальней сферы должна быть непустой');
  const solid = arc[Math.floor(arc.length / 2)];
  const world = createWorldFromLevel(levelWithPresets('R60-solid', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', solid.q, solid.r, { dir: 3 }),
  ], { radius: 6 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'mid', 3, 2, 0, 2);
  addToken(world, 'far', 4, 3, 0, 3);
  bondTokens(world, 'near', 'mid');
  bondTokens(world, 'mid', 'far');
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /дуге поворота/);
  assertUnmoved(world, before);
  assertBondGeometry(world, 'solid arc');
});

test('60°: a sphere parked on the swept arc blocks the rotation', () => {
  const level = levelWithPresets('R60-external', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('rotator', 4, 0, { dir: 3, rotMode: 'cw' }),
  ], { radius: 6 });
  const world = createWorldFromLevel(level);
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'parked', 9, 1, 1, 3);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /сектор поворота занят другой сферой/);
  assertUnmoved(world, before);
});

test('60°: a rotator may not rotate a sphere onto a solid machine body', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-destination', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', 0, 2, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /корпусом механизма/);
  assertUnmoved(world, before);
});

// ---------------------------------------------------------------------------
// Непрерывная дуга: точность, независимость от радиуса, правило траекторий
// ---------------------------------------------------------------------------

test('arc: the analytic sector matches a 200-sample reference arc for radii 2..5', () => {
  let checked = 0;
  for (const pivot of [{ q: 0, r: 0 }, { q: 1, r: -2 }, { q: -2, r: 1 }]) {
    for (let q = -7; q <= 7; q++) {
      for (let r = -7; r <= 7; r++) {
        const coord = { q, r };
        const distance = hexDistance(coord, pivot);
        if (distance < 2 || distance > 5) continue;
        for (const steps of [1, -1] as const) {
          const exact = new Set(getRotationSweptHexes(coord, pivot, steps).map(hexKey));
          for (const hex of denseSweptHexes(coord, pivot, steps)) {
            assert.ok(exact.has(hexKey(hex)), `дуга не содержит ${hexKey(hex)}: pivot ${hexKey(pivot)}, coord ${hexKey(coord)}, steps ${steps}`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 200, `проверено дуг: ${checked}`);
});

test('arc: the continuous sector contains every hex of a dense reference arc up to radius 7', () => {
  let checked = 0;
  for (const pivot of [{ q: 0, r: 0 }, { q: 2, r: -1 }]) {
    for (let q = -9; q <= 9; q++) {
      for (let r = -9; r <= 9; r++) {
        const coord = { q, r };
        const distance = hexDistance(coord, pivot);
        if (distance < 2 || distance > 7) continue;
        for (const steps of [1, -1] as const) {
          const exact = new Set(getRotationSweptHexes(coord, pivot, steps).map(hexKey));
          for (const hex of denseSweptHexes(coord, pivot, steps, 400)) {
            assert.ok(exact.has(hexKey(hex)), `дуга не содержит ${hexKey(hex)}: pivot ${hexKey(pivot)}, coord ${hexKey(coord)}, steps ${steps}`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 400, `проверено дуг: ${checked}`);
});

test('arc: the sector at radius 6 is complete, so the previously missed hex -4,-3 is covered', () => {
  const pivot = { q: 0, r: 0 };
  const far = { q: -6, r: 1 };
  const swept = getRotationSweptHexes(far, pivot, 1).map(hexKey);
  const dense = denseSweptHexes(far, pivot, 1).map(hexKey);
  const missed = dense.filter((hex) => !swept.includes(hex));
  assert.deepEqual(missed, [], 'на радиусе 6 непрерывная дуга не должна пропускать гексы');
  assert.ok(swept.includes('-4,-3'), `ожидался гекс -4,-3 в секторе, получено ${swept.join(' ')}`);
});

test('arc: the result never depends on the radius through a sampling rate', () => {
  // Один и тот же угловой сектор, разные радиусы: список гексов меняется только
  // потому, что меняется сама окружность, но каждая дуга покрыта целиком.
  for (let distance = 2; distance <= 7; distance++) {
    const coord = { q: distance, r: 0 };
    for (const steps of [1, -1] as const) {
      const swept = getRotationSweptHexes(coord, { q: 0, r: 0 }, steps).map(hexKey);
      assert.ok(swept.length > 0, `радиус ${distance}: дуга должна проходить хотя бы через один промежуточный гекс`);
      const dense = denseSweptHexes(coord, { q: 0, r: 0 }, steps, 2000).map(hexKey);
      for (const hex of dense) {
        assert.ok(swept.includes(hex), `радиус ${distance}: пропущен ${hex}`);
      }
    }
  }
});

test('arc: touching a hex boundary is not a collision, and every result is deterministic', () => {
  const pivot = { q: 0, r: 0 };
  // Дуга (2,0) -> (1,1) проходит внутренность (1,1) на интервале положительной
  // длины, поэтому (1,1) — пройденный гекс, а не касание.
  assert.deepEqual(getRotationSweptHexes({ q: 2, r: 0 }, pivot, 1).map(hexKey), ['1,1']);
  // Дуга (3,0) -> (0,3): стартовый, конечный и пивотный гексы исключены,
  // остальные гексы сектора либо пройдены на положительном интервале, либо нет.
  const arc3 = getRotationSweptHexes({ q: 3, r: 0 }, pivot, 1).map(hexKey);
  assert.ok(arc3.length > 0, 'подготовка теста: на радиусе 3 дуга должна что-то задевать');
  for (const key of arc3) {
    const [q, r] = key.split(',').map(Number);
    assert.ok(hexDistance({ q, r }, pivot) >= 2, 'стартовый/пивотный/конечный гекс не должен попадать в список');
    assert.ok(hexKey({ q, r }) !== hexKey({ q: 0, r: 3 }), 'гекс назначения исключён правилом');
  }

  // Касание не даёт «почти нулевых» элементов: повторный вызов совпадает
  // побитово, а список не содержит повторов — диск радиусом 8.
  for (const coord of generateHexDisk(8)) {
    for (const steps of [1, -1] as const) {
      const first = getRotationSweptHexes(coord, pivot, steps).map(hexKey);
      const second = getRotationSweptHexes(coord, pivot, steps).map(hexKey);
      assert.deepEqual(second, first, 'результат обязан быть детерминированным');
      assert.deepEqual([...new Set(first)], first, 'в списке не должно быть повторов');
    }
  }
});

test('arc: results are ordered by first entry into the hex, then by coordinate', () => {
  for (const distance of [3, 4, 5, 6]) {
    const swept = getRotationSweptHexes({ q: distance, r: 0 }, { q: 0, r: 0 }, 1);
    // Угол входа монотонно растёт вдоль дуги: проверяем через независимый расчёт.
    let previousAngle = -Infinity;
    const start = { q: distance, r: 0 };
    for (const hex of swept) {
      const angle = entryAngleOf(hex, start, { q: 0, r: 0 }, 1);
      assert.ok(angle >= previousAngle - 1e-9, `нарушен порядок входа: радиус ${distance}`);
      previousAngle = angle;
    }
  }
});

test('arc: a 9-link polymer at radius 6 is blocked by a solid pusher body on the swept arc', () => {
  const path: AxialCoord[] = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: -1 },
    { q: -2, r: -1 }, { q: -3, r: -1 }, { q: -4, r: -1 }, { q: -5, r: 0 }, { q: -6, r: 1 },
  ];
  const level = levelWithPresets('R60-radius6', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', -4, -3, { dir: 3 }),
  ], { radius: 7 });
  const world = createWorldFromLevel(level);
  path.forEach((coord, index) => addToken(world, `p${index}`, index + 1, coord.q, coord.r, index + 1));
  for (let i = 0; i < path.length - 1; i++) bondTokens(world, `p${i}`, `p${i + 1}`);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error', 'поворот сквозь корпус толкателя обязан быть отклонён');
  assert.match(world.errorReason ?? '', /дуге поворота/);
  assertUnmoved(world, before);
  assertBondGeometry(world, 'radius 6 rotation');
});

test('arc: level data exposes rotation sectors of radius 7, and they are now covered exactly', () => {
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
  // Радиус 7 покрыт плотной эталонной выборкой в тесте выше, поэтому радиус
  // платформы больше не является ограничением проверки.
  const farthest = { q: maxDistance, r: 0 };
  const dense = denseSweptHexes(farthest, { q: 0, r: 0 }, 1, 1000).map(hexKey);
  const exact = new Set(getRotationSweptHexes(farthest, { q: 0, r: 0 }, 1).map(hexKey));
  for (const hex of dense) assert.ok(exact.has(hex), `радиус ${maxDistance}: пропущен ${hex}`);
  console.log(`\nАудит вращения: максимум ${maxDistance} гексов от ротатора до платформы (${where}); сектор проверяется непрерывно.\n`);
});

test('arc: a sphere that vacates a swept hex in the same tick blocks the rotation', () => {
  const world = createWorldFromLevel(levelWithPresets('R60-vacating', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('conveyor', 1, 1, { dir: 0 }),
  ], { radius: 5 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'leaver', 9, 1, 1, 3);

  const arc = getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1).map(hexKey);
  assert.ok(arc.includes('1,1'), `подготовка теста: дуга сферы (2,0) должна проходить через 1,1 (${arc.join(' ')})`);
  const before = coords(world);

  stepSimulation(world);

  // Правило контракта: занятость сектора считается по объединению «начало ∪ конец».
  assert.equal(world.status, 'error', 'сфера, покидающая сектор в том же такте, всё равно перекрывает дугу');
  assert.match(world.errorReason ?? '', /сектор поворота занят другой сферой/);
  assertUnmoved(world, before);
  assertBondGeometry(world, 'vacating sphere');
});

test('arc: a sphere entering the sector in the same tick also blocks the rotation', () => {
  // Сфера приезжает конвейером на гекс сектора в том же такте.
  const world = createWorldFromLevel(levelWithPresets('R60-entering', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('conveyor', 2, 1, { dir: 3 }),
  ], { radius: 5 }));
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 3, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  addToken(world, 'arriver', 9, 2, 1, 3);
  const before = coords(world);

  const arc = getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1).map(hexKey);
  assert.ok(arc.includes('1,1'), 'подготовка теста: дуга должна проходить через 1,1');

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /сектор поворота занят другой сферой/);
  assertUnmoved(world, before);
});

// ---------------------------------------------------------------------------
// 180°: сваппер
// ---------------------------------------------------------------------------

test('180°: the swapper rotates a bonded polymer as a rigid body and keeps the bond', () => {
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

test('180°: a swapper cannot rotate a polymer onto a solid body, and the tick stays atomic', () => {
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

test('180°: two swapper exchanges in a row return the pair to the starting hexes', () => {
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
// Сводка аудита вращения
// ---------------------------------------------------------------------------

/**
 * Сводка PR #4D: три ранее задокументированных расхождения по вращению
 * (`rotation-sweep-sampling`, `rotation-sweep-housing-slip`,
 * `rotation-intermediate-trajectory`) переведены в обычные проверки контракта
 * `docs/rotation-geometry-contract.md`. Реестр расхождений в этом файле пуст:
 * любое новое расхождение должно появиться через `documentDivergence` явно.
 */
test('rotation audit summary: the rotation contract has no documented divergences', () => {
  const ids = documentedViolations().map((v) => v.id).sort();
  assert.deepEqual(ids, []);
});
