import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_LEVELS } from './levels';
import {
  createWorldFromLevel,
  runUntilComplete,
  verifyLevelSolution,
} from './hex-engine';
import {
  getRequiredBySink,
  lintVerificationExpectations,
} from './verification';
import { checkVictory, hasCompletedGoals } from './victory';
import type { LevelDefinition, TargetPattern } from './types';

const twoSinkLevel: LevelDefinition = {
  id: 'two-sinks',
  index: 1,
  title: '',
  subtitle: '',
  tier: 'Начальный',
  radius: 2,
  availableTools: [],
  requiredDeliveries: 4,
  presetMachines: [
    {
      type: 'sink',
      coord: { q: -1, r: 0 },
      locked: true,
      config: {
        dir: 0,
        sinkId: 'main',
        targetPattern: {
          mode: 'exact',
          nodes: [{ offset: { q: 0, r: 0 } }],
          edges: [],
          rotationInvariant: true,
          label: 'main',
        },
      },
    },
    {
      type: 'sink',
      coord: { q: 1, r: 0 },
      locked: true,
      config: {
        dir: 0,
        sinkId: 'side',
        targetPattern: {
          mode: 'exact',
          nodes: [{ offset: { q: 0, r: 0 } }],
          edges: [],
          rotationInvariant: true,
          label: 'side',
        },
      },
    },
  ],
  pedagogyNote: '',
  bonusGoalText: '',
};

test('getRequiredBySink: значения и полимеры одной доставки не суммируются', () => {
  // Одинаковый приёмник, оба вида ожиданий одной длины — одна доставка.
  assert.deepEqual(
    getRequiredBySink({
      expectedSinkValues: { main: [1, 2] },
      expectedSinkPolymers: { main: [[1], [2]] },
    }),
    { main: 2 },
  );

  // Разные приёмники и разные виды ожиданий объединяются.
  assert.deepEqual(
    getRequiredBySink({
      expectedSinkValues: { pos: [2, 3, 4] },
      expectedSinkPolymers: { main: [[6, 3, 3]] },
    }),
    { pos: 3, main: 1 },
  );

  // Только полимеры.
  assert.deepEqual(
    getRequiredBySink({ expectedSinkPolymers: { main: [[2, 4, 2]] } }),
    { main: 1 },
  );

  // Пустые ожидания.
  assert.deepEqual(getRequiredBySink({}), {});
});

test('getRequiredBySink: несовместимые длины ожиданий — исключение', () => {
  assert.throws(
    () =>
      getRequiredBySink({
        expectedSinkValues: { main: [1] },
        expectedSinkPolymers: { main: [[1], [2]] },
      }),
    /несовместимые длины ожиданий/,
  );
});

test('lintVerificationExpectations: тот же случай без исключения', () => {
  const errors = lintVerificationExpectations({
    expectedSinkValues: { main: [1] },
    expectedSinkPolymers: { main: [[1], [2]] },
  });
  assert.ok(errors.some((e) => e.includes('несовместимые длины ожиданий')));

  assert.deepEqual(lintVerificationExpectations({ expectedSinkValues: { main: [1, 2] } }), []);

  // Ряд полимера не той длины, что вершины образца приёмника.
  const pattern: TargetPattern = {
    mode: 'sum_shape',
    requiredSum: 12,
    nodes: [
      { offset: { q: 0, r: -1 } },
      { offset: { q: 0, r: 0 } },
      { offset: { q: -1, r: 0 } },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 0, toIdx: 2 },
    ],
    rotationInvariant: true,
    label: 'triangle',
  };
  const level: LevelDefinition = {
    ...twoSinkLevel,
    presetMachines: [
      {
        type: 'sink',
        coord: { q: 0, r: 0 },
        locked: true,
        config: { dir: 0, sinkId: 'main', targetPattern: pattern },
      },
    ],
  };
  const badRow = lintVerificationExpectations({ expectedSinkPolymers: { main: [[6, 3]] } }, level);
  assert.ok(badRow.some((e) => e.includes('вместо 3')));
  const goodRow = lintVerificationExpectations({ expectedSinkPolymers: { main: [[6, 3, 3]] } }, level);
  assert.deepEqual(goodRow, []);

  // Значения вне диапазона движка.
  const outOfRange = lintVerificationExpectations({ expectedSinkValues: { main: [1000] } }, level);
  assert.ok(outOfRange.some((e) => e.includes('вне диапазона')));
});

test('createWorldFromLevel: требования считаются по каждому приёмнику отдельно', () => {
  const world = createWorldFromLevel(twoSinkLevel, [], undefined, { main: [1, 2], side: [3] });
  assert.equal(world.requiredDeliveries, 3);
  assert.deepEqual(world.requiredBySink, { main: 2, side: 1 });

  // Значения и полимеры одного приёмника одной доставки: 2 доставки, а не 4.
  const both = createWorldFromLevel(twoSinkLevel, [], undefined, { main: [1, 2] }, { main: [[1], [2]] });
  assert.equal(both.requiredDeliveries, 2);
  assert.deepEqual(both.requiredBySink, { main: 2 });

  // Первичный поток: без требований по приёмникам, как и раньше.
  const primary = createWorldFromLevel(twoSinkLevel);
  assert.equal(primary.requiredDeliveries, 4);
  assert.equal(primary.requiredBySink, undefined);
});

test('hasCompletedGoals: общее число доставок не компенсирует голодный приёмник', () => {
  const world = createWorldFromLevel(twoSinkLevel, [], undefined, { main: [1, 2], side: [3] });
  world.deliveredCount = 3;
  world.sinkDeliveries = { main: [[1], [2]] };
  assert.equal(hasCompletedGoals(world), false, 'side остался без доставок');

  world.sinkDeliveries = { main: [[1]], side: [[3]] };
  assert.equal(hasCompletedGoals(world), false, 'main ожидает 2 доставки');

  world.sinkDeliveries = { main: [[1], [2]], side: [[3]] };
  assert.equal(hasCompletedGoals(world), true);
});

test('checkVictory: прежний формат события, но по приёмочным требованиям', () => {
  const world = createWorldFromLevel(twoSinkLevel, [], undefined, { main: [1, 2], side: [3] });
  world.status = 'running';
  world.deliveredCount = 3;
  world.sinkDeliveries = { main: [[1], [2]] };
  checkVictory(world);
  assert.notEqual(world.status, 'victory', 'победа без side недопустима');

  world.sinkDeliveries = { main: [[1], [2]], side: [[3]] };
  checkVictory(world);
  assert.equal(world.status, 'victory');
  const last = world.events[world.events.length - 1];
  assert.equal(last.type, 'deliver');
  assert.equal(last.severity, 'success');
  assert.match(last.message, /^Цель выполнена за \d+ тактов!$/);
});

test('бесконечный режим никогда не завершается победой', () => {
  const world = createWorldFromLevel({ ...twoSinkLevel, infiniteMode: true });
  world.status = 'running';
  world.deliveredCount = 100;
  assert.equal(hasCompletedGoals(world), false);
  checkVictory(world);
  assert.equal(world.status, 'running');
});

test('отчёт проверки всегда содержит основной поток отдельной строкой', () => {
  const lvl = CAMPAIGN_LEVELS.find((l) => l.id === 'lvl-02')!;
  const report = verifyLevelSolution(lvl, lvl.demoSolution ?? [], 180);
  assert.equal(report.results[0].name, 'Основной поток');
  assert.equal(report.results[0].passed, true);
  assert.equal(report.total, 1 + (lvl.verificationRuns?.length ?? 0));
  assert.equal(report.passed, report.total);
});

test('несовместимые ожидания испытания — понятный сбой в отчёте, а не исключение', () => {
  const lvl = CAMPAIGN_LEVELS.find((l) => l.id === 'lvl-02')!;
  const broken: LevelDefinition = {
    ...lvl,
    verificationRuns: [
      {
        name: 'Несовместимый набор',
        spawnerOverrides: lvl.verificationRuns![0].spawnerOverrides,
        expectedSinkValues: { main: [1, 2] },
        expectedSinkPolymers: { main: [[1]] },
      },
    ],
  };
  const report = verifyLevelSolution(broken, lvl.demoSolution ?? [], 180);
  assert.equal(report.total, 2);
  assert.equal(report.results[0].name, 'Основной поток');
  assert.equal(report.results[0].passed, true);
  assert.equal(report.results[1].name, 'Несовместимый набор');
  assert.equal(report.results[1].passed, false);
  assert.match(report.results[1].reason ?? '', /несовместимые длины ожиданий/);
});

test('полная проверка: приёмочное требование влияет на runUntilComplete', () => {
  // lvl-02 с эталоном: per-sink требования согласованы с обычным потоком.
  const lvl = CAMPAIGN_LEVELS.find((l) => l.id === 'lvl-02')!;
  const world = createWorldFromLevel(lvl, lvl.demoSolution ?? []);
  const { check } = runUntilComplete(world, 180);
  assert.equal(check.passed, true);
});

const twoNodeSinkLevel: LevelDefinition = {
  ...twoSinkLevel,
  presetMachines: [
    {
      type: 'sink',
      coord: { q: 0, r: 0 },
      locked: true,
      config: {
        dir: 0,
        sinkId: 'main',
        targetPattern: {
          mode: 'exact',
          nodes: [{ offset: { q: 0, r: 0 } }, { offset: { q: 1, r: 0 } }],
          edges: [{ fromIdx: 0, toIdx: 1 }],
          rotationInvariant: true,
          label: 'pair',
        },
      },
    },
  ],
};

test('P0: многосферная доставка не принимает совмещённые ожидания', () => {
  // Скалярное ожидание для многозвенного приёмника не проверяется вовсе.
  const scalarOnly = lintVerificationExpectations({ expectedSinkValues: { main: [5] } }, twoNodeSinkLevel);
  assert.ok(scalarOnly.some((e) => e.includes('не проверяются')), `got: ${scalarOnly.join('; ')}`);

  // Совмещение скаляра и полимера для многосферной доставки запрещено.
  const both = lintVerificationExpectations(
    { expectedSinkValues: { main: [5] }, expectedSinkPolymers: { main: [[1, 2]] } },
    twoNodeSinkLevel,
  );
  assert.ok(both.some((e) => e.includes('многосферной доставки')), `got: ${both.join('; ')}`);

  // Однозвенный приёмник: совмещение допустимо только при совпадении значений.
  const inconsistent = lintVerificationExpectations(
    { expectedSinkValues: { main: [999] }, expectedSinkPolymers: { main: [[7]] } },
    twoSinkLevel,
  );
  assert.ok(inconsistent.some((e) => e.includes('не совпадает')), `got: ${inconsistent.join('; ')}`);

  const consistent = lintVerificationExpectations(
    { expectedSinkValues: { main: [7] }, expectedSinkPolymers: { main: [[7]] } },
    twoSinkLevel,
  );
  assert.deepEqual(consistent, []);

  // Только полимеры для многозвенного приёмника — законно.
  const polymersOnly = lintVerificationExpectations({ expectedSinkPolymers: { main: [[1, 2]] } }, twoNodeSinkLevel);
  assert.deepEqual(polymersOnly, []);
});

test('P0: getRequiredBySink тоже отклоняет совмещённые многосферные ожидания', () => {
  assert.throws(
    () => getRequiredBySink({ expectedSinkValues: { main: [5] }, expectedSinkPolymers: { main: [[1, 2]] } }),
    /многосферной доставки/,
  );
  assert.throws(
    () => getRequiredBySink({ expectedSinkValues: { main: [999] }, expectedSinkPolymers: { main: [[7]] } }),
    /не совпадает/,
  );
});

test('P1: приёмник с указанным идентификатором должен существовать', () => {
  const lint = lintVerificationExpectations({ expectedSinkValues: { nonexistent: [5] } }, twoSinkLevel);
  assert.ok(lint.some((e) => e.includes('отсутствует на уровне')), `got: ${lint.join('; ')}`);

  // Но приёмник, поставленный игроком, законен.
  const blocks = [
    { type: 'sink' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const, sinkId: 'placed' } },
  ];
  const withPlaced = lintVerificationExpectations({ expectedSinkValues: { placed: [5] } }, twoSinkLevel, blocks);
  assert.ok(!withPlaced.some((e) => e.includes('отсутствует')), `got: ${withPlaced.join('; ')}`);
});

test('P1: дублирующиеся sinkId отклоняются, основной поток помечается сбоем', () => {
  const dup: LevelDefinition = {
    ...twoSinkLevel,
    presetMachines: [
      twoSinkLevel.presetMachines[0],
      {
        ...twoSinkLevel.presetMachines[1],
        config: { ...twoSinkLevel.presetMachines[1].config, sinkId: 'main' },
      },
    ],
  };
  const lint = lintVerificationExpectations({}, dup);
  assert.ok(
    lint.some((e) => e.includes('идентификатор используется 2 приёмниками')),
    `got: ${lint.join('; ')}`,
  );

  const report = verifyLevelSolution(dup, [], 30);
  assert.equal(report.results[0].name, 'Основной поток');
  assert.equal(report.results[0].passed, false);
  assert.match(report.results[0].reason ?? '', /идентификатор используется/);
});

test('P1: основной поток получает требования по приёмникам из встроенных последовательностей', () => {
  const lvl = CAMPAIGN_LEVELS.find((l) => l.id === 'lvl-02')!;
  const world = createWorldFromLevel(lvl, lvl.demoSolution ?? []);
  assert.deepEqual(world.requiredBySink, { main: 3 });
  // Общее число доставок по уровню при этом не ослабляется и не усиливается.
  assert.equal(world.requiredDeliveries, 3);
  const { check } = runUntilComplete(world, 180);
  assert.equal(check.passed, true);

  // Уровень без встроенных последовательностей — поведение прежнее.
  const withoutEmbedded = createWorldFromLevel(twoSinkLevel);
  assert.equal(withoutEmbedded.requiredBySink, undefined);
});

test('P1: победа основного потока недостижима без квоты хотя бы одного приёмника', () => {
  const scripted: LevelDefinition = {
    ...twoSinkLevel,
    requiredDeliveries: 3,
    presetMachines: [
      {
        ...twoSinkLevel.presetMachines[0],
        config: {
          ...twoSinkLevel.presetMachines[0].config,
          targetPattern: {
            ...twoSinkLevel.presetMachines[0].config.targetPattern!,
            expectedValues: [1, 2],
          },
        },
      },
      {
        ...twoSinkLevel.presetMachines[1],
        config: {
          ...twoSinkLevel.presetMachines[1].config,
          targetPattern: {
            ...twoSinkLevel.presetMachines[1].config.targetPattern!,
            expectedValues: [3],
          },
        },
      },
    ],
  };
  const world = createWorldFromLevel(scripted);
  assert.deepEqual(world.requiredBySink, { main: 2, side: 1 });
  assert.equal(world.requiredDeliveries, 3);

  world.deliveredCount = 3;
  world.sinkDeliveries = { main: [[1], [2]] };
  checkVictory(world);
  assert.notEqual(world.status, 'victory', 'side остался без доставки');

  world.sinkDeliveries = { main: [[1], [2]], side: [[3]] };
  checkVictory(world);
  assert.equal(world.status, 'victory');
});


test('sink identity checks respect replacement of an unlocked preset at its centre', () => {
  const level: LevelDefinition = {
    ...twoSinkLevel,
    availableTools: ['sink', 'conveyor'],
    presetMachines: [
      { ...twoSinkLevel.presetMachines[0], locked: false },
      twoSinkLevel.presetMachines[1],
    ],
  };
  const replacedSink = [{
    type: 'sink' as const,
    coord: { q: -1, r: 0 },
    config: { ...level.presetMachines[0].config },
  }];

  // The player replaces the unlocked fixture; both must not be counted.
  assert.deepEqual(
    lintVerificationExpectations({ expectedSinkValues: { main: [1] } }, level, replacedSink),
    [],
  );

  // If the player replaces that sink with a conveyor, its old sinkId is gone.
  const replacedWithConveyor = [{
    type: 'conveyor' as const,
    coord: { q: -1, r: 0 },
    config: { dir: 0 as const },
  }];
  const errors = lintVerificationExpectations(
    { expectedSinkValues: { main: [1] } },
    level,
    replacedWithConveyor,
  );
  assert.ok(
    errors.some((error) => error.includes('отсутствует на уровне')),
    `expected a missing sink after replacement, got: ${errors.join('; ')}`,
  );
});
