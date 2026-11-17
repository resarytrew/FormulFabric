import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_PUZZLE_LEVELS } from './levels';
import { lintPattern } from './pattern-lint';
import type { TargetPattern } from './types';

const base: TargetPattern = {
  mode: 'exact',
  nodes: [{ offset: { q: 0, r: 0 }, value: 1 }],
  edges: [],
  rotationInvariant: false,
  label: 'ok',
};

test('одноузловой образец не требует связей', () => {
  assert.deepEqual(lintPattern(base), []);
});

test('многоузловой образец с несвязным графом отклоняется', () => {
  const disconnected: TargetPattern = {
    ...base,
    nodes: [
      { offset: { q: 0, r: 0 }, value: 1 },
      { offset: { q: 1, r: 0 }, value: 2 },
      { offset: { q: 4, r: 2 }, value: 3 },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
  };
  const errors = lintPattern(disconnected);
  assert.ok(errors.some((e) => e.includes('не является связным')), `expected connectivity error, got: ${errors.join('; ')}`);

  // Линейная цепочка из соседних вершин реализуема.
  assert.deepEqual(
    lintPattern({
      ...disconnected,
      nodes: [
        { offset: { q: 0, r: 0 }, value: 1 },
        { offset: { q: 1, r: 0 }, value: 2 },
        { offset: { q: 2, r: 0 }, value: 3 },
      ],
      edges: [
        { fromIdx: 0, toIdx: 1 },
        { fromIdx: 1, toIdx: 2 },
      ],
    }),
    [],
  );
});

test('связь между несоседними клетками отклоняется, даже если граф связный', () => {
  // Геометрически невозможно: сварка соединяет только соседей на расстоянии 1.
  const teleport: TargetPattern = {
    ...base,
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 3, r: 1 } },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
  };
  const errors = lintPattern(teleport);
  assert.ok(
    errors.some((e) => e.includes('расстоянии 4')),
    `expected adjacency error with distance 4, got: ${errors.join('; ')}`,
  );

  // Восьмёрка из двух рёбер: граф связен, но оба ребра несоседние.
  const chained: TargetPattern = {
    ...base,
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 3, r: 1 } },
      { offset: { q: 1, r: 1 } },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
    ],
  };
  const chainedErrors = lintPattern(chained);
  assert.ok(chainedErrors.some((e) => e.includes('расстоянии 4')), `expected distance 4 error, got: ${chainedErrors.join('; ')}`);
  assert.ok(chainedErrors.some((e) => e.includes('расстоянии 2')), `expected distance 2 error, got: ${chainedErrors.join('; ')}`);
  assert.ok(!chainedErrors.some((e) => e.includes('не является связным')));

  // Соседняя цепочка реализуема.
  const adjacent: TargetPattern = {
    ...base,
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
      { offset: { q: 1, r: 1 } },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
    ],
  };
  assert.deepEqual(lintPattern(adjacent), []);
});

test('незамкнутые графы законны для цепочечных задач', () => {
  // Двучленный «гантелей» образец из кампании (Σ=10, открытая цепь) не должен запрещаться.
  const openDumbbell: TargetPattern = {
    mode: 'sum_shape',
    requiredSum: 10,
    nodes: [{ offset: { q: 0, r: -1 } }, { offset: { q: 0, r: 0 } }],
    edges: [{ fromIdx: 0, toIdx: 1 }],
    rotationInvariant: false,
    label: '[a ━━ b], Σ=10',
  };
  assert.deepEqual(lintPattern(openDumbbell), []);

  // Рост по цепочке — открытый граф по определению.
  const ladder: TargetPattern = {
    mode: 'growth_ladder',
    ladderStep: { op: 'add', value: 3 },
    nodes: [
      { offset: { q: -1, r: 0 } },
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
    ],
    rotationInvariant: false,
    label: '+3',
  };
  assert.deepEqual(lintPattern(ladder), []);
});

test('замкнутый треугольник (образец g5-04) проходит проверку', () => {
  const closedTriangle: TargetPattern = {
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
    label: '△ Σ = 12',
  };
  assert.deepEqual(lintPattern(closedTriangle), []);
});

test('числовые допустимости: значения вне [-999, 999] отклоняются', () => {
  const tooLarge: TargetPattern = {
    ...base,
    nodes: [{ offset: { q: 0, r: 0 }, value: 1000 }],
  };
  assert.ok(lintPattern(tooLarge).some((e) => e.includes('вне диапазона')));

  const tooSmall: TargetPattern = {
    ...base,
    nodes: [{ offset: { q: 0, r: 0 }, value: -1000 }],
  };
  assert.ok(lintPattern(tooSmall).some((e) => e.includes('вне диапазона')));

  const expectedTooLarge: TargetPattern = {
    ...base,
    nodes: [{ offset: { q: 0, r: 0 } }],
    expectedValues: [1, 1000],
  };
  assert.ok(lintPattern(expectedTooLarge).some((e) => e.includes('expectedValues') && e.includes('вне диапазона')));

  const polymerTooLarge: TargetPattern = {
    ...base,
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
    expectedNodeValues: [[999, -1000]],
  };
  assert.ok(lintPattern(polymerTooLarge).some((e) => e.includes('вне диапазона')));
});

test('sum_shape: сумма должна быть целым и достижимым числом', () => {
  const fractional: TargetPattern = { ...base, mode: 'sum_shape', requiredSum: 10.5 };
  assert.ok(lintPattern(fractional).some((e) => e.includes('Сумма должна быть целым числом')));

  // 2 вершины по ±999: 5000 недостижима.
  const unreachable: TargetPattern = {
    ...base,
    mode: 'sum_shape',
    requiredSum: 5000,
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
  };
  assert.ok(lintPattern(unreachable).some((e) => e.includes('недостижима')));

  const achievable: TargetPattern = { ...unreachable, requiredSum: 1998 };
  assert.deepEqual(lintPattern(achievable), []);
});

test('beam_balance: нужны ровно три вершины', () => {
  const twoNodes: TargetPattern = {
    ...base,
    mode: 'beam_balance',
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
  };
  assert.ok(lintPattern(twoNodes).some((e) => e.includes('три вершины')));

  const threeNodes: TargetPattern = {
    ...twoNodes,
    nodes: [
      { offset: { q: -1, r: 0 } },
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
    ],
  };
  assert.deepEqual(lintPattern(threeNodes), []);
});

test('growth_ladder: шаг сложения обязан быть целым', () => {
  const fractional: TargetPattern = {
    ...base,
    mode: 'growth_ladder',
    ladderStep: { op: 'add', value: 0.5 },
  };
  assert.ok(lintPattern(fractional).some((e) => e.includes('шаг роста по сложению')));

  const integer: TargetPattern = {
    ...fractional,
    ladderStep: { op: 'add', value: 2 },
  };
  assert.deepEqual(lintPattern(integer), []);
});

test('все образцы приёмников из глав являются корректными', () => {
  const sinks: Array<{ levelId: string; label: string; pattern: TargetPattern }> = [];
  for (const level of ALL_PUZZLE_LEVELS) {
    for (const machine of level.presetMachines ?? []) {
      if (machine.type !== 'sink') continue;
      const pattern = machine.config.targetPattern;
      if (pattern) sinks.push({ levelId: level.id, label: pattern.label, pattern });
    }
  }
  assert.ok(sinks.length > 0, 'expected sink patterns in the campaign data');
  for (const { levelId, label, pattern } of sinks) {
    assert.deepEqual(
      lintPattern(pattern),
      [],
      `sink pattern of ${levelId} («${label}») must pass the linter`,
    );
  }
});

test('многозвенный образец не может проверять скалярную последовательность', () => {
  const multiScalar: TargetPattern = {
    ...base,
    nodes: [
      { offset: { q: 0, r: 0 } },
      { offset: { q: 1, r: 0 } },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
    expectedValues: [1, 2],
  };
  assert.ok(lintPattern(multiScalar).some((e) => e.includes('expectedValues')));

  // Полимерные ожидания той же длины допустимы.
  const multiPolymer: TargetPattern = { ...multiScalar, expectedValues: undefined, expectedNodeValues: [[1, 2]] };
  assert.deepEqual(lintPattern(multiPolymer), []);
});

test('совмещённые ожидания однозвенного приёмника обязаны согласовываться по значениям', () => {
  const consistent: TargetPattern = {
    ...base,
    nodes: [{ offset: { q: 0, r: 0 } }],
    expectedValues: [7, 8],
    expectedNodeValues: [[7], [8]],
  };
  assert.deepEqual(lintPattern(consistent), []);

  const mismatched: TargetPattern = {
    ...consistent,
    expectedNodeValues: [[7], [9]],
  };
  assert.ok(lintPattern(mismatched).some((e) => e.includes('не совпадает со звеном полимера')));

  const mismatchedLengths: TargetPattern = {
    ...consistent,
    expectedNodeValues: [[7]],
  };
  assert.ok(lintPattern(mismatchedLengths).some((e) => e.includes('разное число доставок')));
});
