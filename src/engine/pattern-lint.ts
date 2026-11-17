import { hexKey } from './hex-math';
import { MIN_INT_VALUE, MAX_INT_VALUE } from './operations';
import type {
  AxialCoord,
  HexKey,
  TargetPattern,
} from './types';

/**
 * Structural and mathematical linter for receiver target patterns.
 *
 * The linter is stricter than the type on purpose: patterns arrive from
 * persisted saves and level data, so a missing `edges` array, an unknown `mode`
 * or a malformed `growth_ladder` step must be a reported error rather than a
 * runtime TypeError inside the world builder.
 *
 * What the linter guarantees (and what it deliberately does not):
 *
 * - **Индексы.** Every edge references two distinct existing nodes, and no edge
 *   is declared twice.
 * - **Числа.** Node values, expected scalars and expected polymer rows must be
 *   integers inside the engine-wide token range [MIN_INT_VALUE, MAX_INT_VALUE],
 *   because outside it no legal token can exist and the receiver would be
 *   unusable. `sum_shape` additionally requires an integer `requiredSum` that
 *   is achievable from `nodes.length` bounded values.
 * - **Связность.** A polymer is delivered as one bonded component, so any
 *   multi-node pattern whose edge graph is disconnected can never match —
 *   that is reported. Single-node patterns need no edges at all.
 * - **Замкнутость не запрещается повсеместно.** An *open* graph is legal for
 *   modes that model chains (`growth_ladder`, the open `sum_shape` dumbbell in
 *   «Окольный делитель»), so «незамкнутый» is not an error by itself. The
 *   closed-triangle condition of «Шестерёнка с суммой 12» is enforced by the
 *   matcher, which requires *every* declared edge to be present in the
 *   delivered component — the linter's job there is to guarantee the declared
 *   closed graph is satisfiable (connected, in-range values), not to demand
 *   closure for other modes.
 * - **Данные каждого режима.** `sum_shape` needs an integer achievable
 *   `requiredSum`; `growth_ladder` needs a well-formed ordered step (integer
 *   `add` step, non-zero `mul` step); `beam_balance` needs exactly three
 *   vertices (hub plus two arms).
 */
export function lintPattern(pattern: TargetPattern): string[] {
  const errors: string[] = [];
  if (!isRecord(pattern)) {
    return ['образец приёмника отсутствует или повреждён'];
  }
  if (!Array.isArray(pattern.nodes) || pattern.nodes.length === 0) {
    return ['образец приёмника не содержит ни одной вершины'];
  }
  // Both arrays are dereferenced when the world is built, so a missing one is a
  // hard error here rather than a TypeError later.
  if (!Array.isArray(pattern.edges)) {
    errors.push('образец приёмника не содержит списка связей (edges)');
  }
  if (!TARGET_MODES.has(pattern.mode)) {
    errors.push(`неизвестный режим проверки приёмника: ${String(pattern.mode)}`);
  }
  if (typeof pattern.rotationInvariant !== 'boolean') {
    errors.push('образец приёмника не задаёт признак rotationInvariant');
  }
  if (typeof pattern.label !== 'string') {
    errors.push('образец приёмника не содержит подписи (label)');
  }

  const valueInRange = (v: number) => v >= MIN_INT_VALUE && v <= MAX_INT_VALUE;

  const declaredOffsets = new Set<HexKey>();
  pattern.nodes.forEach((node, idx) => {
    if (!isRecord(node) || !isValidCoord(node.offset)) {
      errors.push(`вершина ${idx + 1} образца имеет неверные координаты`);
      return;
    }
    const declaredKey = hexKey(node.offset);
    if (declaredOffsets.has(declaredKey)) {
      errors.push(`вершина ${idx + 1} образца повторяет координаты (${declaredKey})`);
    }
    declaredOffsets.add(declaredKey);
    if (node.value !== undefined) {
      if (!Number.isInteger(node.value)) {
        errors.push(`вершина ${idx + 1} образца имеет нецелое значение ${String(node.value)}`);
      } else if (!valueInRange(node.value)) {
        errors.push(`вершина ${idx + 1} образца имеет значение ${node.value} вне диапазона [${MIN_INT_VALUE}, ${MAX_INT_VALUE}]`);
      }
    }
  });

  const edges = Array.isArray(pattern.edges) ? pattern.edges : [];
  const pairs = new Set<HexKey>();
  const validPairs: Array<[number, number]> = [];
  edges.forEach((edge, idx) => {
    const fromIdx = edge?.fromIdx;
    const toIdx = edge?.toIdx;
    if (
      !Number.isInteger(fromIdx) ||
      !Number.isInteger(toIdx) ||
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= pattern.nodes.length ||
      toIdx >= pattern.nodes.length
    ) {
      errors.push(`связь ${idx + 1} образца ссылается на несуществующую вершину`);
      return;
    }
    if (fromIdx === toIdx) {
      errors.push(`связь ${idx + 1} образца соединяет вершину саму с собой`);
      return;
    }
    const pairKey = `${Math.min(fromIdx, toIdx)}-${Math.max(fromIdx, toIdx)}`;
    if (pairs.has(pairKey)) {
      errors.push(`связь ${idx + 1} образца дублирует уже объявленную связь`);
    }
    pairs.add(pairKey);
    validPairs.push([fromIdx, toIdx]);
  });

  // Полимер доставляется как одна сваренная компонента: многоузловой образец
  // с несвязным графом связей не удовлетворим ни одной компонентой. Одноузловые
  // образцы связность не требуют (одиночной сфере связь не нужна).
  if (pattern.nodes.length > 1 && Array.isArray(pattern.edges)) {
    const adjacent: number[][] = pattern.nodes.map(() => []);
    for (const [a, b] of validPairs) {
      adjacent[a].push(b);
      adjacent[b].push(a);
    }
    const reached = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of adjacent[current]) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    if (reached.size !== pattern.nodes.length) {
      const missing = pattern.nodes
        .map((_, idx) => idx + 1)
        .filter((idx) => !reached.has(idx - 1));
      errors.push(`образец приёмника не является связным: вершины ${missing.join(', ')} не соединены с остальными`);
    }
  }

  if (pattern.expectedValues !== undefined) {
    if (!Array.isArray(pattern.expectedValues)) {
      errors.push('ожидаемые значения приёмника (expectedValues) должны быть массивом');
    } else {
      pattern.expectedValues.forEach((v, idx) => {
        if (!Number.isInteger(v)) {
          errors.push(`ожидаемое значение ${idx + 1} (expectedValues) должно быть целым числом`);
        } else if (!valueInRange(v)) {
          errors.push(`ожидаемое значение ${idx + 1} (expectedValues) = ${v} вне диапазона [${MIN_INT_VALUE}, ${MAX_INT_VALUE}]`);
        }
      });
    }
  }
  // Expected node rows are matched per delivery against `pattern.nodes`; a row
  // of the wrong length can never match and would make the receiver unusable.
  if (pattern.expectedNodeValues !== undefined) {
    if (!Array.isArray(pattern.expectedNodeValues)) {
      errors.push('ожидаемые полимеры приёмника (expectedNodeValues) должны быть массивом');
    } else {
      pattern.expectedNodeValues.forEach((row, idx) => {
        if (
          !Array.isArray(row) ||
          row.length !== pattern.nodes.length ||
          row.some((v) => !Number.isInteger(v))
        ) {
          errors.push(
            `ожидаемый полимер ${idx + 1} образца описывает ${Array.isArray(row) ? row.length : 0} звеньев вместо ${pattern.nodes.length}`,
          );
          return;
        }
        row.forEach((v, nodeIdx) => {
          if (!valueInRange(v)) {
            errors.push(`ожидаемый полимер ${idx + 1} образца: звено ${nodeIdx + 1} = ${v} вне диапазона [${MIN_INT_VALUE}, ${MAX_INT_VALUE}]`);
          }
        });
      });
    }
  }

  if (pattern.mode === 'sum_shape') {
    if (pattern.requiredSum === undefined) {
      errors.push('образец режима «сохрани форму» не задаёт требуемую сумму');
    } else if (!Number.isInteger(pattern.requiredSum)) {
      errors.push('Сумма должна быть целым числом');
    } else if (Math.abs(pattern.requiredSum) > pattern.nodes.length * MAX_INT_VALUE) {
      errors.push(`Требуемая сумма ${pattern.requiredSum} недостижима при ${pattern.nodes.length} вершинах (|Σ| ≤ ${pattern.nodes.length * MAX_INT_VALUE})`);
    }
  }
  if (pattern.mode === 'beam_balance' && pattern.nodes.length !== 3) {
    errors.push('Для модели весов нужны три вершины');
  }
  if (pattern.mode === 'growth_ladder') {
    const step = pattern.ladderStep;
    if (!isRecord(step) || (step.op !== 'add' && step.op !== 'mul') || !Number.isFinite(step.value as number) || (step.op === 'mul' && (step.value as number) === 0)) {
      errors.push('образец режима «лестница» не задаёт корректный шаг роста (op: add|mul, value ≠ 0 для mul)');
    } else if (step.op === 'add' && !Number.isInteger(step.value as number)) {
      // Токены целочисленные: дробный шаг сложения недостижим для целого результата.
      errors.push('шаг роста по сложению должен быть целым числом');
    }
  }

  return errors;
}

const TARGET_MODES: ReadonlySet<unknown> = new Set<TargetPattern['mode']>([
  'exact',
  'sum_shape',
  'beam_balance',
  'growth_ladder',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidCoord(coord: unknown): coord is AxialCoord {
  if (!isRecord(coord)) return false;
  return Number.isInteger(coord.q) && Number.isInteger(coord.r);
}
