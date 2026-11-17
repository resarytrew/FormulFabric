import { MAX_INT_VALUE } from './operations';
import type {
  FilterRule,
  LevelDefinition,
  MachineConfig,
  MachineType,
} from './types';

/**
 * Upper bound on a spawner input sequence. Real levels stream up to 8 values;
 * 64 keeps every shipped puzzle legal while refusing corrupted or generated
 * configs whose hundreds of thousands of entries would otherwise be replayed
 * tick by tick inside the simulation.
 */
export const MAX_SPAWN_SEQUENCE_LENGTH = 64;

const FILTER_RULES: ReadonlySet<unknown> = new Set<FilterRule>([
  'even',
  'odd',
  'positive',
  'negative',
  'gt5',
]);

const ROT_MODES: ReadonlySet<unknown> = new Set(['cw', 'ccw']);

/**
 * Игровое правило (закреплено явно, а не вводится автоматически):
 * устройства, которые создают вторую сферу или делят поток, используют
 * основной выход и боковой выход как два независимых направления.
 * Совпадение выходов для них — некорректная конфигурация: вторая сфера
 * оказалась бы на том же гексе, куда следующим тактом уходит первая.
 *
 * Разделитель ⇄ (splitter) в правило не входит: он чередует выходы, и
 * совпадение для него — легальный способ построить чередование в одну линию.
 * Транспортные механизмы altDir не используют и тоже не затрагиваются.
 */
export const TWO_OUTPUT_MACHINE_TYPES: ReadonlySet<MachineType> = new Set<MachineType>([
  'dup',
  'halver',
  'divmod',
  'scales',
  'filter',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Static validation of a machine config, run before a placement is accepted or
 * a world is built. Invalid data is rejected with an explanation — never
 * repaired silently and never allowed to reach the math core (e.g. a `divisor: 0`
 * must not reach integer division).
 *
 * `targetPattern` contents are intentionally not linted here: receiver patterns
 * are checked by `lintPattern` (see `pattern-lint.ts`) in the same placement
 * pass, with sink-specific messages and coordinates.
 */
export function validateMachineConfig(
  type: MachineType,
  config: MachineConfig,
  level: LevelDefinition,
): string[] {
  const errors: string[] = [];

  if (!isRecord(config)) {
    return ['Механизм без конфигурации'];
  }

  const validDirection = (dir: number) =>
    Number.isInteger(dir) && dir >= 0 && dir <= 5;

  if (!validDirection(config.dir)) {
    errors.push('Направление должно быть от 0 до 5');
  }

  if (
    config.altDir !== undefined &&
    !validDirection(config.altDir)
  ) {
    errors.push('Некорректное направление второго выхода');
  }

  // Игровое правило «не совпадают выходы» применяется только к устройствам
  // с двумя выходами (см. TWO_OUTPUT_MACHINE_TYPES).
  if (
    TWO_OUTPUT_MACHINE_TYPES.has(type) &&
    config.altDir !== undefined &&
    validDirection(config.dir) &&
    config.altDir === config.dir
  ) {
    errors.push('Основной и боковой выходы совпадают');
  }

  if (
    config.rotMode !== undefined &&
    !ROT_MODES.has(config.rotMode)
  ) {
    errors.push('Некорректный режим ротатора (ожидается cw или ccw)');
  }

  if (
    config.filterRule !== undefined &&
    !FILTER_RULES.has(config.filterRule)
  ) {
    errors.push('Некорректное правило фильтра (ожидается even, odd, positive, negative или gt5)');
  }

  if (
    config.loopSequence !== undefined &&
    typeof config.loopSequence !== 'boolean'
  ) {
    errors.push('loopSequence должен быть логическим значением');
  }

  if (
    config.sinkId !== undefined &&
    (typeof config.sinkId !== 'string' || config.sinkId.trim().length === 0)
  ) {
    errors.push('sinkId должен быть непустой строкой');
  }

  if (config.targetPattern !== undefined && !isRecord(config.targetPattern)) {
    errors.push('Образец приёмника должен быть объектом');
  }

  // Любой заданный делитель обязан быть валидным, где бы он ни встретился:
  // мусорное поле отклоняется, а не игнорируется молча.
  if (
    config.divisor !== undefined &&
    (!Number.isInteger(config.divisor) || config.divisor < 1 || config.divisor > 999)
  ) {
    errors.push('Делитель должен быть целым от 1 до 999');
  }

  if (type === 'divmod') {
    const divisor =
      level.fixedDivisor ?? config.divisor ?? 2;
    const rawAlreadyReported =
      config.divisor !== undefined &&
      (!Number.isInteger(config.divisor) || config.divisor < 1 || config.divisor > 999);

    if (
      !rawAlreadyReported &&
      (!Number.isInteger(divisor) ||
        divisor < 1 ||
        divisor > 999)
    ) {
      errors.push('Делитель должен быть целым от 1 до 999');
    }
  }

  const sequence = config.sequence;
  if (sequence !== undefined) {
    if (
      !Array.isArray(sequence) ||
      sequence.some(
        value =>
          !Number.isInteger(value) ||
          Math.abs(value) > MAX_INT_VALUE
      )
    ) {
      errors.push('Некорректная числовая последовательность');
    } else if (sequence.length > MAX_SPAWN_SEQUENCE_LENGTH) {
      errors.push(`Слишком длинная входная последовательность: ${sequence.length} > ${MAX_SPAWN_SEQUENCE_LENGTH}`);
    }
  }

  if (
    config.spawnInterval !== undefined &&
    (!Number.isInteger(config.spawnInterval) ||
      config.spawnInterval < 1)
  ) {
    errors.push('Интервал генерации должен быть положительным');
  }

  return errors;
}
