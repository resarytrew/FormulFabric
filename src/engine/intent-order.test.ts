/**
 * Детерминированный выбор намерения движения (PR #4B, дефекты
 * `equal-intent-choice` и `pusher-magnet-move-source`).
 *
 * Проверяется именно правило порядка: tier → pushChainIndex → координата
 * источника → тип механизма. Физические целевые координаты от выбора источника
 * не зависят, поэтому здесь сравниваются только сами намерения.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIntents, pickBestIntent } from './intent-order';
import type { ComponentIntent } from './movement-types';

function move(
  q: number,
  r: number,
  type: ComponentIntent['sourceMachineType'],
  extra: Partial<Extract<ComponentIntent, { kind: 'move' }>> = {},
): ComponentIntent {
  return {
    kind: 'move',
    dir: 0,
    tier: 1,
    signature: 'move:0',
    sourceCoord: { q, r },
    sourceMachineType: type,
    ...extra,
  };
}

test('compareIntents: tier 2 always beats tier 1, whatever the coordinates are', () => {
  const actuator = move(5, 5, 'pusher', { tier: 2 });
  const belt = move(-9, -9, 'conveyor', { tier: 1 });
  assert.ok(compareIntents(actuator, belt) < 0, 'tier 2 обязан быть предпочтительнее');
  assert.ok(compareIntents(belt, actuator) > 0);
});

test('compareIntents: a smaller pushChainIndex wins before the coordinate tie-break', () => {
  // Механика цепочки толкателя: сфера, которую двигают напрямую (индекс 0),
  // важнее сферы, которую двигают как звено цепочки (индекс 1), даже если
  // источник второй находится «раньше» по координате.
  const direct = move(4, 0, 'pusher', { tier: 2, pushChainIndex: 0 });
  const chained = move(-4, 0, 'pusher', { tier: 2, pushChainIndex: 1 });
  assert.ok(compareIntents(direct, chained) < 0);
  assert.equal(pickBestIntent([chained, direct]), direct);
  assert.equal(pickBestIntent([direct, chained]), direct);
});

test('compareIntents: equal tier/chain/signature resolve by source q, then source r', () => {
  const small = move(-1, 3, 'conveyor');
  const large = move(2, -3, 'conveyor');
  assert.ok(compareIntents(small, large) < 0);

  const sameQSmallR = move(0, -2, 'conveyor');
  const sameQLargeR = move(0, 1, 'conveyor');
  assert.ok(compareIntents(sameQSmallR, sameQLargeR) < 0);

  for (const order of [[small, large], [large, small]]) {
    assert.equal(pickBestIntent(order), small);
  }
});

test('compareIntents: the machine type, intent kind and rotation pivot finish the order', () => {
  // Одна и та же координата у двух намерений — вырожденный случай, но компаратор
  // обязан оставаться полным порядком, а не «первым встретившимся».
  const conveyor = move(0, 0, 'conveyor');
  const pusher = move(0, 0, 'pusher', { tier: 2 });
  assert.ok(compareIntents(pusher, conveyor) < 0, 'tier решает раньше типа');

  const beltA = move(0, 0, 'conveyor');
  const beltB = move(0, 0, 'filter');
  assert.ok(compareIntents(beltA, beltB) !== 0, 'при полном совпадении координат порядок задаёт тип');

  const rotateCw: ComponentIntent = {
    kind: 'rotate',
    pivot: { q: 0, r: 0 },
    cwSteps: 1,
    tier: 2,
    signature: 'rot:0,0:1',
    sourceCoord: { q: 1, r: 0 },
    sourceMachineType: 'rotator',
  };
  const rotateCcw: ComponentIntent = { ...rotateCw, cwSteps: -1, signature: 'rot:0,0:-1' };
  assert.ok(compareIntents(rotateCcw, rotateCw) < 0, 'направление поворота — последний критерий');
  assert.equal(pickBestIntent([rotateCw, rotateCcw]), rotateCcw);
});

test('compareIntents: choice is independent of the input permutation (total order)', () => {
  const intents: ComponentIntent[] = [
    move(0, 0, 'conveyor'),
    move(0, 1, 'conveyor'),
    move(-1, 0, 'conveyor'),
    move(-1, -1, 'filter'),
    move(3, 3, 'pusher', { tier: 2, pushChainIndex: 2 }),
    move(-7, 4, 'pusher', { tier: 2, pushChainIndex: 0 }),
    {
      kind: 'jump',
      dir: 2,
      tier: 2,
      signature: 'jump:2',
      sourceCoord: { q: 2, r: 2 },
      sourceMachineType: 'jumper',
    },
  ];

  // Полный порядок: антисимметрия и транзитивность на выборке.
  for (const a of intents) {
    for (const b of intents) {
      assert.equal(Math.sign(compareIntents(a, b)) + Math.sign(compareIntents(b, a)), 0, 'антисимметрия');
    }
  }
  for (const a of intents) {
    for (const b of intents) {
      for (const c of intents) {
        if (compareIntents(a, b) < 0 && compareIntents(b, c) < 0) {
          assert.ok(compareIntents(a, c) < 0, 'транзитивность');
        }
      }
    }
  }

  const expected = pickBestIntent(intents);
  // 120 перестановок: победитель обязан быть одним и тем же.
  const permutations = (items: ComponentIntent[]): ComponentIntent[][] => {
    if (items.length <= 1) return [items];
    const out: ComponentIntent[][] = [];
    for (let i = 0; i < items.length; i++) {
      const rest = [...items.slice(0, i), ...items.slice(i + 1)];
      for (const tail of permutations(rest)) out.push([items[i], ...tail]);
    }
    return out;
  };
  for (const permutation of permutations(intents)) {
    assert.equal(pickBestIntent(permutation), expected);
  }
});
