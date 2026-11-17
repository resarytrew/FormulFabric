import { MAX_SIMULATION_TICKS } from './simulation-constants';
import { applyMovement } from './movement-apply';
import { processMechanisms } from './mechanisms';
import { computeMovementIntents } from './movement-intents';
import { resolveMovement } from './collisions';
import { finishSimulationTick } from './delivery';
import { getConnectedComponents, type ConnectedComponent } from './components';
export { getConnectedComponents, type ConnectedComponent } from './components';
export { getRotationSweptHexes } from './rotation';
export { matchComponentToPattern } from './patterns';
import { validateLevelPlacement, createWorldFromLevel } from './world';
export { SOLID_MACHINE_TYPES, createMachineInstance, getMachineFootprint, getMachineOccupiedHexes, getBlockedPlacementInfo, validateLevelPlacement, createWorldFromLevel } from './world';
export {
  checkFootprintOverlaps,
  checkFootprintPlacement,
  lintPattern,
  getMachineConfig,
  isValidCoord,
  resolveFinalPlacement,
  validateLevelFootprints,
  type FinalMachine,
  type PlacedMachine,
} from './placement-validation';
export { findLayoutConflicts, findLayoutConflictsForLevel, type StoredBlock } from './layout-conflicts';
export { MIN_INT_VALUE, MAX_INT_VALUE, evaluateFilterRule, isInRange, getExactDiv2, getExactSqrt, euclideanDivMod } from './operations';
import { hexKey } from './hex-math';
import type {
  AxialCoord,
  HexKey,
  LevelDefinition,
  LevelGoalCheck,
  MachineConfig,
  MachineType,
  SimulationWorld,
  Token,
  VerificationReport,
  VerificationRunResult,
} from './types';

export function cloneWorld(world: SimulationWorld): SimulationWorld {
  return structuredClone(world);
}

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

  const movedTokenIds = applyMovement(world, components, tokenToComponent, resolvedIntentByComp, proposedCoordByToken, rotationInfoByToken);

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
    // A caller may invoke verification directly, without first completing the
    // visible stream in the UI. Always check that stream as well.
    const primary = runUntilComplete(createWorldFromLevel(level, playerMachines), maxTicks);
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
    if (!primary.check.passed) {
      results.push({ name: 'Основной поток', passed: false, ticks: primary.world.tick, reason: primary.check.reason });
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
