/**
 * Детерминированный выбор намерения движения (PR #4B).
 *
 * У одной сферы (точнее, у одного связного компонента) может оказаться несколько
 * намерений с одинаковым высшим приоритетом. Раньше побеждало то, которое раньше
 * попало в массив, то есть механизм, раньше лежащий в `world.machines`. Координаты
 * сфер от этого не менялись, но вспышка механизма, `moveSource`, `pushChainIndex`
 * и анимационные события зависели от порядка `Map`.
 *
 * Новое правило сравнения:
 *
 *  1. `tier`: Tier 2 (актуаторы) важнее Tier 1 (пассивные ленты).
 *  2. `pushChainIndex`: меньшее значение важнее — это существующая механика
 *     цепочки толкателя (сфера, которую двигают напрямую, важнее сферы,
 *     которую двигают как часть цепочки).
 *  3. Координата источника: меньший `q`, затем меньший `r` — чистая геометрия
 *     конфигурации, не зависящая от хранения.
 *  4. Тип механизма-источника, затем вид намерения, направление, подпись
 *     (включая пивот поворота) — полный порядок на случай, если первые критерии
 *     совпали.
 *
 * Разные подписи на высшем приоритете по-прежнему считаются конфликтом тяги:
 * это правило проверяется в `resolveMovement` до вызова компаратора.
 * Расчёт целевых координат не меняется: компаратор выбирает только источник.
 */
import { compareCoords } from './deterministic-order';
import type { ComponentIntent } from './movement-types';
import type { AxialCoord } from './types';

const ZERO: AxialCoord = { q: 0, r: 0 };

function chainIndexOf(intent: ComponentIntent): number {
  return intent.kind === 'move' ? (intent.pushChainIndex ?? 0) : 0;
}

function dirOf(intent: ComponentIntent): number {
  return intent.kind === 'move' || intent.kind === 'jump' ? intent.dir : 0;
}

function pivotOf(intent: ComponentIntent): AxialCoord {
  return 'pivot' in intent ? intent.pivot : ZERO;
}

function stepsOf(intent: ComponentIntent): number {
  return intent.kind === 'rotate' ? intent.cwSteps : 0;
}

/** Полный порядок намерений: отрицательный результат — `a` предпочтительнее `b`. */
export function compareIntents(a: ComponentIntent, b: ComponentIntent): number {
  if (a.tier !== b.tier) return b.tier - a.tier;
  const byChain = chainIndexOf(a) - chainIndexOf(b);
  if (byChain !== 0) return byChain;

  const bySource = compareCoords(a.sourceCoord, b.sourceCoord);
  if (bySource !== 0) return bySource;

  if (a.sourceMachineType !== b.sourceMachineType) {
    return a.sourceMachineType < b.sourceMachineType ? -1 : 1;
  }
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;

  const byDir = dirOf(a) - dirOf(b);
  if (byDir !== 0) return byDir;
  if (a.signature !== b.signature) return a.signature < b.signature ? -1 : 1;

  const byPivot = compareCoords(pivotOf(a), pivotOf(b));
  if (byPivot !== 0) return byPivot;
  return stepsOf(a) - stepsOf(b);
}

/** Намерение-победитель среди равнозначных кандидатов (порядок массива не важен). */
export function pickBestIntent(intents: ComponentIntent[]): ComponentIntent {
  let best = intents[0];
  for (const candidate of intents) {
    if (compareIntents(candidate, best) < 0) best = candidate;
  }
  return best;
}
