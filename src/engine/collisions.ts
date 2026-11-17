import type { ConnectedComponent } from './components';
import { compareCoords, sortedTokens } from './deterministic-order';
import { triggerError } from './events';
import { pickBestIntent } from './intent-order';
import { hexEqual, hexKey, hexNeighbor, parseHexKey, rotateAroundPivot } from './hex-math';
import { getRotationSweptHexes } from './rotation';
import { SOLID_MACHINE_TYPES } from './world';
import type { ComponentIntent, ThrustTier } from './movement-types';
import type { AxialCoord, HexKey, SimulationWorld, Token } from './types';

/** Найденная пара встречного обмена: сферы меняются стартовыми клетками. */
export interface HeadOnSwapConflict {
  firstId: string;
  secondId: string;
  /** Стартовая (и целевая для партнёра) клетка первой сферы в каноническом порядке. */
  firstCoord: AxialCoord;
  /** Стартовая (и целевая для первой сферы) клетка второй сферы. */
  secondCoord: AxialCoord;
}

/**
 * Локальный индекс стартовой занятости (PR #4C): гекс на начало такта → сфера.
 *
 * Для допустимого состояния (инвариант B: не более одной сферы на гексе) каждая
 * запись — одиночная. `extraAtStart` заполняется только на повреждённых данных,
 * чтобы проверка обмена оставалась эквивалентной старому двойному циклу и там:
 * на гексе может оказаться несколько сфер, и партнёром считается первая, которую
 * нашёл бы перебор в каноническом порядке.
 */
export interface TokenStartIndex {
  tokenAtStart: Map<HexKey, string>;
  extraAtStart: Map<HexKey, string[]>;
}

/** Построение индекса стартовой занятости за один проход по сферам — O(n). */
export function buildTokenStartIndex(orderedTokens: readonly Token[]): TokenStartIndex {
  const tokenAtStart = new Map<HexKey, string>();
  const extraAtStart = new Map<HexKey, string[]>();
  for (const tok of orderedTokens) {
    const key = hexKey(tok.coord);
    if (!tokenAtStart.has(key)) {
      tokenAtStart.set(key, tok.id);
      continue;
    }
    const extra = extraAtStart.get(key);
    if (extra) extra.push(tok.id);
    else extraAtStart.set(key, [tok.id]);
  }
  return { tokenAtStart, extraAtStart };
}

/**
 * Проверка встречного обмена за O(n) после канонической сортировки.
 *
 * Эквивалентность старому двойному циклу:
 *
 *  - старый перебор брал первую пару `(i, j)`, `i < j`, в каноническом порядке
 *    сфер, для которой обе сферы сдвинулись и `new_i == old_j && new_j == old_i`;
 *  - такой обмен — инволюция: у сферы не больше одного партнёра, поэтому пары
 *    не пересекаются, и первая найденная пара — это первая (в каноническом
 *    порядке) сфера, участвующая в обмене, вместе со своим партнёром;
 *  - партнёр — единственная сфера, стоявшая на начало такта в целевой клетке
 *    (`tokenAtStart`), поэтому индексный поиск находит ровно ту же пару, а
 *    подсветка `[old_i, old_j]` сохраняет прежний порядок координат.
 *
 * Функция только ищет конфликт, поэтому её можно вызывать на уже отсортированном
 * списке сфер: лишняя сортировка не нужна (см. `resolveMovement`).
 */
export function findHeadOnSwapConflict(
  world: SimulationWorld,
  index: TokenStartIndex,
  orderedTokens: readonly Token[],
  tokenToComponent: Map<string, ConnectedComponent>,
  resolvedIntentByComp: Map<string, ComponentIntent | null>,
  proposedCoordByToken: Map<string, AxialCoord>,
): HeadOnSwapConflict | null {
  for (const tok of orderedTokens) {
    const next = proposedCoordByToken.get(tok.id);
    if (!next) continue;
    // Сфера остаётся на месте — обмена с ней быть не может.
    if (hexEqual(tok.coord, next)) continue;

    const targetKey = hexKey(next);
    const first = index.tokenAtStart.get(targetKey);
    if (first === undefined) continue;

    const extra = index.extraAtStart.get(targetKey);
    if (extra) {
      for (const otherId of [first, ...extra]) {
        const conflict = swapConflictWith(
          world,
          tok,
          otherId,
          tokenToComponent,
          resolvedIntentByComp,
          proposedCoordByToken,
        );
        if (conflict) return conflict;
      }
      continue;
    }

    if (first === tok.id) continue;
    const conflict = swapConflictWith(
      world,
      tok,
      first,
      tokenToComponent,
      resolvedIntentByComp,
      proposedCoordByToken,
    );
    if (conflict) return conflict;
  }
  return null;
}

/** Партнёр обмена для сферы `tok` — или `null`, если обмена (или нарушения) нет. */
function swapConflictWith(
  world: SimulationWorld,
  tok: Token,
  otherId: string,
  tokenToComponent: Map<string, ConnectedComponent>,
  resolvedIntentByComp: Map<string, ComponentIntent | null>,
  proposedCoordByToken: Map<string, AxialCoord>,
): HeadOnSwapConflict | null {
  if (otherId === tok.id) return null;
  const other = world.tokens.get(otherId);
  if (!other) return null;
  const otherNext = proposedCoordByToken.get(otherId);
  if (!otherNext) return null;
  // Обе сферы должны сдвинуться, иначе это не обмен, а наложение.
  if (hexEqual(other.coord, otherNext)) return null;
  if (!hexEqual(otherNext, tok.coord)) return null;

  const intent1 = resolvedIntentByComp.get(tokenToComponent.get(tok.id)!.id);
  const intent2 = resolvedIntentByComp.get(tokenToComponent.get(otherId)!.id);
  const validSwapperPair =
    intent1?.kind === 'swap' &&
    intent2?.kind === 'swap' &&
    hexEqual(intent1.pivot, intent2.pivot);
  if (validSwapperPair) return null;

  return {
    firstId: tok.id,
    secondId: otherId,
    firstCoord: { ...tok.coord },
    secondCoord: { ...other.coord },
  };
}

export function resolveMovement(world: SimulationWorld, components: ConnectedComponent[], tokenToComponent: Map<string, ConnectedComponent>, intentsByComp: Map<string, ComponentIntent[]>): { resolvedIntentByComp: Map<string, ComponentIntent | null>; proposedCoordByToken: Map<string, AxialCoord>; rotationInfoByToken: Map<string, { pivot: AxialCoord; angleDelta: number } | undefined> } | null {
  // Phase 3: Conflict Checks (Tiered Thrust Conflicts, Bounds, Solid Housing, Swept-Arcs, Swaps, Overlaps)
  const resolvedIntentByComp = new Map<string, ComponentIntent | null>();

  for (const comp of components) {
    const intents = intentsByComp.get(comp.id)!;
    if (intents.length === 0) {
      resolvedIntentByComp.set(comp.id, null);
      continue;
    }
    // High-tier actuators (pusher, magnet, rotator, swapper, jumper) override passive belts (tier 1)
    let maxTier: ThrustTier = 1;
    for (const intent of intents) {
      if (intent.tier > maxTier) maxTier = intent.tier;
    }
    const topIntents = intents.filter((i) => i.tier === maxTier);
    const uniqueSigs = new Set(topIntents.map((i) => i.signature));
    if (uniqueSigs.size > 1) {
      const conflictCoords = topIntents.map((i) => i.sourceCoord);
      triggerError(
        world,
        'Конфликт векторов тяги: разные приводы тянут полимер в противоположных направлениях',
        conflictCoords,
        'collision',
      );
      return null;
    }
    // Равнозначные кандидаты (одинаковый tier и signature) разрешаются полным
    // детерминированным порядком: pushChainIndex, координата источника, тип
    // механизма (см. compareIntents). Порядок массива намерений больше не
    // влияет на выбор, поэтому Map-порядок механизмов не наблюдаем.
    resolvedIntentByComp.set(comp.id, pickBestIntent(topIntents));
  }

  // Compute proposed coordinates for every token
  const proposedCoordByToken = new Map<string, AxialCoord>();
  const rotationInfoByToken = new Map<
    string,
    { pivot: AxialCoord; angleDelta: number } | undefined
  >();

  for (const comp of components) {
    const intent = resolvedIntentByComp.get(comp.id);
    for (const id of comp.tokenIds) {
      const tok = world.tokens.get(id)!;
      if (!intent) {
        proposedCoordByToken.set(id, { ...tok.coord });
      } else if (intent.kind === 'move') {
        proposedCoordByToken.set(id, hexNeighbor(tok.coord, intent.dir));
      } else if (intent.kind === 'jump') {
        const step1 = hexNeighbor(tok.coord, intent.dir);
        proposedCoordByToken.set(id, hexNeighbor(step1, intent.dir));
      } else if (intent.kind === 'swap') {
        proposedCoordByToken.set(id, rotateAroundPivot(tok.coord, intent.pivot, 3));
        rotationInfoByToken.set(id, {
          pivot: { ...intent.pivot },
          angleDelta: Math.PI,
        });
      } else {
        proposedCoordByToken.set(
          id,
          rotateAroundPivot(tok.coord, intent.pivot, intent.cwSteps),
        );
        rotationInfoByToken.set(id, {
          pivot: { ...intent.pivot },
          angleDelta: intent.cwSteps === 1 ? -Math.PI / 3 : Math.PI / 3,
        });
      }
    }
  }

  // Канонический порядок сфер и их предложенных координат вычисляется один раз
  // на такт: в фазе разрешения координаты сфер не меняются, поэтому повторные
  // сортировки в отдельных проверках не нужны (PR #4C). Порядок проверок
  // остался прежним — край → корпус → разлом → обмен → наложение.
  const orderedTokens = sortedTokens(world);
  const orderedProposed = orderedTokens
    .filter((tok) => proposedCoordByToken.has(tok.id))
    .map((tok) => [tok.id, proposedCoordByToken.get(tok.id)!] as [string, AxialCoord]);

  // Check Rotator Swept-Arc Obstacles (solid machine housings & non-component spheres on swept sector).
  //
  // Правило промежуточных траекторий (PR #4D, `docs/rotation-geometry-contract.md`):
  // гекс дуги считается занятым по **конечной** (предложенной) координате сферы.
  // Поэтому сфера, которая в этом же такте освобождает гекс сектора, вращение не
  // блокирует; покидать общий гекс с поворачивающимся компонентом по-прежнему
  // нельзя — это ловит проверка наложений. Неподвижная сфера имеет конечную
  // координату, равную начальной, поэтому стоит на месте для этой проверки.
  for (const comp of components) {
    const intent = resolvedIntentByComp.get(comp.id);
    if (!intent || intent.kind !== 'rotate') continue;
    const compSet = new Set(comp.tokenIds);
    // Индекс конечной занятости строится один раз на компонент.
    const occupiedAtEnd = new Set<HexKey>();
    for (const other of orderedTokens) {
      if (compSet.has(other.id)) continue;
      occupiedAtEnd.add(hexKey(proposedCoordByToken.get(other.id) ?? other.coord));
    }
    for (const id of comp.tokenIds) {
      const tok = world.tokens.get(id)!;
      const sweptHexes = getRotationSweptHexes(tok.coord, intent.pivot, intent.cwSteps);
      for (const sweptHex of sweptHexes) {
        const sKey = hexKey(sweptHex);
        const sweptMachine = world.machines.get(sKey);
        if (sweptMachine && SOLID_MACHINE_TYPES.has(sweptMachine.type)) {
          triggerError(
            world,
            `Столкновение на дуге поворота ротатора: корпус механизма (${sweptMachine.type}) перекрывает сектор`,
            [intent.pivot, tok.coord, sweptHex],
            'collision',
          );
          return null;
        }
        if (occupiedAtEnd.has(sKey)) {
          triggerError(
            world,
            'Столкновение на дуге поворота ротатора: сектор поворота занят другой сферой',
            [intent.pivot, sweptHex],
            'collision',
          );
          return null;
        }
      }
    }
  }

  // Check out-of-bounds and solid housings.
  // Порядок классов проверок не меняется (край → корпус → разлом → обмен →
  // наложение); внутри класса сферы перебираются канонически, поэтому при двух
  // независимых падениях/столкновениях в одном такте диагностика стабильна.
  for (const [id, targetCoord] of orderedProposed) {
    const tok = world.tokens.get(id)!;
    const tKey = hexKey(targetCoord);
    if (!world.platformHexes.has(tKey)) {
      world.fallingTokens = [
        {
          value: tok.value,
          fromCoord: { ...tok.coord },
          toCoord: { ...targetCoord },
        },
      ];
      triggerError(
        world,
        `Падение за край платформы в точке (${targetCoord.q}, ${targetCoord.r})`,
        [tok.coord, targetCoord],
        'collision',
      );
      return null;
    }
    const destMachine = world.machines.get(tKey);
    if (destMachine && SOLID_MACHINE_TYPES.has(destMachine.type)) {
      triggerError(
        world,
        `Столкновение с корпусом механизма (${destMachine.type})`,
        [targetCoord],
        'collision',
      );
      return null;
    }
  }

  // Check narrow-gap fissure stability on proposed component positions
  for (const comp of components) {
    const coords = comp.tokenIds.map((id) => proposedCoordByToken.get(id)!);
    const overGap = coords.filter((c) => world.narrowGapHexes.has(hexKey(c)));
    if (overGap.length === 0) continue;
    const hasSolidAnchor =
      comp.tokenIds.length >= 2 &&
      coords.some((c) => {
        const k = hexKey(c);
        return world.platformHexes.has(k) && !world.narrowGapHexes.has(k);
      });
    if (!hasSolidAnchor) {
      const gapTokens = comp.tokenIds
        .map((id) => ({
          tok: world.tokens.get(id)!,
          next: proposedCoordByToken.get(id)!,
        }))
        .filter((entry) => world.narrowGapHexes.has(hexKey(entry.next)));
      world.fallingTokens = gapTokens.map((entry) => ({
        value: entry.tok.value,
        fromCoord: { ...entry.tok.coord },
        toCoord: { ...entry.next },
      }));
      triggerError(
        world,
        'Сфера провалилась в узкий разлом: через него проходит только длинный полимер с опорой на твёрдую плитку',
        overGap,
        'collision',
      );
      return null;
    }
  }

  // Check edge swaps (token A moves oldA -> oldB while token B moves oldB -> oldA).
  //
  // PR #4C: вместо двойного перебора всех пар сфер (n(n−1)/2 сравнений) —
  // локальный индекс стартовой занятости и один проход по уже упорядоченному
  // списку сфер: O(n) после канонической сортировки O(n log n). Выбор пары
  // сохранён: `findHeadOnSwapConflict` возвращает ту же пару, которую нашёл бы
  // перебор (первая сфера в каноническом порядке, участвующая в обмене).
  const startIndex = buildTokenStartIndex(orderedTokens);
  const swapConflict = findHeadOnSwapConflict(
    world,
    startIndex,
    orderedTokens,
    tokenToComponent,
    resolvedIntentByComp,
    proposedCoordByToken,
  );
  if (swapConflict) {
    triggerError(
      world,
      'Встречное столкновение сфер при обмене соседними гексами',
      [swapConflict.firstCoord, swapConflict.secondCoord],
      'collision',
    );
    return null;
  }

  // Check target cell overlaps.
  // Конфликтные гексы перебираются по `q`, затем `r`, а сферы внутри гекса —
  // в каноническом порядке: при нескольких независимых наложениях в одном такте
  // сообщение и подсветка одинаковы при любом порядке хранения в Map.
  const tokensAtProposed = new Map<HexKey, string[]>();
  for (const [id, coord] of orderedProposed) {
    const k = hexKey(coord);
    const arr = tokensAtProposed.get(k) ?? [];
    arr.push(id);
    tokensAtProposed.set(k, arr);
  }

  const conflictHexes = [...tokensAtProposed.keys()].map(parseHexKey).sort(compareCoords);
  for (const conflictCoord of conflictHexes) {
    const ids = tokensAtProposed.get(hexKey(conflictCoord))!;
    if (ids.length <= 1) continue;
    const machine = world.machines.get(hexKey(conflictCoord));
    const validSimultaneousTwoInput =
      (machine?.type === 'adder' || machine?.type === 'scales') &&
      machine.state.memory === null &&
      ids.length === 2 &&
      ids.every((id) => {
        const comp = tokenToComponent.get(id)!;
        const moved = !hexEqual(world.tokens.get(id)!.coord, proposedCoordByToken.get(id)!);
        return comp.tokenIds.length === 1 && moved;
      });

    if (!validSimultaneousTwoInput) {
      const coord = proposedCoordByToken.get(ids[0])!;
      if ((machine?.type === 'adder' || machine?.type === 'scales') && machine.state.memory !== null) {
        triggerError(
          world,
          `${machine.type === 'adder' ? 'Сумматор Σ' : 'Весы ⚖'} уже хранят число ${machine.state.memory} и не могут принять сразу два новых входа`,
          [coord],
          'collision',
        );
      } else {
        triggerError(
          world,
          `Столкновение ${ids.length} числовых сфер на гексе (${coord.q}, ${coord.r})`,
          [coord],
          'collision',
        );
      }
      return null;
    }
  }

  return { resolvedIntentByComp, proposedCoordByToken, rotationInfoByToken };
}
