import type { FilterRule } from './types';

export const MIN_INT_VALUE = -999;
export const MAX_INT_VALUE = 999;

export function evaluateFilterRule(value: number, rule: FilterRule = 'even'): boolean {
  switch (rule) {
    case 'even':
      return Math.abs(value % 2) === 0;
    case 'odd':
      return Math.abs(value % 2) === 1;
    case 'positive':
      return value > 0;
    case 'negative':
      return value < 0;
    case 'gt5':
      return value > 5;
  }
}

export function isInRange(
  value: number,
  minValue = MIN_INT_VALUE,
  maxValue = MAX_INT_VALUE,
): boolean {
  return Number.isInteger(value) && value >= minValue && value <= maxValue;
}

export function getExactDiv2(value: number): { ok: true; result: number } | { ok: false; reason: string } {
  if (Math.abs(value % 2) !== 0) {
    return { ok: false, reason: `Число ${value} не делится нацело на 2` };
  }
  const result = value / 2;
  return { ok: true, result: result === 0 ? 0 : result };
}

export function getExactSqrt(value: number): { ok: true; result: number } | { ok: false; reason: string } {
  if (value < 0) {
    return { ok: false, reason: `Корень из отрицательного числа ${value} не определён в целых числах` };
  }
  const root = Math.round(Math.sqrt(value));
  if (root * root !== value) {
    return { ok: false, reason: `Число ${value} не является точным квадратом` };
  }
  return { ok: true, result: root };
}

/**
 * Euclidean integer division: a = b * q + r, 0 <= r < b (for b > 0).
 */
export function euclideanDivMod(a: number, b: number): { q: number; r: number } {
  if (b <= 0) {
    throw new Error('Divisor b must be positive');
  }
  const q = Math.floor(a / b);
  const r = a - b * q;
  return { q: q === 0 ? 0 : q, r: r === 0 ? 0 : r };
}

