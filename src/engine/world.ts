import { generateHexDisk, hexKey } from './hex-math';
import { MIN_INT_VALUE, MAX_INT_VALUE } from './operations';
import type { AxialCoord, HexKey, LevelDefinition, MachineConfig, MachineInstance, MachineType, SimulationWorld } from './types';

export const SOLID_MACHINE_TYPES: ReadonlySet<MachineType> = new Set([
  'spawner',
  'pusher',
  'magnet',
  'rotator',
  'swapper',
]);

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
    config: {
      ...config,
      sequence: config.sequence ? [...config.sequence] : undefined,
      targetPattern: config.targetPattern
        ? {
            ...config.targetPattern,
            nodes: config.targetPattern.nodes.map((n) => ({
              offset: { ...n.offset },
              value: n.value,
            })),
            edges: config.targetPattern.edges.map((e) => ({ ...e })),
            expectedValues: config.targetPattern.expectedValues
              ? [...config.targetPattern.expectedValues]
              : undefined,
            expectedNodeValues: config.targetPattern.expectedNodeValues
              ? config.targetPattern.expectedNodeValues.map((row) => [...row])
              : undefined,
            ladderStep: config.targetPattern.ladderStep
              ? { ...config.targetPattern.ladderStep }
              : undefined,
          }
        : undefined,
    },
    state: {
      spawnIndex: 0,
      cooldown: 0,
      memory: null,
      activeFlashTicks: 0,
      lastActionTick: -1,
    },
  };
}

export function getMachineFootprint(machine: {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
}): AxialCoord[] {
  if (
    machine.type === 'sink' &&
    machine.config.targetPattern &&
    machine.config.targetPattern.nodes.length > 0
  ) {
    return machine.config.targetPattern.nodes.map((n) => ({
      q: machine.coord.q + n.offset.q,
      r: machine.coord.r + n.offset.r,
    }));
  }
  return [{ ...machine.coord }];
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
  if (world.sinkFootprintHexes.has(key)) {
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

export function validateLevelPlacement(
  level: LevelDefinition,
  blocks: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }>,
): string[] {
  const errors: string[] = [];
  const baseWorld = createWorldFromLevel(level, []);
  const seen = new Set<HexKey>();
  const counts: Partial<Record<MachineType, number>> = {};

  for (const b of blocks) {
    if (!b || !b.coord || !b.config || !Number.isInteger(b.coord.q) || !Number.isInteger(b.coord.r)) {
      errors.push('Некорректные данные механизма или координаты');
      continue;
    }
    const key = hexKey(b.coord);
    if (!Number.isInteger(b.config.dir) || b.config.dir < 0 || b.config.dir > 5 ||
      (b.config.altDir !== undefined && (!Number.isInteger(b.config.altDir) || b.config.altDir < 0 || b.config.altDir > 5))) {
      errors.push(`Некорректное направление механизма на (${b.coord.q}, ${b.coord.r})`);
    }
    if (!level.availableTools.includes(b.type)) {
      errors.push(`Механизм ${b.type} недоступен на этом уровне`);
    }
    if (seen.has(key)) {
      errors.push(`Дублирующая установка механизма на гексе (${b.coord.q}, ${b.coord.r})`);
      continue;
    }
    seen.add(key);

    if (!baseWorld.platformHexes.has(key)) {
      errors.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) находится вне платформы`);
    } else if (baseWorld.narrowGapHexes.has(key)) {
      errors.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) установлен над узким разломом`);
    } else if (baseWorld.sinkFootprintHexes.has(key)) {
      errors.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) перекрывает зону приёмника`);
    } else if (baseWorld.machines.get(key)?.locked) {
      errors.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) перекрывает фиксированный модуль`);
    }

    counts[b.type] = (counts[b.type] ?? 0) + 1;
  }

  if (level.maxTotalBlocks !== undefined && blocks.length > level.maxTotalBlocks) {
    errors.push(`Превышен общий лимит блоков: ${blocks.length} > ${level.maxTotalBlocks}`);
  }
  if (level.partLimits) {
    for (const [tool, limit] of Object.entries(level.partLimits)) {
      const used = counts[tool as MachineType] ?? 0;
      if (limit !== undefined && used > limit) {
        errors.push(`Превышен лимит ${tool}: ${used} > ${limit}`);
      }
    }
  }

  return errors;
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

  let machineSeq = 1;
  for (const pm of level.presetMachines) {
    const key = hexKey(pm.coord);
    const override = spawnerOverrides?.[key];
    let cfg: MachineConfig = override
      ? {
          ...pm.config,
          sequence: [...override.sequence],
          spawnInterval: override.spawnInterval ?? pm.config.spawnInterval,
        }
      : pm.config;

    if (pm.type === 'sink' && pm.config.sinkId && pm.config.targetPattern) {
      const expVals = expectedSinkValues?.[pm.config.sinkId];
      const expPolys = expectedSinkPolymers?.[pm.config.sinkId];
      if (expVals || expPolys) {
        cfg = {
          ...cfg,
          targetPattern: {
            ...pm.config.targetPattern,
            expectedValues: expVals ? [...expVals] : pm.config.targetPattern.expectedValues,
            expectedNodeValues: expPolys
              ? expPolys.map((p) => [...p])
              : pm.config.targetPattern.expectedNodeValues,
          },
        };
      }
    }

    const inst = createMachineInstance(`m_${machineSeq++}`, pm.type, pm.coord, pm.locked, cfg);
    machines.set(key, inst);
    addSinkFootprintEntries(sinkFootprintHexes, inst.id, inst);
  }

  const visitedHexes = new Set<HexKey>();
  for (const um of playerMachines) {
    const key = hexKey(um.coord);
    if (!platformHexes.has(key) || narrowGapHexes.has(key) || sinkFootprintHexes.has(key)) {
      continue;
    }
    const existing = machines.get(key);
    if (existing?.locked) continue;
    let cfg = um.config;
    if (um.type === 'divmod' && level.fixedDivisor !== undefined) {
      cfg = { ...cfg, divisor: level.fixedDivisor };
    }
    if (um.type === 'sink' && um.config.sinkId && um.config.targetPattern) {
      const expVals = expectedSinkValues?.[um.config.sinkId];
      const expPolys = expectedSinkPolymers?.[um.config.sinkId];
      if (expVals || expPolys) {
        cfg = {
          ...cfg,
          targetPattern: {
            ...um.config.targetPattern,
            expectedValues: expVals ? [...expVals] : um.config.targetPattern.expectedValues,
            expectedNodeValues: expPolys
              ? expPolys.map((p) => [...p])
              : um.config.targetPattern.expectedNodeValues,
          },
        };
      }
    }
    const inst = createMachineInstance(`m_${machineSeq++}`, um.type, um.coord, false, cfg);
    machines.set(key, inst);
    addSinkFootprintEntries(sinkFootprintHexes, inst.id, inst);
    visitedHexes.add(key);
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

