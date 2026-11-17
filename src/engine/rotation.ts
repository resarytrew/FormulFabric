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

/** Половина углового шага поворота ротатора: 60°. */
const ARC_SPAN = Math.PI / 3;

/** Апофема гекса — расстояние от центра до середины ребра. */
const HEX_INRADIUS = (HEX_SIZE * Math.sqrt(3)) / 2;

/**
 * Порог проникновения в радианах параметра дуги.
 *
 * Погрешность двойной точности в `acos`/`hypot` — порядка 1e-15 рад, а любое
 * реальное проникновение в игре — десятые доли радиана. Порог 1e-7 рад отделяет
 * касание границы (не столкновение) от настоящего пересечения внутренности.
 */
const PENETRATION_EPS = 1e-7;

/** Ширина диапазона перебора периодов для угловых интервалов. */
const PERIOD_RANGE = 3;

/** Описание дуги в мировых координатах. */
interface Arc {
  /** Пивот (центр вращения). */
  cx: number;
  cz: number;
  /** Вектор от пивота к начальному центру сферы. */
  dx: number;
  dz: number;
  /** Радиус дуги. */
  radius: number;
  /** Направление поворота: +1 — cwSteps = 1, −1 — cwSteps = −1. */
  sigma: 1 | -1;
  /** Длина дуги в радианах (всегда ARC_SPAN, хранится для единообразия). */
  span: number;
  /** Угол начального вектора: `atan2(dz, dx)`. */
  beta: number;
}

type Interval = [number, number];

/**
 * Интервалы параметра дуги, где точка дуги лежит внутри замкнутого гекса с
 * центром `center`.
 *
 * Гекс задаётся шестью полуплоскостями `n_i·x ≤ b_i` (нормали под `0° + 60°k`,
 * `b_i = n_i·C + r_h`). Для точки дуги `x(t)` каждое неравенство превращается в
 * `cos(σθ + β − φ_i) ≤ c_i`, то есть в один угловой интервал на окружности;
 * пересечение шести интервалов с диапазоном дуги даёт точный ответ.
 */
function intervalsInsideHex(arc: Arc, center: { x: number; z: number }): Interval[] {
  if (!(arc.radius > 0)) return [];
  let allowed: Interval[] = [[0, arc.span]];
  for (let edge = 0; edge < 6; edge++) {
    const phi = (Math.PI / 3) * edge;
    const nx = Math.cos(phi);
    const nz = Math.sin(phi);
    // Расстояние от центра гекса до ребра с нормалью (nx, nz) — апофема.
    // Углы нормалей через 60° покрывают все шесть рёбер независимо от того,
    // какая из двух нормалей ребра выбрана, поэтому апофема одна и та же.
    const b = nx * center.x + nz * center.z + HEX_INRADIUS;
    const c = (b - (nx * arc.cx + nz * arc.cz)) / arc.radius;
    allowed = intersectIntervals(allowed, constraintIntervals(arc, phi, c));
    if (allowed.length === 0) return [];
  }
  return allowed;
}

/**
 * Интервалы параметра `t ∈ [0, span]`, на которых выполнено ограничение
 * `cos(σt + β − φ) ≤ c` (полуплоскость одного ребра гекса).
 */
function constraintIntervals(arc: Arc, phi: number, c: number): Interval[] {
  if (c >= 1) return [[0, arc.span]];
  if (c <= -1) return [];
  const alpha = Math.acos(c);
  // Допустимые ψ = σt + β − φ: [α + 2πk, 2π − α + 2πk].
  const base = phi - arc.beta;
  const psiLo = base + alpha;
  const psiHi = base + 2 * Math.PI - alpha;
  // t = σ·(ψ − β + φ): при σ = +1 порядок сохраняется, при σ = −1 меняется.
  const tLo = arc.sigma === 1 ? psiLo : -psiHi;
  const tHi = arc.sigma === 1 ? psiHi : -psiLo;
  const out: Interval[] = [];
  for (let k = -PERIOD_RANGE; k <= PERIOD_RANGE; k++) {
    const lo = Math.max(tLo + 2 * Math.PI * k, 0);
    const hi = Math.min(tHi + 2 * Math.PI * k, arc.span);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/** Пересечение двух наборов интервалов (наборы отсортированы и не пересекаются). */
function intersectIntervals(left: Interval[], right: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const lo = Math.max(left[i][0], right[j][0]);
    const hi = Math.min(left[i][1], right[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (left[i][1] < right[j][1]) i += 1;
    else j += 1;
  }
  return out;
}

/**
 * Минимальное расстояние между центрами гексов, разнесённых на `n` шагов по
 * координате, в долях `HEX_SIZE` — это `1.5` (упирается в гексы вида `(0, n)`).
 * Оценка через `√3·HEX_SIZE` (расстояние по `q`) занижает радиус поиска: на
 * больших дугах гекс, лежащий на окружности, оказывается за пределами кольца
 * (`(-16,0)` → гекс `(-9,-10)`: `ring` был 18 при расстоянии 19).
 */
const WORLD_STEP_PER_HEX = 1.5 * HEX_SIZE;

/**
 * Гексы-кандидаты: те, чей центр удалён от радиуса дуги не дальше чем на
 * `HEX_SIZE` (описанную окружность гекса). Если `|d − ρ| > R`, ни одна точка
 * гекса не может лежать на окружности радиуса `ρ` (все точки гекса — в пределах
 * `R` от центра). Кольцо считается по консервативной оценке расстояния, поэтому
 * поиск — надмножество всех гексов, которые дуга может задеть.
 */
function candidateHexes(arc: Arc, pivot: AxialCoord): AxialCoord[] {
  const ring = Math.ceil((arc.radius + HEX_SIZE) / WORLD_STEP_PER_HEX) + 1;
  const out: AxialCoord[] = [];
  for (let dq = -ring; dq <= ring; dq++) {
    const rMin = Math.max(-ring, -dq - ring);
    const rMax = Math.min(ring, -dq + ring);
    for (let dr = rMin; dr <= rMax; dr++) {
      const coord = { q: pivot.q + dq, r: pivot.r + dr };
      const center = hexToWorld(coord);
      const distance = Math.hypot(center.x - arc.cx, center.z - arc.cz);
      if (Math.abs(distance - arc.radius) > HEX_SIZE) continue;
      out.push(coord);
    }
  }
  return out;
}

function arcOf(coord: AxialCoord, pivot: AxialCoord, cwSteps: 1 | -1): Arc {
  const pW = hexToWorld(pivot);
  const sW = hexToWorld(coord);
  const dx = sW.x - pW.x;
  const dz = sW.z - pW.z;
  return {
    cx: pW.x,
    cz: pW.z,
    dx,
    dz,
    radius: Math.hypot(dx, dz),
    sigma: cwSteps === 1 ? 1 : -1,
    span: ARC_SPAN,
    beta: Math.atan2(dz, dx),
  };
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
  const arc = arcOf(coord, pivot, cwSteps);
  const excluded = new Set([
    hexKey(coord),
    hexKey(rotateAroundPivot(coord, pivot, cwSteps)),
    hexKey(pivot),
  ]);
  const swept: Array<{ coord: AxialCoord; entry: number }> = [];
  for (const candidate of candidateHexes(arc, pivot)) {
    if (excluded.has(hexKey(candidate))) continue;
    const intervals = intervalsInsideHex(arc, hexToWorld(candidate));
    if (intervals.length === 0) continue;
    const penetration = intervals.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
    // Касание границы гекса (проникновение нулевой длины) столкновением не считается.
    if (penetration <= PENETRATION_EPS) continue;
    swept.push({ coord: candidate, entry: intervals[0][0] });
  }
  swept.sort((a, b) => a.entry - b.entry || compareCoords(a.coord, b.coord));
  return swept.map((item) => item.coord);
}
