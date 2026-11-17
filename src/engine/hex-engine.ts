import { processMechanisms } from './mechanisms';
import { computeMovementIntents } from './movement-intents';
import { resolveMovement } from './collisions';
import { pushEvent, triggerError } from './events';
import { finishSimulationTick } from './delivery';
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

import { MAX_SIMULATION_TICKS } from './simulation-constants';
export { MAX_SIMULATION_TICKS } from './simulation-constants';

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

  const intentsByComp = computeMovementIntents(world, components, tokenToComponent, tokenAtHex);
  if (!intentsByComp) return world;

  const movement = resolveMovement(world, components, tokenToComponent, intentsByComp);
  if (!movement) return world;
  const { resolvedIntentByComp, proposedCoordByToken, rotationInfoByToken } = movement;

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

  const machineActionOccurredThisTick = processMechanisms(world, movedTokenIds, recordConsumed);
  if (machineActionOccurredThisTick === null) return world;
  return finishSimulationTick(world, machineActionOccurredThisTick, recordConsumed);
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
