import { getConnectedComponents, type ConnectedComponent } from './components';
import { getRotationSweptHexes } from './rotation';
import { matchComponentToPattern } from './patterns';
export { getConnectedComponents, type ConnectedComponent } from './components';
export { getRotationSweptHexes } from './rotation';
export { matchComponentToPattern } from './patterns';
import { SOLID_MACHINE_TYPES, validateLevelPlacement, createWorldFromLevel } from './world';
export { SOLID_MACHINE_TYPES, createMachineInstance, getMachineFootprint, getBlockedPlacementInfo, validateLevelPlacement, createWorldFromLevel } from './world';
import { MIN_INT_VALUE, MAX_INT_VALUE, evaluateFilterRule, isInRange, getExactDiv2, getExactSqrt, euclideanDivMod } from './operations';
export { MIN_INT_VALUE, MAX_INT_VALUE, evaluateFilterRule, isInRange, getExactDiv2, getExactSqrt, euclideanDivMod } from './operations';
import {
  hexDistance,
  hexEqual,
  hexKey,
  hexNeighbor,
  hexToWorld,
  oppositeDir,
  rotateAroundPivot,
  rotateDir,
  generateHexDisk,
  worldToHex,
} from './hex-math';
import type {
  AxialCoord,
  BondEdge,
  FilterRule,
  HexDir,
  HexKey,
  LevelDefinition,
  LevelGoalCheck,
  MachineConfig,
  MachineInstance,
  MachineType,
  SimEvent,
  SimulationWorld,
  TargetPattern,
  Token,
  TokenMoveSource,
  VerificationReport,
  VerificationRunResult,
} from './types';

export function cloneWorld(world: SimulationWorld): SimulationWorld {
  return structuredClone(world);
}

export const MAX_SIMULATION_TICKS = 180;

export function computeWorldArea(world: SimulationWorld): number {
  const areaHexes = new Set<HexKey>(world.visitedHexes);
  for (const m of world.machines.values()) {
    if (!m.locked) {
      areaHexes.add(hexKey(m.coord));
    }
  }
  for (const t of world.tokens.values()) {
    areaHexes.add(hexKey(t.coord));
  }
  return areaHexes.size;
}

type ThrustTier = 1 | 2;

type ComponentIntent =
  | {
      kind: 'move';
      dir: HexDir;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
      pushChainIndex?: number;
    }
  | {
      kind: 'jump';
      dir: HexDir;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'rotate';
      pivot: AxialCoord;
      cwSteps: 1 | -1;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'swap';
      pivot: AxialCoord;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    };

function pushEvent(world: SimulationWorld, ev: Omit<SimEvent, 'tick' | 'id'>) {
  world.events.push({ id: world.nextEventId++, tick: world.tick, ...ev });
  if (world.events.length > 160) {
    world.events.shift();
  }
}

function triggerError(
  world: SimulationWorld,
  reason: string,
  highlightHexes: AxialCoord[],
  type: SimEvent['type'] = 'collision',
) {
  world.status = 'error';
  world.errorReason = reason;
  world.errorHighlightHexes = highlightHexes.map((h) => ({ ...h }));
  pushEvent(world, {
    type,
    coord: highlightHexes[0] ?? { q: 0, r: 0 },
    message: reason,
    severity: 'error',
    relatedCoords: highlightHexes,
    badge: '!',
  });
}

function addBondCanonical(world: SimulationWorld, idA: string, idB: string): boolean {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const exists = world.bonds.some((e) => e.a === a && e.b === b);
  if (exists) return false;
  world.bonds.push({ a, b });
  return true;
}

export function stepSimulation(world: SimulationWorld): SimulationWorld {
  if (world.status === 'victory' || world.status === 'error') {
    return world;
  }

  world.tick += 1;
  world.status = 'running';
  world.errorHighlightHexes = [];
  world.errorReason = null;
  world.fallingTokens = [];
  world.consumedTokens = [];
  world.consumedBonds = [];

  const recordConsumed = (tok: Token, kind: 'deliver' | 'store' | 'destroy' | 'merge') => {
    world.consumedTokens!.push({
      id: tok.id,
      value: tok.prevValue ?? tok.value,
      coord: { ...tok.coord },
      prevCoord: { ...tok.prevCoord },
      moveSource: tok.moveSource,
      rotatedFrom: tok.rotatedFrom
        ? { pivot: { ...tok.rotatedFrom.pivot }, angleDelta: tok.rotatedFrom.angleDelta }
        : undefined,
      kind,
    });
  };

  // Phase 1: Snapshot current state & reset interpolation prevCoords/prevValues
  for (const m of world.machines.values()) {
    if (m.state.activeFlashTicks > 0) {
      m.state.activeFlashTicks -= 1;
    }
    m.state.isWaitingSideExit = false;
  }
  for (const t of world.tokens.values()) {
    t.prevCoord = { ...t.coord };
    t.prevValue = t.value;
    t.rotatedFrom = undefined;
    t.moveSource = undefined;
    t.pushChainIndex = undefined;
  }

  const components = getConnectedComponents(world);
  const tokenToComponent = new Map<string, ConnectedComponent>();
  for (const c of components) {
    for (const id of c.tokenIds) {
      tokenToComponent.set(id, c);
    }
  }

  const tokenAtHex = new Map<HexKey, Token>();
  for (const t of world.tokens.values()) {
    tokenAtHex.set(hexKey(t.coord), t);
  }

  // Phase 2: Compute Intents symmetrically with Tier hierarchy (Actuator Tier 2 > Belt Tier 1)
  const intentsByComp = new Map<string, ComponentIntent[]>();
  for (const c of components) {
    intentsByComp.set(c.id, []);
  }

  const addIntent = (compId: string, intent: ComponentIntent) => {
    intentsByComp.get(compId)!.push(intent);
  };

  const activePushers: Array<{ machine: MachineInstance; rootComp: ConnectedComponent }> = [];

  for (const machine of world.machines.values()) {
    const mKey = hexKey(machine.coord);

    if (
      machine.type === 'conveyor' ||
      machine.type === 'add1' ||
      machine.type === 'sub1' ||
      machine.type === 'mul2' ||
      machine.type === 'div2' ||
      machine.type === 'sqrt' ||
      machine.type === 'neg' ||
      machine.type === 'dup'
    ) {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        if (tok.waitingSidePort === machine.id) {
          machine.state.isWaitingSideExit = true;
          continue;
        }
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 1,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'adder') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 1,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'filter') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        const pass = evaluateFilterRule(tok.value, machine.config.filterRule ?? 'even');
        const outDir = pass
          ? machine.config.dir
          : (machine.config.altDir ?? rotateDir(machine.config.dir, 1));
        addIntent(comp.id, {
          kind: 'move',
          dir: outDir,
          tier: 1,
          signature: `move:${outDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'splitter') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        const useAlt = machine.state.memory === 1;
        const outDir = useAlt
          ? (machine.config.altDir ?? rotateDir(machine.config.dir, 1))
          : machine.config.dir;
        addIntent(comp.id, {
          kind: 'move',
          dir: outDir,
          tier: 1,
          signature: `move:${outDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (
      machine.type === 'divmod' ||
      machine.type === 'halver' ||
      machine.type === 'scales'
    ) {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        if (tok.waitingSidePort === machine.id) {
          machine.state.isWaitingSideExit = true;
          continue;
        }
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 1,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'jumper') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        if (comp.tokenIds.length > 1) {
          triggerError(
            world,
            'Пружина трамплина перегружена: полимер нельзя перебросить целиком',
            [machine.coord],
            'error',
          );
          return world;
        }
        addIntent(comp.id, {
          kind: 'jump',
          dir: machine.config.dir,
          tier: 2,
          signature: `jump:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'pusher') {
      const targetHex = hexNeighbor(machine.coord, machine.config.dir);
      const tok = tokenAtHex.get(hexKey(targetHex));
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 2,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
          pushChainIndex: 0,
        });
        activePushers.push({ machine, rootComp: comp });
      }
    } else if (machine.type === 'magnet') {
      const d1 = hexNeighbor(machine.coord, machine.config.dir);
      const d2 = hexNeighbor(d1, machine.config.dir);
      const tok1 = tokenAtHex.get(hexKey(d1));
      const tok2 = tokenAtHex.get(hexKey(d2));
      if (!tok1 && tok2) {
        const comp = tokenToComponent.get(tok2.id)!;
        const pullDir = oppositeDir(machine.config.dir);
        addIntent(comp.id, {
          kind: 'move',
          dir: pullDir,
          tier: 2,
          signature: `move:${pullDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'rotator') {
      const grabHex = hexNeighbor(machine.coord, machine.config.dir);
      const tok = tokenAtHex.get(hexKey(grabHex));
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        const cwSteps = machine.config.rotMode === 'ccw' ? -1 : 1;
        addIntent(comp.id, {
          kind: 'rotate',
          pivot: { ...machine.coord },
          cwSteps,
          tier: 2,
          signature: `rot:${machine.coord.q},${machine.coord.r}:${cwSteps}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'swapper') {
      const hexA = hexNeighbor(machine.coord, machine.config.dir);
      const hexB = hexNeighbor(machine.coord, oppositeDir(machine.config.dir));
      const tokA = tokenAtHex.get(hexKey(hexA));
      const tokB = tokenAtHex.get(hexKey(hexB));
      const touchedComps = new Set<string>();
      for (const tok of [tokA, tokB]) {
        if (!tok) continue;
        const comp = tokenToComponent.get(tok.id)!;
        if (touchedComps.has(comp.id)) continue;
        touchedComps.add(comp.id);
        addIntent(comp.id, {
          kind: 'swap',
          pivot: { ...machine.coord },
          tier: 2,
          signature: `swap:${machine.coord.q},${machine.coord.r}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    }
  }

  // Phase 2B: Propagate Pusher chain impulses along push axis (up to 3 spheres / depth 3)
  const MAX_PUSHER_CHAIN_SPHERES = 3;
  for (const { machine, rootComp } of activePushers) {
    const pushDir = machine.config.dir;
    const visitedComps = new Set<string>([rootComp.id]);
    let totalPushedSpheres = rootComp.tokenIds.length;
    const queue: Array<{ comp: ConnectedComponent; chainIdx: number }> = [
      { comp: rootComp, chainIdx: 0 },
    ];

    while (queue.length > 0) {
      const { comp, chainIdx } = queue.shift()!;
      for (const id of comp.tokenIds) {
        const tok = world.tokens.get(id)!;
        const aheadCoord = hexNeighbor(tok.coord, pushDir);
        const aheadTok = tokenAtHex.get(hexKey(aheadCoord));
        if (!aheadTok) continue;
        const aheadComp = tokenToComponent.get(aheadTok.id)!;
        if (visitedComps.has(aheadComp.id)) continue;

        const existingIntents = intentsByComp.get(aheadComp.id)!;
        const hasTier2 = existingIntents.some((i) => i.tier === 2);
        const tier1OpposesOrStalls =
          existingIntents.length === 0 ||
          existingIntents.some(
            (i) => i.tier === 1 && i.kind === 'move' && i.dir === oppositeDir(pushDir),
          );

        if (!hasTier2 && !tier1OpposesOrStalls) {
          // aheadComp moves away cleanly on its own belt this tick without blocking the pushed line
          continue;
        }

        const nextChainIdx = chainIdx + 1;
        totalPushedSpheres += aheadComp.tokenIds.length;
        if (nextChainIdx >= MAX_PUSHER_CHAIN_SPHERES || totalPushedSpheres > MAX_PUSHER_CHAIN_SPHERES) {
          triggerError(
            world,
            `Перегрузка толкателя: невозможно сдвинуть цепочку тяжелее ${MAX_PUSHER_CHAIN_SPHERES} сфер`,
            [machine.coord, tok.coord, aheadCoord],
            'collision',
          );
          return world;
        }

        visitedComps.add(aheadComp.id);
        addIntent(aheadComp.id, {
          kind: 'move',
          dir: pushDir,
          tier: 2,
          signature: `move:${pushDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: 'pusher',
          pushChainIndex: nextChainIdx,
        });
        queue.push({ comp: aheadComp, chainIdx: nextChainIdx });
      }
    }
  }

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
      return world;
    }
    let chosen = topIntents[0];
    for (const cand of topIntents) {
      const candIdx = cand.kind === 'move' ? (cand.pushChainIndex ?? 0) : 0;
      const chosenIdx = chosen.kind === 'move' ? (chosen.pushChainIndex ?? 0) : 0;
      if (candIdx < chosenIdx) {
        chosen = cand;
      }
    }
    resolvedIntentByComp.set(comp.id, chosen);
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
          return world;
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
            return world;
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
      return world;
    }
    const destMachine = world.machines.get(tKey);
    if (destMachine && SOLID_MACHINE_TYPES.has(destMachine.type)) {
      triggerError(
        world,
        `Столкновение с корпусом механизма (${destMachine.type})`,
        [targetCoord],
        'collision',
      );
      return world;
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
      return world;
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
          return world;
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
      return world;
    }
  }

  // Phase 4: Simultaneous Apply (Moves, Spawners, Arithmetic, Welds, Laser Cuts)
  const movedTokenIds = new Set<string>();
  for (const [id, coord] of proposedCoordByToken.entries()) {
    const tok = world.tokens.get(id)!;
    if (!hexEqual(tok.coord, coord)) {
      movedTokenIds.add(id);
      if (tok.waitingSidePort) {
        const prevMach = world.machines.get(hexKey(tok.coord));
        if (prevMach && prevMach.id === tok.waitingSidePort) {
          prevMach.state.waitTicks = 0;
          prevMach.state.isWaitingSideExit = false;
        }
        tok.waitingSidePort = undefined;
      }
      tok.coord = { ...coord };
      tok.rotatedFrom = rotationInfoByToken.get(id);
      const comp = tokenToComponent.get(id);
      const intent = comp ? resolvedIntentByComp.get(comp.id) : null;
      let moveSource: TokenMoveSource = 'conveyor';
      if (intent?.kind === 'rotate') {
        moveSource = 'rotator';
      } else if (intent?.kind === 'jump') {
        moveSource = 'jump';
      } else if (intent?.kind === 'swap') {
        moveSource = 'swap';
      } else if (intent?.sourceMachineType === 'pusher') {
        moveSource = 'pusher';
        tok.pushChainIndex = intent.pushChainIndex;
      } else if (intent?.sourceMachineType === 'magnet') {
        moveSource = 'magnet';
      }
      tok.moveSource = moveSource;
    }
  }

  // Flash active actuators that moved components
  const toggledSplitters = new Set<string>();
  const loggedSwappers = new Set<string>();
  for (const comp of components) {
    const intent = resolvedIntentByComp.get(comp.id);
    if (intent) {
      const m = world.machines.get(hexKey(intent.sourceCoord));
      if (m) {
        m.state.activeFlashTicks = 1;
        m.state.lastActionTick = world.tick;
        if (m.type === 'splitter' && !toggledSplitters.has(m.id)) {
          toggledSplitters.add(m.id);
          const wasAlt = m.state.memory === 1;
          m.state.memory = wasAlt ? 0 : 1;
          pushEvent(world, {
            type: 'move',
            coord: m.coord,
            message: `Разделитель ⇄: порт ${wasAlt ? 'B → A' : 'A → B'}`,
            severity: 'info',
            badge: '⇄',
          });
        } else if (m.type === 'swapper' && !loggedSwappers.has(m.id)) {
          loggedSwappers.add(m.id);
          pushEvent(world, {
            type: 'rotate',
            coord: m.coord,
            message: 'Качели-менялка ⇄: разворот на 180°',
            severity: 'info',
            badge: '180°⇄',
          });
        } else if (m.type === 'jumper') {
          pushEvent(world, {
            type: 'move',
            coord: m.coord,
            message: 'Трамплин ↷ перебросил сферу через гекс',
            severity: 'info',
            badge: '↷',
          });
        }
      }
      if (intent.kind === 'rotate') {
        pushEvent(world, {
          type: 'rotate',
          coord: intent.pivot,
          message: `Поворот полимера на 60° ${intent.cwSteps === 1 ? '↻' : '↺'}`,
          severity: 'info',
          badge: intent.cwSteps === 1 ? '60°↻' : '60°↺',
        });
      }
    }
  }

  // Activate Spawners (spawn onto neighbor hex if empty)
  for (const machine of world.machines.values()) {
    if (machine.type !== 'spawner') continue;
    const seq = machine.config.sequence ?? [];
    if (seq.length === 0) continue;

    if (machine.state.cooldown > 0) {
      machine.state.cooldown -= 1;
      continue;
    }

    if (machine.state.spawnIndex >= seq.length) {
      if (machine.config.loopSequence) {
        machine.state.spawnIndex = 0;
      } else {
        continue;
      }
    }

    const spawnCoord = hexNeighbor(machine.coord, machine.config.dir);
    const spawnKey = hexKey(spawnCoord);
    if (!world.platformHexes.has(spawnKey)) {
      triggerError(
        world,
        'Источник направлен за пределы платформы',
        [machine.coord, spawnCoord],
        'error',
      );
      return world;
    }

    const spawnDestMachine = world.machines.get(spawnKey);
    if (spawnDestMachine && SOLID_MACHINE_TYPES.has(spawnDestMachine.type)) {
      triggerError(
        world,
        `Источник направлен внутрь корпуса механизма (${spawnDestMachine.type})`,
        [machine.coord, spawnCoord],
        'collision',
      );
      return world;
    }

    // Check if spawn hex currently occupied
    const occupied = Array.from(world.tokens.values()).some((t) =>
      hexEqual(t.coord, spawnCoord),
    );
    if (occupied) {
      pushEvent(world, {
        type: 'blocked',
        coord: spawnCoord,
        message: 'Выход источника занят — ожидание освобождения гекса',
        severity: 'warning',
      });
      continue;
    }

    const val = seq[machine.state.spawnIndex];
    if (!isInRange(val, world.minValue, world.maxValue)) {
      triggerError(
        world,
        `Входное значение ${val} выходит за допустимый диапазон [${world.minValue}, ${world.maxValue}]`,
        [machine.coord],
        'error',
      );
      return world;
    }

    const newTok: Token = {
      id: `t_${world.nextTokenId++}`,
      value: val,
      prevValue: val,
      coord: { ...spawnCoord },
      prevCoord: { ...machine.coord },
      moveSource: 'spawner',
      spawnOrder: world.nextSpawnOrder++,
    };
    world.tokens.set(newTok.id, newTok);
    movedTokenIds.add(newTok.id);
    machine.state.spawnIndex += 1;
    machine.state.cooldown = Math.max(0, (machine.config.spawnInterval ?? 2) - 1);
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;

    pushEvent(world, {
      type: 'spawn',
      coord: spawnCoord,
      message: `Выпущено число ${val}`,
      severity: 'info',
    });
  }

  // Track visited hexes for Area optimization metric
  for (const t of world.tokens.values()) {
    world.visitedHexes.add(hexKey(t.coord));
  }

  // Helper to classify side-port availability: free vs temporary token occupation vs permanent obstacle
  const getSidePortAvailability = (
    altCoord: AxialCoord,
  ): 'free' | 'occupied_token' | 'blocked_static' => {
    const aKey = hexKey(altCoord);
    if (!world.platformHexes.has(aKey)) return 'blocked_static';
    if (SOLID_MACHINE_TYPES.has(world.machines.get(aKey)?.type ?? 'conveyor')) {
      return 'blocked_static';
    }
    if (Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, altCoord))) {
      return 'occupied_token';
    }
    return 'free';
  };

  let machineActionOccurredThisTick = movedTokenIds.size > 0;

  // Process Duplicators (dup: keeps original to exit along dir, spawns copy onto altDir or pauses if altDir busy)
  for (const tok of Array.from(world.tokens.values())) {
    const machine = world.machines.get(hexKey(tok.coord));
    if (!machine || machine.type !== 'dup') continue;
    if (!movedTokenIds.has(tok.id) && tok.waitingSidePort !== machine.id) continue;
    const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
    if (isBonded) {
      triggerError(
        world,
        'Дубликатор копирует только отдельные несвязанные числа',
        [machine.coord],
        'error',
      );
      return world;
    }
    const copyCoord = hexNeighbor(
      machine.coord,
      machine.config.altDir ?? rotateDir(machine.config.dir, 1),
    );
    const portState = getSidePortAvailability(copyCoord);
    if (portState === 'blocked_static') {
      triggerError(
        world,
        'Нет свободного гекса для вывода копии дубликатора',
        [machine.coord, copyCoord],
        'blocked',
      );
      return world;
    }
    if (portState === 'occupied_token') {
      tok.waitingSidePort = machine.id;
      machine.state.isWaitingSideExit = true;
      machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
      if (machine.state.waitTicks === 1) {
        pushEvent(world, {
          type: 'blocked',
          coord: machine.coord,
          relatedCoords: [copyCoord],
          message: 'Боковой выход дубликатора = занят — ожидание очереди',
          severity: 'warning',
          badge: '⏳',
        });
      }
      continue;
    }
    tok.waitingSidePort = undefined;
    machine.state.isWaitingSideExit = false;
    machine.state.waitTicks = 0;
    const copyTok: Token = {
      id: `t_${world.nextTokenId++}`,
      value: tok.value,
      prevValue: tok.value,
      coord: { ...copyCoord },
      prevCoord: { ...machine.coord },
      moveSource: 'split',
      spawnOrder: tok.spawnOrder,
    };
    world.tokens.set(copyTok.id, copyTok);
    movedTokenIds.add(copyTok.id);
    machineActionOccurredThisTick = true;
    world.visitedHexes.add(hexKey(copyCoord));
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;
    pushEvent(world, {
      type: 'transform',
      coord: machine.coord,
      message: `Дубликатор =: копия числа ${tok.value}`,
      severity: 'info',
      badge: '=',
    });
  }

  // Process Adder & Scales (2-input consumption & memory)
  for (const machine of world.machines.values()) {
    if (machine.type !== 'adder' && machine.type !== 'scales') continue;
    const tokensHere = Array.from(world.tokens.values()).filter((t) =>
      hexEqual(t.coord, machine.coord),
    );
    if (tokensHere.length === 0) continue;

    if (tokensHere.length > 2 || (tokensHere.length >= 2 && machine.state.memory !== null)) {
      triggerError(
        world,
        `${machine.type === 'adder' ? 'Сумматор Σ' : 'Весы ⚖'} переполнены одновременными входами при занятой памяти`,
        [machine.coord],
        'collision',
      );
      return world;
    }

    if (machine.type === 'adder') {
      // Simultaneous 2-token arrival
      if (tokensHere.length === 2) {
        const [t1, t2] = tokensHere;
        const sum = t1.value + t2.value;
        if (!isInRange(sum, world.minValue, world.maxValue)) {
          triggerError(
            world,
            `Переполнение сумматора: ${t1.value} + ${t2.value} = ${sum} вне [${world.minValue}, ${world.maxValue}]`,
            [machine.coord],
            'error',
          );
          return world;
        }
        recordConsumed(t2, 'merge');
        world.tokens.delete(t2.id);
        t1.value = sum;
        t1.producedByAdderAtTick = world.tick;
        machine.state.memory = null;
        machineActionOccurredThisTick = true;
        machine.state.activeFlashTicks = 1;
        machine.state.lastActionTick = world.tick;
        pushEvent(world, {
          type: 'transform',
          coord: machine.coord,
          message: `Сумматор Σ: ${t1.value - t2.value} + ${t2.value} = ${sum}`,
          severity: 'success',
          badge: `Σ=${sum}`,
        });
        continue;
      }

      const tok = tokensHere[0];
      // Never re-absorb a token produced on this exact tick!
      if (tok.producedByAdderAtTick === world.tick) {
        continue;
      }
      // Only newly arrived tokens interact with adder
      if (!movedTokenIds.has(tok.id)) {
        continue;
      }

      // Adder rejects bonded polymers
      const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
      if (isBonded) {
        triggerError(
          world,
          'Сумматор принимает только отдельные несвязанные числа',
          [machine.coord],
          'error',
        );
        return world;
      }

      if (machine.state.memory === null) {
        machine.state.memory = tok.value;
        recordConsumed(tok, 'store');
        world.tokens.delete(tok.id);
        machine.state.activeFlashTicks = 1;
        machine.state.lastActionTick = world.tick;
        pushEvent(world, {
          type: 'store',
          coord: machine.coord,
          message: `Сумматор Σ сохранил первое слагаемое: ${tok.value}`,
          severity: 'info',
          badge: `Σ(${tok.value})`,
        });
      } else {
        const first = machine.state.memory;
        const second = tok.value;
        const sum = first + second;
        if (!isInRange(sum, world.minValue, world.maxValue)) {
          triggerError(
            world,
            `Переполнение сумматора: ${first} + ${second} = ${sum} вне [${world.minValue}, ${world.maxValue}]`,
            [machine.coord],
            'error',
          );
          return world;
        }
        machine.state.memory = null;
        tok.value = sum;
        tok.producedByAdderAtTick = world.tick;
        machineActionOccurredThisTick = true;
        machine.state.activeFlashTicks = 1;
        machine.state.lastActionTick = world.tick;
        pushEvent(world, {
          type: 'transform',
          coord: machine.coord,
          message: `Сумматор Σ: ${first} + ${second} = ${sum}`,
          severity: 'success',
          badge: `Σ=${sum}`,
        });
      }
      continue;
    }

    // Scales (Весы-сортировщик ⚖): larger exits dir, smaller spawns onto altDir (or pauses if altDir busy)
    const emitSortedScales = (a: number, b: number, keepTok: Token, removeTok?: Token) => {
      if (a === b) {
        triggerError(
          world,
          `Весы в равновесии (${a} = ${b}): равные числа нельзя отсортировать на большее и меньшее`,
          [machine.coord],
          'error',
        );
        return false;
      }
      const altCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const portState = getSidePortAvailability(altCoord);
      if (portState === 'blocked_static') {
        triggerError(
          world,
          'Нет свободного гекса для вывода меньшего числа с весов',
          [machine.coord, altCoord],
          'blocked',
        );
        return false;
      }
      if (portState === 'occupied_token') {
        // Hold first value in memory and pause second token on scales until altDir clears
        if (removeTok) {
          machine.state.memory = removeTok.value;
          recordConsumed(removeTok, 'store');
          world.tokens.delete(removeTok.id);
        } else {
          machine.state.memory = a;
        }
        keepTok.waitingSidePort = machine.id;
        machine.state.isWaitingSideExit = true;
        machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
        if (machine.state.waitTicks === 1) {
          pushEvent(world, {
            type: 'blocked',
            coord: machine.coord,
            relatedCoords: [altCoord],
            message: 'Боковой выход весов ⚖ занят — ожидание очереди',
            severity: 'warning',
            badge: '⏳',
          });
        }
        return true;
      }
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      if (removeTok) {
        recordConsumed(removeTok, 'merge');
        world.tokens.delete(removeTok.id);
      }
      machine.state.memory = null;
      keepTok.waitingSidePort = undefined;
      machine.state.isWaitingSideExit = false;
      machine.state.waitTicks = 0;
      keepTok.value = big;
      keepTok.producedByAdderAtTick = world.tick;
      const smallTok: Token = {
        id: `t_${world.nextTokenId++}`,
        value: small,
        prevValue: small,
        coord: { ...altCoord },
        prevCoord: { ...machine.coord },
        moveSource: 'split',
        spawnOrder: keepTok.spawnOrder,
      };
      world.tokens.set(smallTok.id, smallTok);
      machineActionOccurredThisTick = true;
      world.visitedHexes.add(hexKey(altCoord));
      machine.state.activeFlashTicks = 1;
      machine.state.lastActionTick = world.tick;
      pushEvent(world, {
        type: 'transform',
        coord: machine.coord,
        message: `Весы ⚖: ${big} > ${small}`,
        severity: 'success',
        badge: `${big}|${small}`,
      });
      return true;
    };

    if (tokensHere.length === 2) {
      const [t1, t2] = tokensHere;
      if (!emitSortedScales(t1.value, t2.value, t1, t2)) return world;
      continue;
    }

    const tok = tokensHere[0];
    if (tok.producedByAdderAtTick === world.tick) continue;
    if (!movedTokenIds.has(tok.id) && tok.waitingSidePort !== machine.id) continue;

    const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
    if (isBonded) {
      triggerError(
        world,
        'Весы-сортировщик принимают только отдельные несвязанные числа',
        [machine.coord],
        'error',
      );
      return world;
    }

    if (machine.state.memory === null) {
      machine.state.memory = tok.value;
      recordConsumed(tok, 'store');
      world.tokens.delete(tok.id);
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      machine.state.lastActionTick = world.tick;
      pushEvent(world, {
        type: 'store',
        coord: machine.coord,
        message: `Весы ⚖ взвесили первое число: ${tok.value}`,
        severity: 'info',
        badge: `⚖(${tok.value})`,
      });
    } else {
      if (!emitSortedScales(machine.state.memory, tok.value, tok)) return world;
    }
  }

  // Process Unary Math Pads & side-port arithmetic on newly arrived or waiting tokens
  for (const tok of Array.from(world.tokens.values())) {
    const machine = world.machines.get(hexKey(tok.coord));
    if (!machine) continue;
    const isWaitingHere = tok.waitingSidePort === machine.id;
    if (!movedTokenIds.has(tok.id) && !isWaitingHere) continue;

    if (machine.type === 'add1') {
      const next = tok.value + 1;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return world;
      }
      const prev = tok.value;
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `+1: ${prev} → ${next}`, severity: 'info', badge: '+1' });
    } else if (machine.type === 'sub1') {
      const next = tok.value - 1;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return world;
      }
      const prev = tok.value;
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `-1: ${prev} → ${next}`, severity: 'info', badge: '−1' });
    } else if (machine.type === 'mul2') {
      const next = tok.value * 2;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Переполнение ×2: ${next} вне [${world.minValue}, ${world.maxValue}]`, [tok.coord], 'error');
        return world;
      }
      const prev = tok.value;
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `×2: ${prev} → ${next}`, severity: 'info', badge: '×2' });
    } else if (machine.type === 'div2') {
      const res = getExactDiv2(tok.value);
      if (!res.ok) {
        triggerError(world, res.reason, [tok.coord], 'error');
        return world;
      }
      const prev = tok.value;
      tok.value = res.result;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `÷2: ${prev} → ${res.result}`, severity: 'info', badge: '÷2' });
    } else if (machine.type === 'sqrt') {
      const res = getExactSqrt(tok.value);
      if (!res.ok) {
        triggerError(world, res.reason, [tok.coord], 'error');
        return world;
      }
      const prev = tok.value;
      tok.value = res.result;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `√x: √${prev} → ${res.result}`, severity: 'info', badge: `√=${res.result}` });
    } else if (machine.type === 'neg') {
      const prev = tok.value;
      const next = prev === 0 ? 0 : -prev;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return world;
      }
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `−x: ${prev} → ${next}`, severity: 'info', badge: '−x' });
    } else if (machine.type === 'divmod') {
      const b = machine.config.divisor ?? 2;
      const { q, r } = euclideanDivMod(tok.value, b);
      const remCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const portState = getSidePortAvailability(remCoord);
      if (portState === 'blocked_static') {
        triggerError(world, 'Нет места для вывода остатка от деления', [machine.coord, remCoord], 'blocked');
        return world;
      }
      if (portState === 'occupied_token') {
        tok.waitingSidePort = machine.id;
        machine.state.isWaitingSideExit = true;
        machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
        if (machine.state.waitTicks === 1) {
          pushEvent(world, {
            type: 'blocked',
            coord: machine.coord,
            relatedCoords: [remCoord],
            message: 'Боковой выход делителя ÷ занят — ожидание очереди',
            severity: 'warning',
            badge: '⏳',
          });
        }
        continue;
      }
      const prev = tok.value;
      tok.value = q;
      tok.waitingSidePort = undefined;
      machine.state.isWaitingSideExit = false;
      machine.state.waitTicks = 0;
      const remTok: Token = {
        id: `t_${world.nextTokenId++}`,
        value: r,
        prevValue: r,
        coord: { ...remCoord },
        prevCoord: { ...machine.coord },
        moveSource: 'split',
        spawnOrder: tok.spawnOrder,
      };
      world.tokens.set(remTok.id, remTok);
      machineActionOccurredThisTick = true;
      world.visitedHexes.add(hexKey(remCoord));
      machine.state.activeFlashTicks = 1;
      pushEvent(world, {
        type: 'transform',
        coord: machine.coord,
        message: `${prev} = ${b}·${q} + ${r}`,
        severity: 'info',
        badge: `${q} | ${r}`,
      });
    } else if (machine.type === 'halver') {
      const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
      if (isBonded) {
        triggerError(
          world,
          'Раскольник ½ делит только отдельные несвязанные числа',
          [machine.coord],
          'error',
        );
        return world;
      }
      const divRes = getExactDiv2(tok.value);
      if (!divRes.ok) {
        triggerError(
          world,
          `Число ${tok.value} нечётное — раскольник ½ не может разделить его поровну`,
          [machine.coord],
          'error',
        );
        return world;
      }
      const altCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const portState = getSidePortAvailability(altCoord);
      if (portState === 'blocked_static') {
        triggerError(
          world,
          'Нет свободного гекса для второй половины раскольника ½',
          [machine.coord, altCoord],
          'blocked',
        );
        return world;
      }
      if (portState === 'occupied_token') {
        tok.waitingSidePort = machine.id;
        machine.state.isWaitingSideExit = true;
        machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
        if (machine.state.waitTicks === 1) {
          pushEvent(world, {
            type: 'blocked',
            coord: machine.coord,
            relatedCoords: [altCoord],
            message: 'Боковой выход раскольника ½ занят — ожидание очереди',
            severity: 'warning',
            badge: '⏳',
          });
        }
        continue;
      }
      const prev = tok.value;
      const half = divRes.result;
      tok.value = half;
      tok.waitingSidePort = undefined;
      machine.state.isWaitingSideExit = false;
      machine.state.waitTicks = 0;
      const splitTok: Token = {
        id: `t_${world.nextTokenId++}`,
        value: half,
        prevValue: half,
        coord: { ...altCoord },
        prevCoord: { ...machine.coord },
        moveSource: 'split',
        spawnOrder: tok.spawnOrder,
      };
      world.tokens.set(splitTok.id, splitTok);
      machineActionOccurredThisTick = true;
      world.visitedHexes.add(hexKey(altCoord));
      machine.state.activeFlashTicks = 1;
      machine.state.lastActionTick = world.tick;
      pushEvent(world, {
        type: 'transform',
        coord: machine.coord,
        message: `Раскольник ½: ${prev} = ${half} + ${half}`,
        severity: 'success',
        badge: `${half} + ${half}`,
      });
    }
  }

  // Process Welders & Steam Lasers
  const updatedHexMap = new Map<HexKey, Token>();
  for (const t of world.tokens.values()) {
    updatedHexMap.set(hexKey(t.coord), t);
  }

  for (const machine of world.machines.values()) {
    if (machine.type === 'welder') {
      const tA = updatedHexMap.get(hexKey(machine.coord));
      const neighbor = hexNeighbor(machine.coord, machine.config.dir);
      const tB = updatedHexMap.get(hexKey(neighbor));
      if (tA && tB && hexDistance(tA.coord, tB.coord) === 1) {
        if (addBondCanonical(world, tA.id, tB.id)) {
          machineActionOccurredThisTick = true;
          machine.state.activeFlashTicks = 1;
          pushEvent(world, {
            type: 'weld',
            coord: machine.coord,
            message: `Сварка: [${tA.value} ━━ ${tB.value}]`,
            severity: 'success',
            relatedCoords: [machine.coord, neighbor],
            badge: 'СВАРКА',
          });
        }
      }
    } else if (machine.type === 'laser') {
      const tA = updatedHexMap.get(hexKey(machine.coord));
      const neighbor = hexNeighbor(machine.coord, machine.config.dir);
      const tB = updatedHexMap.get(hexKey(neighbor));
      if (tA && tB) {
        const [a, b] = tA.id < tB.id ? [tA.id, tB.id] : [tB.id, tA.id];
        const idx = world.bonds.findIndex((e) => e.a === a && e.b === b);
        if (idx !== -1) {
          world.bonds.splice(idx, 1);
          machineActionOccurredThisTick = true;
          machine.state.activeFlashTicks = 1;
          pushEvent(world, {
            type: 'cut',
            coord: machine.coord,
            message: `Лазер разрезал связь [${tA.value} -/- ${tB.value}]`,
            severity: 'info',
            relatedCoords: [machine.coord, neighbor],
            badge: 'РАЗРЕЗ',
          });
        }
      }
    }
  }

  // Process Destroyers (recycles any token or bonded polymer touching the shredder hex)
  const postMoveComponents = getConnectedComponents(world);
  const compByTokenAfterMove = new Map<string, ConnectedComponent>();
  for (const c of postMoveComponents) {
    for (const id of c.tokenIds) compByTokenAfterMove.set(id, c);
  }
  const destroyedCompIds = new Set<string>();
  for (const machine of world.machines.values()) {
    if (machine.type !== 'destroyer') continue;
    const victim = Array.from(world.tokens.values()).find((t) => hexEqual(t.coord, machine.coord));
    if (!victim) continue;
    const comp = compByTokenAfterMove.get(victim.id);
    if (!comp || destroyedCompIds.has(comp.id)) continue;
    destroyedCompIds.add(comp.id);
    const compSet = new Set(comp.tokenIds);
    const vals = comp.tokenIds.map((id) => world.tokens.get(id)?.value ?? 0);
    for (const id of comp.tokenIds) {
      const deadTok = world.tokens.get(id);
      if (deadTok) recordConsumed(deadTok, 'destroy');
      world.tokens.delete(id);
    }
    for (const b of world.bonds) {
      if (compSet.has(b.a) || compSet.has(b.b)) {
        world.consumedBonds!.push({ ...b });
      }
    }
    world.bonds = world.bonds.filter((b) => !compSet.has(b.a) && !compSet.has(b.b));
    machineActionOccurredThisTick = true;
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;
    pushEvent(world, {
      type: 'destroy',
      coord: machine.coord,
      message: `Утилизатор × переработал: [${vals.join(' ━━ ')}]`,
      severity: 'warning',
      badge: '×',
    });
  }

  // Guard against cutting/spawning leaving an unsupported token over a narrow fissure
  if (world.narrowGapHexes.size > 0) {
    const gapComponents = getConnectedComponents(world);
    for (const comp of gapComponents) {
      const compToks = comp.tokenIds.map((id) => world.tokens.get(id)!);
      const overGap = compToks.filter((t) => world.narrowGapHexes.has(hexKey(t.coord)));
      if (overGap.length === 0) continue;
      const hasSolidAnchor =
        compToks.length >= 2 &&
        compToks.some((t) => {
          const k = hexKey(t.coord);
          return world.platformHexes.has(k) && !world.narrowGapHexes.has(k);
        });
      if (!hasSolidAnchor) {
        world.fallingTokens = overGap.map((t) => ({
          value: t.value,
          fromCoord: { ...t.prevCoord },
          toCoord: { ...t.coord },
        }));
        triggerError(
          world,
          'Сфера провалилась в узкий разлом: после разреза или спавна не осталось опоры на твёрдой плитке',
          overGap.map((t) => t.coord),
          'collision',
        );
        return world;
      }
    }
  }

  // Phase 5: Delivery & Victory Check
  const DIRECT_DRIVE_MACHINE_TYPES: ReadonlySet<MachineType> = new Set([
    'conveyor',
    'add1',
    'sub1',
    'mul2',
    'div2',
    'sqrt',
    'neg',
    'dup',
    'adder',
    'filter',
    'splitter',
    'divmod',
    'halver',
    'scales',
    'jumper',
    'destroyer',
  ]);
  const hasNextTickDrive = (compToks: Token[]): boolean => {
    for (const tok of compToks) {
      const onMachine = world.machines.get(hexKey(tok.coord));
      if (onMachine && DIRECT_DRIVE_MACHINE_TYPES.has(onMachine.type)) {
        return true;
      }
    }
    for (const m of world.machines.values()) {
      if (m.type === 'pusher') {
        const target = hexNeighbor(m.coord, m.config.dir);
        if (compToks.some((t) => hexEqual(t.coord, target))) return true;
      } else if (m.type === 'magnet') {
        const d1 = hexNeighbor(m.coord, m.config.dir);
        const d2 = hexNeighbor(d1, m.config.dir);
        const d1Busy = Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, d1));
        if (!d1Busy && compToks.some((t) => hexEqual(t.coord, d2))) return true;
      } else if (m.type === 'rotator') {
        const grabHex = hexNeighbor(m.coord, m.config.dir);
        if (compToks.some((t) => hexEqual(t.coord, grabHex))) return true;
      } else if (m.type === 'swapper') {
        const a = hexNeighbor(m.coord, m.config.dir);
        const b = hexNeighbor(m.coord, oppositeDir(m.config.dir));
        if (compToks.some((t) => hexEqual(t.coord, a) || hexEqual(t.coord, b))) return true;
      }
    }
    return false;
  };
  const hasPendingWelderOrLaserInteraction = (compToks: Token[]): boolean => {
    let touchesEdgeTool = false;
    for (const m of world.machines.values()) {
      if (m.type !== 'welder' && m.type !== 'laser') continue;
      const other = hexNeighbor(m.coord, m.config.dir);
      if (compToks.some((t) => hexEqual(t.coord, m.coord) || hexEqual(t.coord, other))) {
        touchesEdgeTool = true;
        break;
      }
    }
    if (!touchesEdgeTool) return false;
    if (world.tokens.size > compToks.length) return true;
    for (const m of world.machines.values()) {
      if (m.type === 'spawner') {
        const seq = m.config.sequence ?? [];
        if (seq.length > 0 && (m.config.loopSequence || m.state.spawnIndex < seq.length)) {
          return true;
        }
      }
    }
    return false;
  };

  const postComponents = getConnectedComponents(world);
  for (const comp of postComponents) {
    for (const machine of world.machines.values()) {
      if (machine.type !== 'sink' || !machine.config.targetPattern) continue;
      const pattern = machine.config.targetPattern;
      const sinkId = machine.config.sinkId ?? machine.id;

      // Check if component overlaps this sink's footprint
      const sinkFootprint = pattern.nodes.map((n) => ({
        q: machine.coord.q + n.offset.q,
        r: machine.coord.r + n.offset.r,
      }));
      const compTokens = comp.tokenIds.map((id) => world.tokens.get(id)!);
      const anyOnSink = compTokens.some((t) =>
        sinkFootprint.some((f) => hexEqual(t.coord, f)),
      );
      if (!anyOnSink) continue;

      const hist = world.sinkDeliveries[sinkId] ?? [];
      const matchRes = matchComponentToPattern(comp, world, machine.coord, pattern, hist.length);
      if (matchRes.matched) {
        const deliveredVals = matchRes.matchedValues ?? compTokens.map((t) => t.value);

        // If sink has expectedValues sequence, verify expected item
        if (pattern.expectedValues && pattern.expectedValues.length > 0) {
          const stepIdx = hist.length;
          if (stepIdx >= pattern.expectedValues.length) {
            triggerError(
              world,
              `Лишняя доставка в приёмник (${deliveredVals.join(', ')})`,
              [machine.coord],
              'error',
            );
            return world;
          }
          if (
            deliveredVals.length === 1 &&
            deliveredVals[0] !== pattern.expectedValues[stepIdx]
          ) {
            triggerError(
              world,
              `Приёмник ожидал ${pattern.expectedValues[stepIdx]}, получено ${deliveredVals[0]}`,
              [machine.coord],
              'error',
            );
            return world;
          }
        }
        if (pattern.expectedNodeValues && pattern.expectedNodeValues.length > 0) {
          if (hist.length >= pattern.expectedNodeValues.length) {
            triggerError(
              world,
              `Лишняя доставка полимера в приёмник ([${deliveredVals.join(' ━━ ')}])`,
              [machine.coord],
              'error',
            );
            return world;
          }
        }

        // Remove all tokens in the matched component & their bonds
        const compSet = new Set(comp.tokenIds);
        for (const id of comp.tokenIds) {
          const delTok = world.tokens.get(id);
          if (delTok) recordConsumed(delTok, 'deliver');
          world.tokens.delete(id);
        }
        for (const b of world.bonds) {
          if (compSet.has(b.a) || compSet.has(b.b)) {
            world.consumedBonds!.push({ ...b });
          }
        }
        world.bonds = world.bonds.filter((b) => !compSet.has(b.a) && !compSet.has(b.b));

        if (!world.sinkDeliveries[sinkId]) {
          world.sinkDeliveries[sinkId] = [];
        }
        world.sinkDeliveries[sinkId].push(deliveredVals);
        world.deliveredCount += 1;
        machine.state.activeFlashTicks = 2;

        pushEvent(world, {
          type: 'deliver',
          coord: machine.coord,
          message: `Доставлено: [${deliveredVals.join(' ━━ ')}] (${world.deliveredCount}/${world.infiniteMode ? '∞' : world.requiredDeliveries})`,
          severity: 'success',
          badge: `✓ ${deliveredVals.join('·')}`,
        });
        break;
      } else {
        const allFootprintCovered = sinkFootprint.every((f) =>
          compTokens.some((t) => hexEqual(t.coord, f)),
        );
        const isScalarSinkWrongVal =
          pattern.nodes.length === 1 &&
          compTokens.length === 1 &&
          hexEqual(compTokens[0].coord, machine.coord);
        const isStalledMismatch =
          !hasNextTickDrive(compTokens) && !hasPendingWelderOrLaserInteraction(compTokens);
        if (allFootprintCovered || isScalarSinkWrongVal || isStalledMismatch) {
          triggerError(
            world,
            `Приёмник отклонил структуру: ${matchRes.reason ?? 'неверный образец'}`,
            compTokens.map((t) => t.coord),
            'error',
          );
          return world;
        }
      }
    }
  }

  if (!world.infiniteMode && world.requiredDeliveries > 0 && world.deliveredCount >= world.requiredDeliveries) {
    world.status = 'victory';
    pushEvent(world, {
      type: 'deliver',
      coord: { q: 0, r: 0 },
      message: `Цель выполнена за ${world.tick} тактов!`,
      severity: 'success',
    });
  }

  // Deadlock check for waiting side-port queues: if machines are holding tokens on blocked altDir
  // while zero tokens moved/transformed, no non-waiting component has drive, and no spawner can emit
  if (world.status === 'running' && !machineActionOccurredThisTick && world.tokens.size > 0) {
    const waitingMachines = Array.from(world.machines.values()).filter(
      (m) => m.state.isWaitingSideExit,
    );
    if (waitingMachines.length > 0) {
      const anyActiveSpawnerPending = Array.from(world.machines.values()).some((m) => {
        if (m.type !== 'spawner') return false;
        const seq = m.config.sequence ?? [];
        if (seq.length === 0) return false;
        const hasMore = m.config.loopSequence || m.state.spawnIndex < seq.length;
        if (!hasMore) return false;
        const out = hexNeighbor(m.coord, m.config.dir);
        const outFree = !Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, out));
        return outFree;
      });
      const anyNonWaitingDriven = postComponents.some((comp) => {
        const compToks = comp.tokenIds.map((id) => world.tokens.get(id)!);
        if (compToks.some((t) => t.waitingSidePort)) return false;
        return hasNextTickDrive(compToks);
      });
      if (!anyActiveSpawnerPending && !anyNonWaitingDriven) {
        triggerError(
          world,
          'Затор на боковом выходе станка: соседний гекс занят и поток остановился',
          waitingMachines.map((m) => m.coord),
          'blocked',
        );
        return world;
      }
    }
  }

  if (!world.infiniteMode && world.status === 'running' && world.tick >= MAX_SIMULATION_TICKS) {
    triggerError(
      world,
      `Цикл не завершился за отведённое время (${MAX_SIMULATION_TICKS} тактов) — проверьте условие выхода фильтра`,
      Array.from(world.tokens.values()).map((t) => t.coord),
      'error',
    );
    return world;
  }

  return world;
}

export function runUntilComplete(
  world: SimulationWorld,
  maxTicks = MAX_SIMULATION_TICKS,
): { world: SimulationWorld; check: LevelGoalCheck } {
  while (
    world.tick < maxTicks &&
    world.status !== 'victory' &&
    world.status !== 'error'
  ) {
    stepSimulation(world);
  }
  if (world.status === 'victory') {
    return { world, check: { passed: true } };
  }
  return {
    world,
    check: {
      passed: false,
      reason:
        world.errorReason ??
        `Превышен лимит ${maxTicks} тактов (${world.deliveredCount}/${world.requiredDeliveries}) — проверьте условие выхода из цикла или доставку`,
    },
  };
}

export function verifyLevelSolution(
  level: LevelDefinition,
  playerMachines: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }>,
  maxTicks = MAX_SIMULATION_TICKS,
): VerificationReport {
  const placementErrors = validateLevelPlacement(level, playerMachines);
  if (placementErrors.length > 0) {
    return { passed: 0, total: 1, results: [{ name: 'Проверка размещения', passed: false, ticks: 0, reason: placementErrors.join('; ') }] };
  }
  if (level.infiniteMode) {
    return { passed: 0, total: 0, results: [] };
  }

  const results: VerificationRunResult[] = [];
  if (level.verificationRuns && level.verificationRuns.length > 0) {
    for (const vr of level.verificationRuns) {
      const vw = createWorldFromLevel(
        level,
        playerMachines,
        vr.spawnerOverrides,
        vr.expectedSinkValues,
        vr.expectedSinkPolymers,
      );
      const { world, check } = runUntilComplete(vw, maxTicks);
      results.push({
        name: vr.name,
        passed: check.passed,
        ticks: world.tick,
        reason: check.reason,
      });
    }
  } else {
    const w = createWorldFromLevel(level, playerMachines);
    const { world, check } = runUntilComplete(w, maxTicks);
    results.push({
      name: 'Основной поток',
      passed: check.passed,
      ticks: world.tick,
      reason: check.reason,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  return { passed, total: results.length, results };
}
