/**
 * Инварианты A (жёсткость полимера), B (допустимость перемещений) и C (атомарность).
 *
 * Аудит PR #4A: движок не меняется, тесты фиксируют правила и находят нарушения.
 * Нарушения, которые уже зафиксированы как дефекты, оформлены через
 * `documentDivergence` — они остаются зелёными, пока дефект существует, и падают,
 * когда поведение исправят (PR #4B/#4D).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel, stepSimulation } from './hex-engine';
import { getRotationSweptHexes } from './rotation';
import { generateHexDisk, hexDistance, hexKey, hexNeighbor, rotateAroundPivot } from './hex-math';
import {
  addToken,
  isErrorWorld,
  isTerminal,
  assertBondGeometry,
  assertNoIllegalOverlaps,
  assertMovementInvariants,
  assertTokensOnPlatform,
  auditLevel,
  bondTokens,
  documentedViolations,
  levelWithPresets,
  mulberry32,
  preset,
  tokensAt,
} from './audit-kit';
import type { AxialCoord, LevelDefinition, MachineType, SimulationWorld } from './types';

function coords(world: SimulationWorld): Record<string, AxialCoord> {
  const out: Record<string, AxialCoord> = {};
  for (const tok of world.tokens.values()) out[tok.id] = { ...tok.coord };
  return out;
}

function assertUnmoved(world: SimulationWorld, before: Record<string, AxialCoord>, label: string): void {
  for (const [id, coord] of Object.entries(before)) {
    const tok = world.tokens.get(id);
    assert.ok(tok, `${label}: сфера ${id} исчезла при столкновении`);
    assert.deepEqual(tok!.coord, coord, `${label}: сфера ${id} частично переместилась на (${tok!.coord.q}, ${tok!.coord.r})`);
  }
}

// ---------------------------------------------------------------------------
// Инвариант A — сохранение жёсткой конструкции
// ---------------------------------------------------------------------------

test('A: bonded polymer rides two belts as one rigid body and never stretches', () => {
  const level = levelWithPresets('A-belt', [
    preset('conveyor', 0, 0, { dir: 0 }),
    preset('conveyor', 1, 0, { dir: 0 }),
  ], { radius: 6 });
  const world = createWorldFromLevel(level);
  addToken(world, 'a', 4, 0, 0, 1);
  addToken(world, 'b', 6, 1, 0, 2);
  bondTokens(world, 'a', 'b');

  const distances = new Set<number>();
  for (let tick = 0; tick < 4; tick++) {
    stepSimulation(world);
    assert.equal(world.status, 'running', `tick ${world.tick}: ${world.errorReason ?? ''}`);
    assertMovementInvariants(world, `tick ${world.tick}`);
    distances.add(hexDistance(world.tokens.get('a')!.coord, world.tokens.get('b')!.coord));
  }
  assert.deepEqual([...distances], [1], 'расстояние между связанными сферами должно сохраняться');
  // Полимер проезжает ровно столько, сколько его везут два конвейера: 2 такта,
  // дальше под ним нет привода, и он обязан остановиться, не растянувшись.
  assert.deepEqual(world.tokens.get('a')!.coord, { q: 2, r: 0 });
  assert.deepEqual(world.tokens.get('b')!.coord, { q: 3, r: 0 });
});

test('A: a bonded sphere on an empty hex follows its belt-driven partner instead of being left behind', () => {
  // Пользовательский сценарий: одна сфера на конвейере, вторая — на пустой клетке.
  const level = levelWithPresets('A-empty-neighbour', [
    preset('conveyor', 0, 0, { dir: 0 }),
  ], { radius: 5 });
  const world = createWorldFromLevel(level);
  addToken(world, 'driver', 2, 0, 0, 1);
  addToken(world, 'passenger', 3, 0, 1, 2);
  bondTokens(world, 'driver', 'passenger');

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('passenger')!.coord, { q: 1, r: 1 }, 'пассажир обязан ехать вместе с полимером');
  assert.equal(hexDistance(world.tokens.get('driver')!.coord, world.tokens.get('passenger')!.coord), 1);
  assertBondGeometry(world, 'after tick');
});

test('A: 60° rotator swing is a rigid rotation of the whole polymer', () => {
  const level = levelWithPresets('A-rotator', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
  ], { radius: 5 });
  const world = createWorldFromLevel(level);
  addToken(world, 'near', 3, 1, 0, 1);
  addToken(world, 'far', 8, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  const pivot = { q: 0, r: 0 };

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('near')!.coord, rotateAroundPivot({ q: 1, r: 0 }, pivot, 1));
  assert.deepEqual(world.tokens.get('far')!.coord, rotateAroundPivot({ q: 2, r: 0 }, pivot, 1));
  assert.deepEqual(world.tokens.get('near')!.coord, { q: 0, r: 1 });
  assert.deepEqual(world.tokens.get('far')!.coord, { q: 0, r: 2 });
  assert.equal(hexDistance(world.tokens.get('near')!.coord, world.tokens.get('far')!.coord), 1);
  assertBondGeometry(world, 'after rotator tick');
});

test('A: pusher and magnet translate a bonded polymer without tearing the bond', () => {
  const pushLevel = levelWithPresets('A-pusher', [
    preset('pusher', -1, 0, { dir: 0 }),
  ], { radius: 5 });
  const pushed = createWorldFromLevel(pushLevel);
  addToken(pushed, 'lead', 1, 0, 0, 1);
  addToken(pushed, 'tail', 2, 1, 0, 2);
  bondTokens(pushed, 'lead', 'tail');
  stepSimulation(pushed);
  assert.equal(pushed.status, 'running', pushed.errorReason ?? '');
  assert.equal(tokensAt(pushed), '1@1,0 2@2,0');
  assertBondGeometry(pushed, 'pusher');

  const magnetLevel = levelWithPresets('A-magnet', [
    preset('magnet', 4, 0, { dir: 3 }),
  ], { radius: 5 });
  const pulled = createWorldFromLevel(magnetLevel);
  addToken(pulled, 'lead', 1, 2, 0, 1);
  addToken(pulled, 'tail', 2, 1, 0, 2);
  bondTokens(pulled, 'lead', 'tail');
  stepSimulation(pulled);
  assert.equal(pulled.status, 'running', pulled.errorReason ?? '');
  assert.equal(tokensAt(pulled), '1@3,0 2@2,0');
  assertBondGeometry(pulled, 'magnet');
});

test('A: welder bonds only adjacent spheres while laser removes exactly one bond', () => {
  const weldLevel = levelWithPresets('A-welder', [
    preset('welder', 0, 0, { dir: 0 }),
  ], { radius: 4 });
  const welded = createWorldFromLevel(weldLevel);
  addToken(welded, 'a', 1, 0, 0, 1);
  addToken(welded, 'b', 2, 1, 0, 2);
  stepSimulation(welded);
  assert.deepEqual(welded.bonds.map((b) => `${b.a}-${b.b}`).sort(), ['a-b']);
  assertBondGeometry(welded, 'welder');

  const cutLevel = levelWithPresets('A-laser', [
    preset('laser', 0, 0, { dir: 0 }),
  ], { radius: 4 });
  const cut = createWorldFromLevel(cutLevel);
  addToken(cut, 'a', 1, 0, 0, 1);
  addToken(cut, 'b', 2, 1, 0, 2);
  bondTokens(cut, 'a', 'b');
  stepSimulation(cut);
  assert.deepEqual(cut.bonds, [], 'лазер обязан разрезать связь');
  assert.equal(cut.tokens.size, 2, 'лазер не перемещает и не удаляет сферы');
});

test('A/B/C: 200 seeded random worlds keep geometry, occupancy and platform invariants after every tick', () => {
  const TYPES: MachineType[] = [
    'conveyor', 'conveyor', 'conveyor', 'add1', 'sub1', 'mul2', 'div2', 'sqrt', 'neg', 'dup',
    'adder', 'filter', 'splitter', 'divmod', 'halver', 'scales', 'jumper', 'pusher', 'magnet',
    'rotator', 'swapper', 'welder', 'laser', 'destroyer', 'sink', 'spawner',
  ];

  const buildWorld = (seed: number): SimulationWorld => {
    const rnd = mulberry32(seed);
    const radius = 3 + Math.floor(rnd() * 3);
    const hexes = generateHexDisk(radius);
    const used: AxialCoord[] = [];
    const machineCount = 2 + Math.floor(rnd() * 8);
    const presets: Array<{ type: MachineType; coord: AxialCoord; config: Record<string, unknown> }> = [];
    for (let i = 0; i < machineCount; i++) {
      const hex = hexes[Math.floor(rnd() * hexes.length)];
      if (used.some((h) => hexKey(h) === hexKey(hex))) continue;
      used.push(hex);
      const type = TYPES[Math.floor(rnd() * TYPES.length)];
      const dir = Math.floor(rnd() * 6);
      const config: Record<string, unknown> = { dir };
      if (type === 'spawner') {
        config.sequence = [1, 2, 3];
        config.spawnInterval = 2;
      }
      if (type === 'filter') {
        config.altDir = (dir + 1) % 6;
        config.filterRule = 'even';
      }
      if (type === 'splitter' || type === 'scales' || type === 'halver' || type === 'dup') config.altDir = (dir + 1) % 6;
      if (type === 'divmod') config.divisor = 2;
      if (type === 'rotator') config.rotMode = rnd() < 0.5 ? 'cw' : 'ccw';
      presets.push({ type, coord: hex, config });
    }
    const level: LevelDefinition = auditLevel({
      id: `fuzz-${seed}`,
      radius,
      presetMachines: presets.map((p) => ({
        type: p.type,
        coord: { ...p.coord },
        locked: true,
        config: p.config as never,
      })),
    });
    const world = createWorldFromLevel(level);
    if (isErrorWorld(world)) return world;

    const solid = new Set([...world.machines.values()].map((m) => hexKey(m.coord)));
    const free = [...world.platformHexes]
      .filter((key) => !solid.has(key))
      .map((key) => {
        const [q, r] = key.split(',').map(Number);
        return { q, r };
      });
    const placed: Array<{ id: string; coord: AxialCoord }> = [];
    const tokenCount = 1 + Math.floor(rnd() * 5);
    let seq = 0;
    for (let i = 0; i < tokenCount; i++) {
      if (placed.length > 0 && rnd() < 0.5) {
        const base = placed[Math.floor(rnd() * placed.length)];
        const next = hexNeighbor(base.coord, Math.floor(rnd() * 6) as 0 | 1 | 2 | 3 | 4 | 5);
        const key = hexKey(next);
        if (!world.platformHexes.has(key) || solid.has(key) || placed.some((p) => hexKey(p.coord) === key)) continue;
        seq += 1;
        const id = `t${seq}`;
        addToken(world, id, 1 + Math.floor(rnd() * 9), next.q, next.r, seq);
        placed.push({ id, coord: next });
        bondTokens(world, base.id, id);
        continue;
      }
      const hex = free[Math.floor(rnd() * free.length)];
      if (!hex || placed.some((p) => hexKey(p.coord) === hexKey(hex))) continue;
      seq += 1;
      const id = `t${seq}`;
      addToken(world, id, 1 + Math.floor(rnd() * 9), hex.q, hex.r, seq);
      placed.push({ id, coord: hex });
    }
    return world;
  };

  let simulated = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const world = buildWorld(seed);
    if (isErrorWorld(world)) continue;
    simulated += 1;
    for (let tick = 0; tick < 40; tick++) {
      assert.doesNotThrow(() => stepSimulation(world), `seed ${seed}: движок бросил исключение на такте ${world.tick}`);
      assertMovementInvariants(world, `seed ${seed}, tick ${world.tick}, status=${world.status}`);
      if (isTerminal(world)) break;
    }
  }
  assert.ok(simulated > 150, `слишком мало сгенерированных миров: ${simulated}`);
});

// ---------------------------------------------------------------------------
// Инвариант B — отсутствие недопустимых пересечений
// ---------------------------------------------------------------------------

test('B: two independent spheres exchanging neighbouring hexes is a head-on collision', () => {
  const level = levelWithPresets('B-swap-collision', [
    preset('conveyor', 0, 0, { dir: 0 }),
    preset('conveyor', 1, 0, { dir: 3 }),
  ], { radius: 4 });
  const world = createWorldFromLevel(level);
  addToken(world, 'left', 1, 0, 0, 1);
  addToken(world, 'right', 2, 1, 0, 2);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Встречное столкновение/, world.errorReason ?? '');
  assertUnmoved(world, before, 'head-on');
});

test('B: the swapper is the only legal way to exchange two neighbouring spheres', () => {
  const level = levelWithPresets('B-swapper', [
    preset('swapper', 0, 0, { dir: 0 }),
  ], { radius: 4 });
  const world = createWorldFromLevel(level);
  addToken(world, 'left', 1, -1, 0, 1);
  addToken(world, 'right', 2, 1, 0, 2);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.deepEqual(world.tokens.get('left')!.coord, { q: 1, r: 0 });
  assert.deepEqual(world.tokens.get('right')!.coord, { q: -1, r: 0 });
  assert.equal(world.tokens.get('left')!.moveSource, 'swap');
  assertNoIllegalOverlaps(world, 'swapper');
});

test('B: a three-sphere belt cycle is legal — the three trajectories share no edge', () => {
  // (0,0) → (1,0) → (0,1) → (0,0): три разных ребра, встречного обмена нет.
  const level = levelWithPresets('B-cycle3', [
    preset('conveyor', 0, 0, { dir: 0 }),
    preset('conveyor', 1, 0, { dir: 2 }),
    preset('conveyor', 0, 1, { dir: 4 }),
  ], { radius: 4 });
  const world = createWorldFromLevel(level);
  addToken(world, 'a', 1, 0, 0, 1);
  addToken(world, 'b', 2, 1, 0, 2);
  addToken(world, 'c', 3, 0, 1, 3);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.equal(tokensAt(world), '1@1,0 2@0,1 3@0,0');
  assertNoIllegalOverlaps(world, 'three-cycle');
});

test('B: two spheres arriving at the adder on the same tick are an explicitly allowed overlap and merge into the sum', () => {
  const level = levelWithPresets('B-adder-two-input', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('conveyor', 0, -1, { dir: 1 }),
    preset('adder', 0, 0, { dir: 0 }),
  ], { radius: 4 });
  const world = createWorldFromLevel(level);
  addToken(world, 'x', 3, -1, 0, 1);
  addToken(world, 'y', 7, 0, -1, 2);

  stepSimulation(world);

  assert.equal(world.status, 'running', world.errorReason ?? '');
  assert.equal(world.tokens.size, 1, 'два входа обязаны слиться в один результат');
  const merged = [...world.tokens.values()][0];
  assert.equal(merged.value, 10);
  assert.deepEqual(merged.coord, { q: 0, r: 0 });
  assert.deepEqual(world.bonds, []);
  assertNoIllegalOverlaps(world, 'adder merge');
});

test('B: a third sphere converging on the adder is rejected, two is the maximum', () => {
  const level = levelWithPresets('B-adder-three-input', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('conveyor', 0, -1, { dir: 1 }),
    preset('conveyor', 1, -1, { dir: 2 }),
    preset('adder', 0, 0, { dir: 0 }),
  ], { radius: 4 });
  const world = createWorldFromLevel(level);
  addToken(world, 'x', 3, -1, 0, 1);
  addToken(world, 'y', 7, 0, -1, 2);
  addToken(world, 'z', 5, 1, -1, 3);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Столкновение 3 числовых сфер/);
  assertUnmoved(world, before, 'adder 3-input');
});

test('B: two spheres arriving at the scales are sorted big→dir / small→alt independently of storage order', () => {
  const level = levelWithPresets('B-scales-two-input', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('conveyor', 0, 1, { dir: 4 }),
    preset('scales', 0, 0, { dir: 0, altDir: 4 }),
  ], { radius: 4 });
  const build = (reverse: boolean): SimulationWorld => {
    const world = createWorldFromLevel(level);
    if (reverse) {
      addToken(world, 'big', 7, 0, 1, 1);
      addToken(world, 'small', 3, -1, 0, 2);
    } else {
      addToken(world, 'small', 3, -1, 0, 1);
      addToken(world, 'big', 7, 0, 1, 2);
    }
    return world;
  };

  const forward = build(false);
  const reverse = build(true);
  stepSimulation(forward);
  stepSimulation(reverse);

  for (const world of [forward, reverse]) {
    assert.equal(world.status, 'running', world.errorReason ?? '');
    assert.equal(tokensAt(world), '3@0,-1 7@0,0', 'большее число уходит по dir, меньшее — на боковой выход');
    assertNoIllegalOverlaps(world, 'scales');
  }
});

// ---------------------------------------------------------------------------
// Инвариант C — атомарность перемещения
// ---------------------------------------------------------------------------

test('C: swept-arc collision leaves every sphere on its pre-tick hex', () => {
  const level = levelWithPresets('C-swept-arc', [
    preset('rotator', 0, 0, { dir: 0, rotMode: 'cw' }),
    preset('pusher', 1, 1, { dir: 0 }),
  ], { radius: 5 });
  const world = createWorldFromLevel(level);
  addToken(world, 'near', 2, 1, 0, 1);
  addToken(world, 'far', 4, 2, 0, 2);
  bondTokens(world, 'near', 'far');
  assert.ok(
    getRotationSweptHexes({ q: 2, r: 0 }, { q: 0, r: 0 }, 1).some((h) => hexKey(h) === hexKey({ q: 1, r: 1 })),
    'подготовка теста: корпус толкателя должен лежать на дуге',
  );
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /дуге поворота/);
  assertUnmoved(world, before, 'swept arc');
  assertBondGeometry(world, 'swept arc');
});

test('C: pusher overload leaves every sphere on its pre-tick hex', () => {
  const level = levelWithPresets('C-pusher-overload', [
    preset('pusher', -2, 0, { dir: 0 }),
  ], { radius: 5 });
  const world = createWorldFromLevel(level);
  addToken(world, 'a', 1, -1, 0, 1);
  addToken(world, 'b', 2, 0, 0, 2);
  addToken(world, 'c', 3, 1, 0, 3);
  addToken(world, 'd', 4, 2, 0, 4);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Перегрузка толкателя/);
  assertUnmoved(world, before, 'pusher overload');
});

test('C: mechanism-phase rejection (bonded sphere on the adder) happens after the whole move is applied', () => {
  // Движение атомарно: обе сферы полимера доезжают, и только затем сумматор
  // отказывается принимать связанное число.
  const level = levelWithPresets('C-adder-bonded', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('adder', 0, 0, { dir: 0 }),
  ], { radius: 4 });
  const world = createWorldFromLevel(level);
  addToken(world, 'head', 5, -1, 0, 1);
  addToken(world, 'tail', 6, -1, 1, 2);
  bondTokens(world, 'head', 'tail');

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Сумматор принимает только отдельные несвязанные числа/);
  assert.deepEqual(world.tokens.get('head')!.coord, { q: 0, r: 0 }, 'первая сфера полимера уже перемещена');
  assert.deepEqual(world.tokens.get('tail')!.coord, { q: 0, r: 1 }, 'вторая сфера перемещена тем же тактом');
  assertBondGeometry(world, 'adder bonded rejection');
  assertNoIllegalOverlaps(world, 'adder bonded rejection');
});

test('C: falling off the platform is atomic', () => {
  const level = levelWithPresets('C-fall', [
    preset('conveyor', 2, 0, { dir: 0 }),
  ], { radius: 2 });
  const world = createWorldFromLevel(level);
  addToken(world, 't', 7, 2, 0, 1);
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /Падение за край/);
  assertUnmoved(world, before, 'fall');
  assertTokensOnPlatform(world, 'fall');
  assert.equal(world.fallingTokens?.length, 1, 'падение должно быть зафиксировано для анимации');
});

test('C: a collision on tick N never leaves a half-applied movement in the token array', () => {
  // Полимер из трёх сфер, у которого вторая сфера упирается в корпус:
  // ни одна из трёх сфер не должна сдвинуться.
  const level = levelWithPresets('C-partial', [
    preset('conveyor', -1, 0, { dir: 0 }),
    preset('pusher', 2, 0, { dir: 0 }),
  ], { radius: 5 });
  const world = createWorldFromLevel(level);
  addToken(world, 'a', 1, -1, 0, 1);
  addToken(world, 'b', 2, 0, 0, 2);
  addToken(world, 'c', 3, 1, 0, 3);
  bondTokens(world, 'a', 'b');
  bondTokens(world, 'b', 'c');
  const before = coords(world);

  stepSimulation(world);

  assert.equal(world.status, 'error');
  assert.match(world.errorReason ?? '', /корпусом механизма/);
  assertUnmoved(world, before, 'partial move');
  assertBondGeometry(world, 'partial move');
});

test('invariant audit summary: A, B and C have no documented divergences', () => {
  const ids = documentedViolations().map((v) => v.id);
  assert.deepEqual(ids, [], `инварианты A/B/C не должны иметь задокументированных нарушений, найдено: ${ids.join(', ')}`);
});
