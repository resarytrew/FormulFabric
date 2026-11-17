import type { ConnectedComponent } from './components';
import { triggerError } from './events';
import { pickBestIntent } from './intent-order';
import { hexEqual, hexKey, hexNeighbor, rotateAroundPivot } from './hex-math';
import { getRotationSweptHexes } from './rotation';
import { SOLID_MACHINE_TYPES } from './world';
import type { ComponentIntent, ThrustTier } from './movement-types';
import type { AxialCoord, HexKey, SimulationWorld } from './types';

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

  // Check Rotator Swept-Arc Obstacles (solid machine housings & non-component spheres on swept sector)
  for (const comp of components) {
    const intent = resolvedIntentByComp.get(comp.id);
    if (!intent || intent.kind !== 'rotate') continue;
    const compSet = new Set(comp.tokenIds);
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
        for (const [otherId, otherProposed] of proposedCoordByToken.entries()) {
          if (compSet.has(otherId)) continue;
          if (hexEqual(otherProposed, sweptHex)) {
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
  }

  // Check out-of-bounds and solid housings
  for (const [id, targetCoord] of proposedCoordByToken.entries()) {
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

  // Check edge swaps (token A moves oldA -> oldB while token B moves oldB -> oldA)
  const tokenIds = Array.from(world.tokens.keys());
  for (let i = 0; i < tokenIds.length; i++) {
    for (let j = i + 1; j < tokenIds.length; j++) {
      const id1 = tokenIds[i];
      const id2 = tokenIds[j];
      const old1 = world.tokens.get(id1)!.coord;
      const old2 = world.tokens.get(id2)!.coord;
      const new1 = proposedCoordByToken.get(id1)!;
      const new2 = proposedCoordByToken.get(id2)!;
      if (
        !hexEqual(old1, new1) &&
        !hexEqual(old2, new2) &&
        hexEqual(new1, old2) &&
        hexEqual(new2, old1)
      ) {
        const intent1 = resolvedIntentByComp.get(tokenToComponent.get(id1)!.id);
        const intent2 = resolvedIntentByComp.get(tokenToComponent.get(id2)!.id);
        const validSwapperPair =
          intent1?.kind === 'swap' &&
          intent2?.kind === 'swap' &&
          hexEqual(intent1.pivot, intent2.pivot);
        if (!validSwapperPair) {
          triggerError(
            world,
            'Встречное столкновение сфер при обмене соседними гексами',
            [old1, old2],
            'collision',
          );
          return null;
        }
      }
    }
  }

  // Check target cell overlaps
  const tokensAtProposed = new Map<HexKey, string[]>();
  for (const [id, coord] of proposedCoordByToken.entries()) {
    const k = hexKey(coord);
    const arr = tokensAtProposed.get(k) ?? [];
    arr.push(id);
    tokensAtProposed.set(k, arr);
  }

  for (const [tKey, ids] of tokensAtProposed.entries()) {
    if (ids.length <= 1) continue;
    const machine = world.machines.get(tKey);
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
