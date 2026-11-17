import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SPAWN_SEQUENCE_LENGTH,
  validateMachineConfig,
} from './machine-config';
import { validateLevelPlacement } from './world';
import { ALL_PUZZLE_LEVELS } from './levels';
import type { LevelDefinition, MachineConfig, MachineType } from './types';

const level: LevelDefinition = {
  id: 'machine-config-test',
  index: 1,
  title: '',
  subtitle: '',
  tier: 'Начальный',
  radius: 2,
  availableTools: ['divmod', 'dup', 'splitter', 'conveyor', 'filter', 'halver', 'scales', 'spawner', 'rotator'],
  requiredDeliveries: 1,
  presetMachines: [],
  pedagogyNote: '',
  bonusGoalText: '',
};

const validate = (type: MachineType, config: MachineConfig, override: LevelDefinition = level) =>
  validateMachineConfig(type, config, override);

test('делитель с нулём не доходит до деления', () => {
  assert.ok(validate('divmod', { dir: 0, divisor: 0 }).some((e) => e.includes('Делитель')));
  assert.ok(validate('divmod', { dir: 0, divisor: -2 }).some((e) => e.includes('Делитель')));
  assert.ok(validate('divmod', { dir: 0, divisor: 2.5 }).some((e) => e.includes('Делитель')));
  assert.ok(validate('divmod', { dir: 0, divisor: 1000 }).some((e) => e.includes('Делитель')));
  assert.deepEqual(validate('divmod', { dir: 0, divisor: 1 }), []);
  assert.deepEqual(validate('divmod', { dir: 0, divisor: 999 }), []);
  assert.deepEqual(validate('divmod', { dir: 0 }), []); // по умолчанию b = 2

  // Фиксированный делитель уровня перекрывает конфиг и тоже проверяется.
  const fixed = { ...level, fixedDivisor: 0 };
  assert.ok(validate('divmod', { dir: 0 }, fixed).some((e) => e.includes('Делитель')));
  const fixedOk = { ...level, fixedDivisor: 2 };
  assert.deepEqual(validate('divmod', { dir: 0, divisor: 7 }, fixedOk), []); // конфиг игнорируется, но не считается ошибкой
});

test('направления должны быть целыми от 0 до 5', () => {
  assert.deepEqual(validate('conveyor', { dir: 0 }), []);
  assert.deepEqual(validate('conveyor', { dir: 5 }), []);
  for (const dir of [-1, 6, 1.5, Number.NaN] as unknown as MachineConfig['dir'][]) {
    assert.ok(validate('conveyor', { dir }).some((e) => e.includes('Направление должно быть от 0 до 5')));
  }
  assert.ok(validate('conveyor', { dir: 0, altDir: 9 as unknown as MachineConfig['altDir'] }).some((e) => e.includes('второго выхода')));
  assert.deepEqual(validate('conveyor', { dir: 0, altDir: 3 }), []);
});

test('совпавшие основной и боковой выходы — ошибка для устройств с двумя выходами', () => {
  for (const type of ['dup', 'halver', 'divmod', 'scales', 'filter'] as const) {
    assert.ok(
      validate(type, { dir: 2, altDir: 2 }).some((e) => e.includes('Основной и боковой выходы совпадают')),
      `${type}: совпадение выходов должно отклоняться`,
    );
  }

  // Разделитель чередует выходы — совпадение для него легально.
  assert.deepEqual(validate('splitter', { dir: 2, altDir: 2 }), []);
  // Транспорт altDir не использует.
  assert.deepEqual(validate('conveyor', { dir: 2, altDir: 2 }), []);
  // Разные выходы — всегда допустимо.
  assert.deepEqual(validate('divmod', { dir: 2, altDir: 3 }), []);
});

test('filterRule и rotMode проверяются по типу значения', () => {
  assert.deepEqual(validate('filter', { dir: 0, filterRule: 'even' }), []);
  assert.deepEqual(validate('filter', { dir: 0, filterRule: 'gt5' }), []);
  for (const filterRule of ['maybe', '', 1, null] as unknown as MachineConfig['filterRule'][]) {
    assert.ok(validate('filter', { dir: 0, filterRule }).some((e) => e.includes('правило фильтра')));
  }

  assert.deepEqual(validate('rotator', { dir: 0, rotMode: 'cw' }), []);
  assert.deepEqual(validate('rotator', { dir: 0, rotMode: 'ccw' }), []);
  for (const rotMode of ['up', '', 0, null] as unknown as MachineConfig['rotMode'][]) {
    assert.ok(validate('rotator', { dir: 0, rotMode }).some((e) => e.includes('режим ротатора')));
  }
});

test('последовательность источника ограничена по длине и значениям', () => {
  assert.deepEqual(validate('spawner', { dir: 0, sequence: [1, -999, 999] }), []);
  assert.ok(validate('spawner', { dir: 0, sequence: [1000] }).some((e) => e.includes('последовательность')));
  assert.ok(validate('spawner', { dir: 0, sequence: [-1000] }).some((e) => e.includes('последовательность')));
  assert.ok(validate('spawner', { dir: 0, sequence: [1.5] }).some((e) => e.includes('последовательность')));
  assert.ok(validate('spawner', { dir: 0, sequence: '1,2,3' as unknown as number[] }).some((e) => e.includes('последовательность')));

  const tooLong = Array.from({ length: MAX_SPAWN_SEQUENCE_LENGTH + 1 }, (_, i) => (i % 3) - 1);
  assert.ok(validate('spawner', { dir: 0, sequence: tooLong }).some((e) => e.includes('Слишком длинная')));
  const atLimit = tooLong.slice(0, MAX_SPAWN_SEQUENCE_LENGTH);
  assert.deepEqual(validate('spawner', { dir: 0, sequence: atLimit }), []);
});

test('интервал генерации и loopSequence проверяются по типу', () => {
  assert.deepEqual(validate('spawner', { dir: 0, sequence: [1], spawnInterval: 1 }), []);
  assert.ok(validate('spawner', { dir: 0, spawnInterval: 0 }).some((e) => e.includes('Интервал')));
  assert.ok(validate('spawner', { dir: 0, spawnInterval: 2.5 }).some((e) => e.includes('Интервал')));
  assert.deepEqual(validate('spawner', { dir: 0, loopSequence: true }), []);
  assert.ok(validate('spawner', { dir: 0, loopSequence: 'yes' as unknown as boolean }).some((e) => e.includes('loopSequence')));
});

test('sinkId и targetPattern проверяются по типу', () => {
  assert.deepEqual(validate('conveyor', { dir: 0, sinkId: 'main' }), []);
  assert.ok(validate('conveyor', { dir: 0, sinkId: '' }).some((e) => e.includes('sinkId')));
  assert.ok(validate('conveyor', { dir: 0, sinkId: 42 as unknown as string }).some((e) => e.includes('sinkId')));
  assert.ok(validate('conveyor', { dir: 0, targetPattern: 'nope' as unknown as MachineConfig['targetPattern'] }).some((e) => e.includes('Образец')));
});

test('машинные параметры проверяются до запуска на пути размещения', () => {
  const broken: Array<{ type: MachineType; coord: { q: number; r: number }; config: MachineConfig }> = [
    { type: 'divmod', coord: { q: 0, r: 0 }, config: { dir: 0, divisor: 0 } },
    { type: 'dup', coord: { q: 1, r: 0 }, config: { dir: 3, altDir: 3 } },
  ];
  const errors = validateLevelPlacement(level, broken);
  assert.ok(errors.some((e) => e.includes('Делитель')), `expected divisor error, got: ${errors.join('; ')}`);
  assert.ok(errors.some((e) => e.includes('Основной и боковой выходы совпадают')), `expected coincidence error, got: ${errors.join('; ')}`);
});

test('все фиксированные механизмы глав проходят проверку конфигурации', () => {
  for (const lvl of ALL_PUZZLE_LEVELS) {
    for (const machine of lvl.presetMachines ?? []) {
      const errors = validateMachineConfig(machine.type, machine.config, lvl);
      assert.deepEqual(
        errors,
        [],
        `preset ${machine.type} of ${lvl.id} must be a valid config, got: ${errors.join('; ')}`,
      );
    }
  }
});
