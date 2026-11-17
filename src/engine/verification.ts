import type {
  SinkRequirements,
  TargetPattern,
  LevelDefinition,
  MachineConfig,
  MachineType,
} from './types';
import { MIN_INT_VALUE, MAX_INT_VALUE } from './operations';

/**
 * Expected scalar/polymer deliveries for a verification stream, exactly as
 * declared in `LevelDefinition.verificationRuns`.
 */
export interface VerificationExpectations {
  expectedSinkValues?: Record<string, number[]>;
  expectedSinkPolymers?: Record<string, number[][]>;
}

/** The shape of anything that can carry a sink id: presets and placed blocks. */
type SinkCarrier = {
  type: MachineType | string;
  config?: MachineConfig | null;
};

interface SinkRef {
  id: string;
  pattern?: TargetPattern;
}

function expectationIds(options: VerificationExpectations): Set<string> {
  return new Set([
    ...Object.keys(options.expectedSinkValues ?? {}),
    ...Object.keys(options.expectedSinkPolymers ?? {}),
  ]);
}

function collectSinks(
  level?: LevelDefinition,
  blocks?: SinkCarrier[],
): SinkRef[] | null {
  if (!level && !blocks) return null;
  const sinks: SinkRef[] = [];
  const collect = (machine: SinkCarrier | undefined | null) => {
    if (machine?.type !== 'sink') return;
    const config = machine.config;
    if (!config || typeof config !== 'object') return;
    const id = config.sinkId;
    if (typeof id !== 'string' || id.trim().length === 0) return;
    sinks.push({ id, pattern: config.targetPattern });
  };
  for (const machine of level?.presetMachines ?? []) collect(machine);
  for (const block of blocks ?? []) collect(block);
  return sinks;
}

/**
 * Non-throwing compatibility check of one expectation bundle, suitable for
 * surfacing through the verification report. Rules:
 *
 * 1. Sink ids mentioned anywhere must exist (level presets or placed blocks),
 *    and every sink id on the level may be used only once — two sinks sharing
 *    an id would mix their delivery histories under one key.
 * 2. For the same sink, expected values and expected polymers describe the
 *    *same* deliveries: lengths must match, and for a single-node sink the
 *    scalars must equal the polymer's only cell. For a multi-sphere sink the
 *    combination is forbidden entirely — the scalar expectation would never be
 *    checked, so its meaning is undefined.
 * 3. A scalar `expectedSinkValues` alone is equally unchecked for a
 *    multi-node sink (matcher only compares scalars for single-token
 *    deliveries), so it is rejected too.
 * 4. Every expected value must be an integer inside the engine-wide token
 *    range; polymer rows must match the sink pattern's node count when known.
 */
export function lintVerificationExpectations(
  options: VerificationExpectations,
  level?: LevelDefinition,
  blocks?: SinkCarrier[],
): string[] {
  const errors: string[] = [];
  const ids = expectationIds(options);
  const sinks = collectSinks(level, blocks);

  if (sinks) {
    const counts = new Map<string, number>();
    for (const sink of sinks) counts.set(sink.id, (counts.get(sink.id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count > 1) {
        errors.push(`Приёмник ${id}: идентификатор используется ${count} приёмниками — истории доставок будут смешаны`);
      }
    }
  }

  for (const id of ids) {
    const sink = sinks?.find((s) => s.id === id);
    if (sinks && !sink) {
      errors.push(`Приёмник ${id}: приёмник с таким идентификатором отсутствует на уровне`);
    }
    const sinkPattern = sink?.pattern;

    const values = options.expectedSinkValues?.[id];
    const polymers = options.expectedSinkPolymers?.[id];

    if (values !== undefined && !Array.isArray(values)) {
      errors.push(`Приёмник ${id}: expectedSinkValues должен быть массивом`);
    } else {
      values?.forEach((value, index) => {
        if (!Number.isInteger(value)) {
          errors.push(`Приёмник ${id}: ожидаемое значение ${index + 1} должно быть целым числом`);
        } else if (value < MIN_INT_VALUE || value > MAX_INT_VALUE) {
          errors.push(`Приёмник ${id}: ожидаемое значение ${index + 1} = ${value} вне диапазона [${MIN_INT_VALUE}, ${MAX_INT_VALUE}]`);
        }
      });
    }

    if (polymers !== undefined && !Array.isArray(polymers)) {
      errors.push(`Приёмник ${id}: expectedSinkPolymers должен быть массивом`);
    } else {
      polymers?.forEach((row, index) => {
        if (!Array.isArray(row) || row.length === 0) {
          errors.push(`Приёмник ${id}: ожидаемый полимер ${index + 1} пуст или повреждён`);
          return;
        }
        if (sinkPattern && row.length !== sinkPattern.nodes.length) {
          errors.push(`Приёмник ${id}: ожидаемый полимер ${index + 1} описывает ${row.length} звеньев вместо ${sinkPattern.nodes.length}`);
        }
        row.forEach((value, nodeIdx) => {
          if (!Number.isInteger(value)) {
            errors.push(`Приёмник ${id}: ожидаемый полимер ${index + 1}, звено ${nodeIdx + 1} должно быть целым числом`);
          } else if (value < MIN_INT_VALUE || value > MAX_INT_VALUE) {
            errors.push(`Приёмник ${id}: ожидаемый полимер ${index + 1}, звено ${nodeIdx + 1} = ${value} вне диапазона [${MIN_INT_VALUE}, ${MAX_INT_VALUE}]`);
          }
        });
      });
    }

    // P0: совместное применение скаляров и полимеров.
    if (Array.isArray(values) && Array.isArray(polymers)) {
      const maxRow = polymers.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
      const nodeCount = sinkPattern?.nodes?.length ?? maxRow;
      if (nodeCount > 1) {
        errors.push(`Приёмник ${id}: для многосферной доставки нельзя задавать одновременно expectedSinkValues и expectedSinkPolymers — совместный смысл не определён`);
      } else if (values.length === polymers.length) {
        for (let index = 0; index < values.length; index++) {
          const row = polymers[index];
          if (
            Array.isArray(row) &&
            row.length === 1 &&
            Number.isInteger(values[index]) &&
            Number.isInteger(row[0]) &&
            values[index] !== row[0]
          ) {
            errors.push(`Приёмник ${id}: ожидаемое значение ${index + 1} = ${values[index]} не совпадает со звеном полимера ${row[0]}`);
          }
        }
      }
    } else if (
      Array.isArray(values) &&
      sinkPattern &&
      Array.isArray(sinkPattern.nodes) &&
      sinkPattern.nodes.length > 1
    ) {
      // Многосферная доставка: матчер не сверяет скаляр — ожидаемое значение
      // было бы непроверяемым.
      errors.push(`Приёмник ${id}: для многозвенного приёмника expectedSinkValues не проверяются — используйте expectedSinkPolymers`);
    }

    if (
      values &&
      polymers &&
      values.length !== polymers.length
    ) {
      errors.push(
        `Приёмник ${id}: несовместимые длины ожиданий (значений: ${values.length}, полимеров: ${polymers.length})`,
      );
    }
  }

  return errors;
}

/**
 * Computes how many deliveries each sink must receive.
 *
 * Values and polymers with the same index describe the SAME delivery, so one
 * sink requires `length` deliveries — never their sum. The result is the union
 * over both kinds of expectations.
 *
 * Throws on incompatible expectations (length mismatch, forbidden combined
 * scalar/polymer specs for multi-sphere sinks, inconsistent single-node
 * pairs); callers that surface errors to the player should use
 * `lintVerificationExpectations` first and report instead. Multi-node
 * detection without a level is data-driven (max polymer row length).
 */
export function getRequiredBySink(
  options: VerificationExpectations,
): Record<string, number> {
  const result: Record<string, number> = {};

  const ids = expectationIds(options);

  for (const id of ids) {
    const values = options.expectedSinkValues?.[id];
    const polymers = options.expectedSinkPolymers?.[id];

    if (
      values &&
      polymers &&
      values.length !== polymers.length
    ) {
      throw new Error(
        `Приёмник ${id}: несовместимые длины ожиданий`,
      );
    }

    if (values && polymers && Array.isArray(polymers)) {
      const maxRow = polymers.reduce(
        (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
        0,
      );
      if (maxRow > 1) {
        throw new Error(
          `Приёмник ${id}: для многосферной доставки нельзя задавать одновременно expectedSinkValues и expectedSinkPolymers`,
        );
      }
      if (Array.isArray(values) && values.length === polymers.length) {
        for (let index = 0; index < values.length; index++) {
          const row = polymers[index];
          if (
            Array.isArray(row) &&
            row.length === 1 &&
            Number.isInteger(values[index]) &&
            Number.isInteger(row[0]) &&
            values[index] !== row[0]
          ) {
            throw new Error(
              `Приёмник ${id}: ожидаемое значение ${index + 1} = ${values[index]} не совпадает со звеном полимера ${row[0]}`,
            );
          }
        }
      }
    }

    // Условия одной доставки не суммируются.
    result[id] = values?.length ?? polymers?.length ?? 0;
  }

  return result;
}
