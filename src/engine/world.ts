import { generateHexDisk, hexKey } from './hex-math';
import { MIN_INT_VALUE, MAX_INT_VALUE } from './operations';
import {
  getMachineFootprint,
  issue,
  issueCoords,
  issueMessages,
  lintPattern,
  resolveFinalPlacement,
  validateLevelFootprintIssues,
  type PlacementIssue,
} from './placement-validation';
import type { AxialCoord, HexKey, LevelDefinition, MachineConfig, MachineInstance, MachineType, SimulationWorld } from './types';

export { getMachineFootprint, getMachineOccupiedHexes } from './placement-validation';
export type { PlacedMachine } from './placement-validation';

export const SOLID_MACHINE_TYPES: ReadonlySet<MachineType> = new Set([
  'spawner',
  'pusher',
  'magnet',
  'rotator',
  'swapper',
]);

/**
 * Total config sanitiser. Machine configs come from level data and persisted
 * saves, so a missing or malformed config must degrade to a usable default
 * instead of throwing while a world (or an error world) is being built.
 */
function cloneMachineConfig(config: MachineConfig | undefined | null): MachineConfig {
  const source = (config ?? {}) as Partial<MachineConfig>;
  const dir = Number.isInteger(source.dir) && source.dir! >= 0 && source.dir! <= 5 ? source.dir! : 0;
  const altDir = Number.isInteger(source.altDir) && source.altDir! >= 0 && source.altDir! <= 5
    ? source.altDir!
    : undefined;
  const pattern = source.targetPattern;
  return {
    ...source,
    dir,
    altDir,
    sequence: Array.isArray(source.sequence) ? [...source.sequence] : undefined,
    // Cloned defensively: a corrupted persisted pattern used to throw here.
    targetPattern: pattern
      ? {
          ...pattern,
          nodes: Array.isArray(pattern.nodes)
            ? pattern.nodes.map((n) => ({ offset: { ...n?.offset }, value: n?.value }))
            : [],
          edges: Array.isArray(pattern.edges)
            ? pattern.edges.map((e) => ({ ...e }))
            : [],
          expectedValues: Array.isArray(pattern.expectedValues) ? [...pattern.expectedValues] : undefined,
          expectedNodeValues: Array.isArray(pattern.expectedNodeValues)
            ? pattern.expectedNodeValues.map((row) => [...row])
            : undefined,
          ladderStep: pattern.ladderStep ? { ...pattern.ladderStep } : undefined,
        }
      : undefined,
  };
}

export function createMachineInstance(
  id: string,
  type: MachineType,
  coord: AxialCoord,
  locked: boolean,
  config: MachineConfig,
): MachineInstance {
  return {
    id,
    type,
    coord: { ...coord },
    locked,
    config: cloneMachineConfig(config),
    state: {
      spawnIndex: 0,
      cooldown: 0,
      memory: null,
      activeFlashTicks: 0,
      lastActionTick: -1,
    },
  };
}

function addSinkFootprintEntries(
  sinkFootprintHexes: Map<HexKey, string>,
  machineId: string,
  machine: { type: MachineType; coord: AxialCoord; config: MachineConfig },
) {
  if (machine.type !== 'sink') return;
  for (const pad of getMachineFootprint(machine)) {
    sinkFootprintHexes.set(hexKey(pad), machineId);
  }
}

export function getBlockedPlacementInfo(
  world: SimulationWorld,
  coord: AxialCoord,
  options?: { allowedOwnerId?: string },
): { blocked: boolean; reason?: string } {
  const key = hexKey(coord);
  if (!world.platformHexes.has(key)) {
    return { blocked: true, reason: 'Нельзя разместить блок над разломом платформы.' };
  }
  if (world.narrowGapHexes.has(key)) {
    return {
      blocked: true,
      reason: 'Над узким разломом нельзя ставить механизм — через него пройдёт только сцепленный полимер (2+ сферы).',
    };
  }
  const padOwnerId = world.sinkFootprintHexes.get(key);
  if (padOwnerId && padOwnerId !== options?.allowedOwnerId) {
    return {
      blocked: true,
      reason: 'Клетка занята посадочной площадкой приёмника — механизмы здесь ставить нельзя.',
    };
  }
  if (world.machines.get(key)?.locked) {
    return {
      blocked: true,
      reason: 'Целевой гекс занят фиксированным модулем уровня.',
    };
  }
  return { blocked: false };
}

/**
 * Structured placement validation. Each issue names the exact cells involved,
 * so the UI can highlight the offending pad or overlap rather than every
 * unlocked machine.
 */
export function validateLevelPlacementIssues(
  level: LevelDefinition,
  blocks: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }>,
): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  const baseWorld = createWorldFromLevel(level, []);
  const seen = new Set<HexKey>();
  const counts: Partial<Record<MachineType, number>> = {};

  (blocks ?? []).forEach((b, index) => {
    if (!b || !b.coord || !b.config || !Number.isInteger(b.coord.q) || !Number.isInteger(b.coord.r)) {
      issues.push(issue('invalid-data', 'Некорректные данные механизма или координаты', [], index));
      return;
    }
    const key = hexKey(b.coord);
    const at = (message: string, coords: AxialCoord[] = [b.coord]) =>
      issue('invalid-data', message, coords, index);

    if (b.type === 'sink') {
      // A receiver without a usable pattern would silently become a single-hex
      // sink in the world, so reject it while the layout is still being checked.
      if (!b.config.targetPattern) {
        issues.push(at(`Приёмник на (${b.coord.q}, ${b.coord.r}) не содержит образца`));
      } else {
        for (const patternError of lintPattern(b.config.targetPattern)) {
          issues.push(
            issue(
              'invalid-pattern',
              `Приёмник на (${b.coord.q}, ${b.coord.r}): ${patternError}`,
              [b.coord],
              index,
            ),
          );
        }
      }
    }
    if (!Number.isInteger(b.config.dir) || b.config.dir < 0 || b.config.dir > 5 ||
      (b.config.altDir !== undefined && (!Number.isInteger(b.config.altDir) || b.config.altDir < 0 || b.config.altDir > 5))) {
      issues.push(
        issue(
          'invalid-direction',
          `Некорректное направление механизма на (${b.coord.q}, ${b.coord.r})`,
          [b.coord],
          index,
        ),
      );
    }
    if (!level.availableTools.includes(b.type)) {
      issues.push(
        issue('tool-unavailable', `Механизм ${b.type} недоступен на этом уровне`, [b.coord], index),
      );
    }
    if (seen.has(key)) {
      issues.push(
        issue(
          'duplicate',
          `Дублирующая установка механизма на гексе (${b.coord.q}, ${b.coord.r})`,
          [b.coord],
          index,
        ),
      );
      return;
    }
    seen.add(key);

    if (!baseWorld.platformHexes.has(key)) {
      issues.push(
        issue(
          'outside-platform',
          `Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) находится вне платформы`,
          [b.coord],
          index,
        ),
      );
    } else if (baseWorld.narrowGapHexes.has(key)) {
      issues.push(
        issue(
          'narrow-chasm',
          `Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) установлен над узким разломом`,
          [b.coord],
          index,
        ),
      );
    } else if (baseWorld.machines.get(key)?.locked) {
      issues.push(
        issue(
          'locked-fixture',
          `Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) перекрывает фиксированный модуль`,
          [b.coord],
          index,
        ),
      );
    }

    counts[b.type] = (counts[b.type] ?? 0) + 1;
  });

  // Full-space check: every occupied cell of every object in the final
  // arrangement, so multi-hex receivers cannot lose a side pad to a block.
  issues.push(
    ...validateLevelFootprintIssues(level, blocks ?? [], baseWorld.platformHexes, baseWorld.narrowGapHexes),
  );

  const blockCount = (blocks ?? []).length;
  if (level.maxTotalBlocks !== undefined && blockCount > level.maxTotalBlocks) {
    issues.push(
      issue(
        'total-limit',
        `Превышен общий лимит блоков: ${blockCount} > ${level.maxTotalBlocks}`,
        (blocks ?? []).map((b) => b?.coord).filter((c): c is AxialCoord => Boolean(c)),
      ),
    );
  }
  if (level.partLimits) {
    for (const [tool, limit] of Object.entries(level.partLimits)) {
      const used = counts[tool as MachineType] ?? 0;
      if (limit !== undefined && used > limit) {
        issues.push(
          issue(
            'part-limit',
            `Превышен лимит ${tool}: ${used} > ${limit}`,
            (blocks ?? [])
              .filter((b) => b?.type === (tool as MachineType) && Boolean(b?.coord))
              .map((b) => b.coord),
          ),
        );
      }
    }
  }

  return issues;
}

export function validateLevelPlacement(
  level: LevelDefinition,
  blocks: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }>,
): string[] {
  return issueMessages(validateLevelPlacementIssues(level, blocks));
}

/**
 * Builds the world for a layout the player is still editing, without hiding it.
 *
 * The declared machines are kept on the board even when they conflict, so the
 * player can see and repair them, while the world is marked as an error world
 * (which blocks simulation). Only the cells named by the validator are
 * highlighted, and the precise list is exposed through `placementIssues`.
 */
export function createEditableWorldFromLevel(
  level: LevelDefinition,
  playerMachines: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }>,
): SimulationWorld {
  const issues = playerMachines?.length ? validateLevelPlacementIssues(level, playerMachines) : [];
  if (issues.length === 0) {
    const world = createWorldFromLevel(level, playerMachines);
    world.placementIssues = [];
    return world;
  }

  const world = createWorldFromLevel(level, [], undefined, undefined, undefined);
  const finalPlacement = resolveFinalPlacement(level, playerMachines, undefined, new Set(), {
    dropConflicts: false,
  });
  const machines = new Map<HexKey, MachineInstance>();
  const sinkFootprintHexes = new Map<HexKey, string>();
  let machineSeq = 1;
  for (const machine of finalPlacement) {
    const inst = createMachineInstance(
      `m_${machineSeq++}`,
      machine.type,
      machine.coord,
      machine.locked,
      machine.config,
    );
    machines.set(hexKey(machine.coord), inst);
    addSinkFootprintEntries(sinkFootprintHexes, inst.id, inst);
  }

  world.machines = machines;
  world.sinkFootprintHexes = sinkFootprintHexes;
  world.status = 'error';
  world.errorReason = issueMessages(issues).join('; ');
  world.errorHighlightHexes = issueCoords(issues);
  world.placementIssues = issues;
  return world;
}

export function createWorldFromLevel(
  level: LevelDefinition,
  playerMachines: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }> = [],
  spawnerOverrides?: Record<HexKey, { sequence: number[]; spawnInterval?: number }>,
  expectedSinkValues?: Record<string, number[]>,
  expectedSinkPolymers?: Record<string, number[][]>,
): SimulationWorld {
  // Empty layouts are used as the placement reference by validation itself.
  const placementErrors = playerMachines.length ? validateLevelPlacement(level, playerMachines) : [];
  if (placementErrors.length) {
    const world = createWorldFromLevel(level, [], spawnerOverrides, expectedSinkValues, expectedSinkPolymers);
    world.status = 'error';
    world.errorReason = placementErrors.join('; ');
    return world;
  }
  const hexes = level.customHexes ?? generateHexDisk(level.radius);
  const platformHexes = new Set<HexKey>(hexes.map(hexKey));
  const narrowGapHexes = new Set<HexKey>((level.narrowGaps ?? []).map(hexKey));
  for (const gk of narrowGapHexes) {
    platformHexes.add(gk);
  }
  const machines = new Map<HexKey, MachineInstance>();
  const sinkFootprintHexes = new Map<HexKey, string>();
  const visitedHexes = new Set<HexKey>();

  // Build from the definitive arrangement: exactly the machines the validators
  // inspected, in the same order, so presets are never resurrected behind a
  // player replacement and IDs stay predictable (m_1, m_2, …).
  const finalPlacement = resolveFinalPlacement(level, playerMachines, platformHexes, narrowGapHexes);

  let machineSeq = 1;
  for (const machine of finalPlacement) {
    const key = hexKey(machine.coord);
    let cfg: MachineConfig = machine.config;

    if (machine.origin.startsWith('preset:')) {
      const presetIndex = Number(machine.origin.slice('preset:'.length));
      const presetConfig = level.presetMachines[presetIndex]?.config ?? machine.config;
      const override = spawnerOverrides?.[key];
      if (override) {
        cfg = {
          ...presetConfig,
          sequence: [...override.sequence],
          spawnInterval: override.spawnInterval ?? presetConfig.spawnInterval,
        };
      } else {
        cfg = presetConfig;
      }
    } else if (machine.type === 'divmod' && level.fixedDivisor !== undefined) {
      cfg = { ...machine.config, divisor: level.fixedDivisor };
    }

    if (machine.type === 'sink' && cfg.sinkId && cfg.targetPattern) {
      const expVals = expectedSinkValues?.[cfg.sinkId];
      const expPolys = expectedSinkPolymers?.[cfg.sinkId];
      if (expVals || expPolys) {
        cfg = {
          ...cfg,
          targetPattern: {
            ...cfg.targetPattern,
            expectedValues: expVals ? [...expVals] : cfg.targetPattern.expectedValues,
            expectedNodeValues: expPolys
              ? expPolys.map((p) => [...p])
              : cfg.targetPattern.expectedNodeValues,
          },
        };
      }
    }

    const inst = createMachineInstance(`m_${machineSeq++}`, machine.type, machine.coord, machine.locked, cfg);
    machines.set(key, inst);
    addSinkFootprintEntries(sinkFootprintHexes, inst.id, inst);
    if (!machine.origin.startsWith('preset:')) {
      visitedHexes.add(key);
    }
  }

  let requiredDeliveries = level.requiredDeliveries;
  if (expectedSinkValues) {
    const totalExpected = Object.values(expectedSinkValues).reduce((sum, arr) => sum + arr.length, 0);
    if (totalExpected > 0) {
      requiredDeliveries = totalExpected;
    }
  } else if (expectedSinkPolymers) {
    const totalExpected = Object.values(expectedSinkPolymers).reduce((sum, arr) => sum + arr.length, 0);
    if (totalExpected > 0) {
      requiredDeliveries = totalExpected;
    }
  }

  return {
    tick: 0,
    status: 'idle',
    platformHexes,
    narrowGapHexes,
    sinkFootprintHexes,
    machines,
    tokens: new Map(),
    bonds: [],
    events: [],
    nextEventId: 1,
    deliveredCount: 0,
    requiredDeliveries,
    infiniteMode: Boolean(level.infiniteMode),
    sinkDeliveries: {},
    visitedHexes,
    errorHighlightHexes: [],
    errorReason: null,
    fallingTokens: [],
    nextTokenId: 1,
    nextSpawnOrder: 1,
    minValue: MIN_INT_VALUE,
    maxValue: MAX_INT_VALUE,
  };
}

