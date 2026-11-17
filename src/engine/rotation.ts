import { hexArcOverlap, makeArc, PENETRATION_EPS } from './arc-geometry';
import { compareCoords } from './deterministic-order';
import { HEX_SIZE, hexDistance, hexKey, hexToWorld, rotateAroundPivot } from './hex-math';
import type { AxialCoord } from './types';

/**
 * Точная геометрия дуги поворота ротатора (PR #4D).
 *
 * Модель зафиксирована в `docs/rotation-geometry-contract.md`:
 *
 *  - сфера при проверке маршрута — точка в центре гекса;
 *  - препятствие — замкнутая область гексагональной клетки;
 *  - гекс считается пройденным, если непрерывная дуга пересекает его открытую
 *    внутренность на интервале параметра положительной длины;
 *  - касание границы (ребра или вершины) препятствием не считается.
 *
 * Алгоритм не содержит дискретизации: количество проверок не зависит от
 * выбранного числа точек, а «пропусков между выборками» не существует по
 * построению. Заменять его плотной выборкой нельзя — она остаётся только
 * вспомогательным детектором расхождений в тестах.
 */

/**
 * Гексы-кандидаты вокруг пивота.
 *
 * Грубая отбраковка: если центр гекса удалён от пивота больше чем на `R` по
 * сравнению с радиусом дуги, ни одна точка гекса не может лежать на окружности
 * радиуса `ρ` (все точки гекса — в пределах `R` от его центра), поэтому точная
 * проверка для такого гекса заведомо ложна.
 */
function candidateHexes(pivot: AxialCoord, radius: number): AxialCoord[] {
  const ring = Math.ceil((radius + HEX_SIZE) / (HEX_SIZE * Math.sqrt(3))) + 1;
  const pivotWorld = hexToWorld(pivot);
  // |d − ρ| ≤ R  ⟺  d² ∈ [(ρ − R)², (ρ + R)²]  при ρ ≥ R > 0: сравнение по
  // квадратам убирает `sqrt` из самого частого шага. Это та же отбраковка.
  const minSquared = Math.max(0, radius - HEX_SIZE) ** 2;
  const maxSquared = (radius + HEX_SIZE) ** 2;
  const out: AxialCoord[] = [];
  for (let dq = -ring; dq <= ring; dq++) {
    const rMin = Math.max(-ring, -dq - ring);
    const rMax = Math.min(ring, -dq + ring);
    for (let dr = rMin; dr <= rMax; dr++) {
      const coord = { q: pivot.q + dq, r: pivot.r + dr };
      const center = hexToWorld(coord);
      const dx = center.x - pivotWorld.x;
      const dz = center.z - pivotWorld.z;
      const squared = dx * dx + dz * dz;
      if (squared < minSquared || squared > maxSquared) continue;
      out.push(coord);
    }
  }
  return out;
}

/**
 * Гексы, внутреннюю область которых пересекает непрерывная дуга центра сферы
 * при повороте на 60° вокруг пивота.
 *
 * Порядок результата детерминирован (см. контракт): по параметру первого входа
 * дуги, при равенстве — по координате (`q`, затем `r`). Стартовый гекс, гекс
 * назначения и гекс пивота исключены: они проверяются существующими правилами
 * движка (корпус в точке назначения, наложение, сам ротатор на пивоте).
 */
export function getRotationSweptHexes(
  coord: AxialCoord,
  pivot: AxialCoord,
  cwSteps: 1 | -1,
): AxialCoord[] {
  // Радиус 1: дуга идёт по общей границе соседних гексов, промежуточных клеток нет.
  if (hexDistance(coord, pivot) <= 1) {
    return [];
  }

  const arc = makeArc(hexToWorld(pivot), hexToWorld(coord), cwSteps === 1 ? 1 : -1);
  const excluded = new Set([
    hexKey(coord),
    hexKey(rotateAroundPivot(coord, pivot, cwSteps)),
    hexKey(pivot),
  ]);

  const swept: Array<{ coord: AxialCoord; entry: number }> = [];
  for (const candidate of candidateHexes(pivot, arc.radius)) {
    if (excluded.has(hexKey(candidate))) continue;
    const overlap = hexArcOverlap(arc, hexToWorld(candidate));
    // Касание границы гекса (проникновение нулевой длины) столкновением не считается.
    if (overlap.penetration <= PENETRATION_EPS) continue;
    swept.push({ coord: candidate, entry: overlap.entry });
  }

  swept.sort((a, b) => a.entry - b.entry || compareCoords(a.coord, b.coord));
  return swept.map((item) => item.coord);
}
