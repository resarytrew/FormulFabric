import { HEX_SIZE } from './hex-math';

/**
 * Чистая геометрия дуги поворота (PR #4D).
 *
 * Модуль не знает про осевые координаты и `SimulationWorld`: на вход подаются
 * мировые точки, на выходе — интервалы параметра, на которых дуга находится
 * внутри гекса. Это позволяет:
 *
 *  - использовать точный алгоритм в `rotation.ts` без дискретизации;
 *  - проверять пограничные случаи (касание ребра и вершины) синтетической
 *    геометрией, а не только гексами решётки.
 *
 * Модель зафиксирована в `docs/rotation-geometry-contract.md`:
 * сфера — точка в центре гекса, препятствие — замкнутая область гекса,
 * столкновение — пересечение дуги с **открытой внутренностью** гекса на
 * интервале параметра положительной длины. Касание границы не считается.
 */

/** Половина углового шага поворота ротатора: 60°. */
export const ARC_SPAN = Math.PI / 3;

/** Апофема гекса — расстояние от центра до середины ребра. */
export const HEX_INRADIUS = (HEX_SIZE * Math.sqrt(3)) / 2;

/**
 * Порог проникновения в радианах параметра дуги.
 *
 * Погрешность двойной точности в `acos`/`hypot` — порядка 1e-15 рад, а любое
 * реальное проникновение в игре — десятые доли радиана. Порог 1e-7 рад отделяет
 * касание границы (не столкновение) от настоящего пересечения внутренности.
 */
export const PENETRATION_EPS = 1e-7;

export interface Point2 {
  x: number;
  z: number;
}

/** Дуга поворота: точка `P + R(θ)(dx, dz)`, θ = σ·t, t ∈ [0, span]. */
export interface ArcGeometry {
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
  /** Длина дуги в радианах. */
  span: number;
  /** Угол начального вектора: `atan2(dz, dx)`. */
  beta: number;
}

export type Interval = [number, number];

/** Дуга поворота на 60° из точки `start` вокруг точки `pivot`. */
export function makeArc(pivot: Point2, start: Point2, sigma: 1 | -1): ArcGeometry {
  const dx = start.x - pivot.x;
  const dz = start.z - pivot.z;
  return {
    cx: pivot.x,
    cz: pivot.z,
    dx,
    dz,
    radius: Math.hypot(dx, dz),
    sigma,
    span: ARC_SPAN,
    beta: Math.atan2(dz, dx),
  };
}

/** Точка дуги в параметре `t`. */
export function arcPoint(arc: ArcGeometry, t: number): Point2 {
  const theta = arc.sigma * t;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: arc.cx + arc.dx * cos - arc.dz * sin,
    z: arc.cz + arc.dx * sin + arc.dz * cos,
  };
}

/**
 * Интервалы параметра дуги, где точка лежит внутри **замкнутого** гекса с
 * центром `center`.
 *
 * Гекс — пересечение шести полуплоскостей `n_i·x ≤ b_i`, где нормали направлены
 * под углами `0° + 60°k`, а `b_i = n_i·C + r_h`. Для точки дуги `x(t)` каждое
 * неравенство превращается в `cos(σt + β − φ_i) ≤ c_i` — один угловой интервал
 * на окружности; пересечение шести интервалов с диапазоном дуги даёт точный
 * набор интервалов, без какой-либо дискретизации.
 */
export function intervalsInsideHex(arc: ArcGeometry, center: Point2): Interval[] {
  let allowed: Interval[] = [[0, arc.span]];
  for (let edge = 0; edge < 6; edge++) {
    const phi = (Math.PI / 3) * edge;
    const nx = Math.cos(phi);
    const nz = Math.sin(phi);
    const b = nx * center.x + nz * center.z + HEX_INRADIUS;
    const c = (b - (nx * arc.cx + nz * arc.cz)) / arc.radius;
    allowed = intersectIntervals(allowed, constraintIntervals(arc, phi, c));
    if (allowed.length === 0) return [];
  }
  return allowed;
}

/**
 * Интервалы параметра `t ∈ [0, span]`, на которых выполнено ограничение
 * `cos(σt + β − φ) ≤ c` (одна полуплоскость ребра гекса).
 */
function constraintIntervals(arc: ArcGeometry, phi: number, c: number): Interval[] {
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
  for (let k = -2; k <= 2; k++) {
    const lo = Math.max(tLo + 2 * Math.PI * k, 0);
    const hi = Math.min(tHi + 2 * Math.PI * k, arc.span);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/** Пересечение двух наборов непересекающихся отсортированных интервалов. */
export function intersectIntervals(left: Interval[], right: Interval[]): Interval[] {
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
 * Результат проверки одного гекса:
 *  - `penetration` — суммарная длина интервалов внутри гекса (радианы);
 *  - `entry` — параметр первого входа дуги в гекс.
 */
export interface HexArcOverlap {
  penetration: number;
  entry: number;
}

export function hexArcOverlap(arc: ArcGeometry, center: Point2): HexArcOverlap {
  const intervals = intervalsInsideHex(arc, center);
  if (intervals.length === 0) return { penetration: 0, entry: Number.POSITIVE_INFINITY };
  const penetration = intervals.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
  return { penetration, entry: intervals[0][0] };
}

/** Дуга проходит через внутренность гекса (касание границы не считается). */
export function arcPassesThroughHex(arc: ArcGeometry, center: Point2): boolean {
  return hexArcOverlap(arc, center).penetration > PENETRATION_EPS;
}
