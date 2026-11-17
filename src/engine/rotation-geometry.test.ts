/**
 * Геометрия вращения (пункт 3.3): математические свойства 60°/180°-поворотов,
 * проверка дуги ротатора, границы выборки и промежуточные траектории.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel, getRotationSweptHexes, stepSimulation } from './hex-engine';
import { ALL_PUZZLE_LEVELS } from './levels';
import {
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
  documentDivergence,
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

/** Плотная эталонная выборка дуги: тот же поворот, но 200 точек вместо 10. */
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
// Выборка дуги: где 10 точек достаточно, а где нет
// ---------------------------------------------------------------------------

test('sampling: the 10-sample arc covers the whole dense 200-sample arc for radii 2..5', () => {
  let checked = 0;
  for (const pivot of [{ q: 0, r: 0 }, { q: 1, r: -2 }, { q: -2, r: 1 }]) {
    for (let q = -7; q <= 7; q++) {
      for (let r = -7; r <= 7; r++) {
        const coord = { q, r };
        const distance = hexDistance(coord, pivot);
        if (distance < 2 || distance > 5) continue;
        for (const steps of [1, -1] as const) {
          const sampled = new Set(getRotationSweptHexes(coord, pivot, steps).map(hexKey));
          for (const hex of denseSweptHexes(coord, pivot, steps)) {
            assert.ok(sampled.has(hexKey(hex)), `дуга не содержит ${hexKey(hex)}: pivot ${hexKey(pivot)}, coord ${hexKey(coord)}, steps ${steps}`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 200, `проверено дуг: ${checked}`);
});

test('[P2] sampling: at radius 6 the 10-sample arc misses hexes of the real sector, and a rotator may sweep through a housing', () => {
  const pivot = { q: 0, r: 0 };
  const far = { q: -6, r: 1 };
  const sampled = getRotationSweptHexes(far, pivot, 1).map(hexKey);
  const dense = denseSweptHexes(far, pivot, 1).map(hexKey);
  const missed = dense.filter((hex) => !sampled.includes(hex));
  assert.ok(missed.length > 0, 'подготовка теста: на радиусе 6 выборка обязана быть неполной');
  assert.ok(missed.includes('-4,-3'), `ожидался пропуск гекса -4,-3, получено ${missed.join(' ')}`);

  documentDivergence({
    id: 'rotation-sweep-sampling',
    severity: 'P2',
    title: 'Дуга поворота проверяется по 10 точкам: на радиусе ≥6 препятствие может оказаться между выборками',
    expected: 'список пропущенных гексов относительно плотной эталонной выборки должен быть пуст',
    actual: '10-точечная выборка пропускает гекс -4,-3 из 200-точечной эталонной выборки',
    note: 'PR #4D: заменить выборку на непрерывную проверку сектора (пересечение дуги с гексами) или увеличить частоту пропорционально радиусу.',
  }, [], missed);
});

test('[P2] sampling: a full 9-link polymer at radius 6 rotates through a solid pusher body without a collision', () => {
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

  stepSimulation(world);

  const farToken = world.tokens.get(`p${path.length - 1}`)!;
  const expectedEnd = rotateAroundPivot(path[path.length - 1], { q: 0, r: 0 }, 1);

  documentDivergence({
    id: 'rotation-sweep-housing-slip',
    severity: 'P2',
    title: 'Полимер на радиусе 6 проходит сквозь корпус толкателя: дуга пересекает занятый гекс, проверка его не видит',
    expected: 'поворот должен быть отклонён: гекс (-4,-3) с корпусом толкателя лежит внутри сектора поворота дальней сферы',
    actual: 'поворот выполняется, дальняя сфера встаёт на свою 60°-позицию',
    note: 'Практический риск ограничен: нужен полимер из 9 сфер и платформа радиусом ≥6; но в imp-02 гексы платформы уже лежат на расстоянии 7 от ротатора.',
  }, { status: 'error', far: hexKey(farToken.coord) }, { status: world.status, far: hexKey(farToken.coord) });

  assert.deepEqual(farToken.coord, expectedEnd, 'сфера обязана оказаться в 60°-позиции, если поворот разрешён');
  assertBondGeometry(world, 'radius 6 rotation');
});

test('sampling: level data already exposes rotation sectors of radius 7, so the sampling limit is reachable', () => {
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
  console.log(`\nАудит вращения: максимум ${maxDistance} гексов от ротатора до платформы (${where}); 10-точечная выборка достаточна только до 5.\n`);
});

test('[P2] intermediate trajectory: a sphere that vacates a swept hex in the same tick is not treated as an obstacle', () => {
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

  stepSimulation(world);

  documentDivergence({
    id: 'rotation-intermediate-trajectory',
    severity: 'P2',
    title: 'Промежуточные траектории не учитываются: сфера, покидающая сектор в том же такте, не считается препятствием',
    expected: 'правило должно быть задано явно: либо сектор блокируется занятием на начало такта, либо пересечение траекторий допустимо — и это закреплено тестом',
    actual: 'проверка сравнивает дугу только с конечными координатами других сфер, поэтому одновременный уход с гекса сектора не мешает повороту',
    note: 'PR #4D: проверять дугу против (старт ∪ финиш) всех сфер вне компонента, либо задокументировать правило «считается только конечная занятость».',
  }, { status: 'error' }, { status: world.status });

  assert.equal(world.tokens.get('leaver')!.coord.q, 2, 'вторая сфера уезжает по конвейеру');
  assert.equal(world.tokens.get('leaver')!.coord.r, 1);
  assertBondGeometry(world, 'vacating sphere');
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

test('rotation audit summary: documented divergences of this suite', () => {
  const ids = documentedViolations().map((v) => v.id).sort();
  assert.deepEqual(ids, ['rotation-intermediate-trajectory', 'rotation-sweep-housing-slip', 'rotation-sweep-sampling']);
  console.log(`\n=== Аудит вращения: расхождения (${ids.length}) ===\n${formatViolationTable()}\n`);
});
