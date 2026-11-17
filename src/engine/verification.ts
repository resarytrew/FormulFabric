import type {
  SinkRequirements,
  TargetPattern,
  LevelDefinition,
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

function expectationIds(options: VerificationExpectations): Set<string> {
  return new Set([
    ...Object.keys(options.expectedSinkValues ?? {}),
    ...Object.keys(options.expectedSinkPolymers ?? {}),
  ]);
}

/**
 * Non-throwing compatibility check of one expectation bundle, suitable for
 * surfacing through the verification report. Two rules:
 *
 * 1. For the same sink, expected values and expected polymers describe the
 *    *same* deliveries, so their lengths must match.
 * 2. Every expected value must be an integer inside the engine-wide token
 *    range. When the level is provided, polymer rows are also checked against
 *    the sink pattern's node count — a row of the wrong length can never match.
 */
export function lintVerificationExpectations(
  options: VerificationExpectations,
  level?: LevelDefinition,
): string[] {
  const errors: string[] = [];
  const ids = expectationIds(options);

  for (const id of ids) {
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
      const sinkPattern = findSinkPattern(level, id);
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
 * sink requires `max`-compatible `length` deliveries — never their sum. The
 * result is the union over both kinds of expectations.
 *
 * Throws on incompatible lengths; callers that surface errors to the player
 * should use `lintVerificationExpectations` first and report instead.
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

    // Условия одной доставки не суммируются.
    result[id] = values?.length ?? polymers?.length ?? 0;
  }

  return result;
}

function findSinkPattern(
  level: LevelDefinition | undefined,
  sinkId: string,
): TargetPattern | undefined {
  if (!level) return undefined;
  for (const machine of level.presetMachines ?? []) {
    if (machine.type !== 'sink') continue;
    if (machine.config.sinkId === sinkId) {
      return machine.config.targetPattern;
    }
  }
  return undefined;
}
