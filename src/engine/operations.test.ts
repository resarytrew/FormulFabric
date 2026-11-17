import test from 'node:test';
import assert from 'node:assert/strict';
import { euclideanDivMod, tryEuclideanDivMod, MIN_INT_VALUE, MAX_INT_VALUE } from './operations';

test('евклидово деление корректно (инвариант a = b·q + r, 0 ≤ r < b)', () => {
  for (let a = -999; a <= 999; a += 7) {
    for (let b = 1; b <= 999; b += 13) {
      const result = tryEuclideanDivMod(a, b);

      assert.equal(result.ok, true);
      if (!result.ok) continue;

      assert.equal(a, b * result.q + result.r);
      assert.ok(result.r >= 0);
      assert.ok(result.r < b);
    }
  }
});

test('безобёртка отклоняет недопустимые аргументы вместо исключения', () => {
  for (const [a, b] of [
    [1.5, 2],
    [4, 2.5],
    [Number.NaN, 2],
    [4, Number.NaN],
    [1000, 2],
    [-1000, 2],
    [4, 0],
    [4, -3],
    [4, 1000],
  ] as const) {
    const result = tryEuclideanDivMod(a, b);
    assert.equal(result.ok, false, `tryEuclideanDivMod(${a}, ${b}) должна вернуть ошибку`);
    if (result.ok) continue;
    assert.match(result.reason, /Недопустимые аргументы деления/);
  }
});

test('крайние значения диапазона обрабатываются корректно', () => {
  for (const a of [MIN_INT_VALUE, MAX_INT_VALUE, 0, 1, -1]) {
    for (const b of [1, 999]) {
      const result = tryEuclideanDivMod(a, b);
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.equal(a, b * result.q + result.r);
      assert.ok(result.r >= 0 && result.r < b);
    }
  }

  // Частное и остаток нормализуются к «не-нулевым» значениям без минус-нуля.
  assert.deepEqual(tryEuclideanDivMod(0, 7), { ok: true, q: 0, r: 0 });
  assert.deepEqual(tryEuclideanDivMod(14, 7), { ok: true, q: 2, r: 0 });
  assert.deepEqual(tryEuclideanDivMod(-7, 7), { ok: true, q: -1, r: 0 });
});

test('безобёртка согласована с математическим ядром euclideanDivMod', () => {
  for (let a = -999; a <= 999; a += 11) {
    for (let b = 1; b <= 999; b += 37) {
      const safe = tryEuclideanDivMod(a, b);
      assert.equal(safe.ok, true);
      if (!safe.ok) continue;
      assert.deepEqual({ q: safe.q, r: safe.r }, euclideanDivMod(a, b));
    }
  }
});
