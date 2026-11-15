import {
  hexDistance,
  hexEqual,
  hexKey,
  hexNeighbor,
  oppositeDir,
  rotateAroundPivot,
  rotateDir,
  generateHexDisk,
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

export const MIN_INT_VALUE = -999;
export const MAX_INT_VALUE = 999;
export const MAX_SIMULATION_TICKS = 180;

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

export function createWorldFromLevel(
  level: LevelDefinition,
  playerMachines: Array<{ type: MachineType; coord: AxialCoord; config: MachineConfig }> = [],
  spawnerOverrides?: Record<HexKey, { sequence: number[]; spawnInterval?: number }>,
  expectedSinkValues?: Record<string, number[]>,
  expectedSinkPolymers?: Record<string, number[][]>,
): SimulationWorld {
  const hexes = level.customHexes ?? generateHexDisk(level.radius);
  const platformHexes = new Set<HexKey>(hexes.map(hexKey));
  const narrowGapHexes = new Set<HexKey>((level.narrowGaps ?? []).map(hexKey));
  for (const gk of narrowGapHexes) {
    platformHexes.add(gk);
  }
  const machines = new Map<HexKey, MachineInstance>();

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

    machines.set(
      key,
      createMachineInstance(`m_${machineSeq++}`, pm.type, pm.coord, pm.locked, cfg),
    );
  }

  for (const um of playerMachines) {
    const key = hexKey(um.coord);
    if (!platformHexes.has(key) || narrowGapHexes.has(key)) continue;
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
    machines.set(
      key,
      createMachineInstance(`m_${machineSeq++}`, um.type, um.coord, false, cfg),
    );
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

  const visitedHexes = new Set<HexKey>();
  for (const um of playerMachines) {
    const k = hexKey(um.coord);
    if (platformHexes.has(k)) {
      visitedHexes.add(k);
    }
  }

  return {
    tick: 0,
    status: 'idle',
    platformHexes,
    narrowGapHexes,
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

export interface ConnectedComponent {
  id: string;
  tokenIds: string[];
  bondIndices: number[];
}

export function getConnectedComponents(world: SimulationWorld): ConnectedComponent[] {
  const adj = new Map<string, string[]>();
  for (const id of world.tokens.keys()) {
    adj.set(id, []);
  }
  for (const edge of world.bonds) {
    if (world.tokens.has(edge.a) && world.tokens.has(edge.b)) {
      adj.get(edge.a)!.push(edge.b);
      adj.get(edge.b)!.push(edge.a);
    }
  }

  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];

  for (const id of world.tokens.keys()) {
    if (visited.has(id)) continue;
    const stack = [id];
    const tokenIds: string[] = [];
    visited.add(id);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      tokenIds.push(curr);
      for (const nb of adj.get(curr) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    tokenIds.sort();
    const tokenSet = new Set(tokenIds);
    const bondIndices: number[] = [];
    world.bonds.forEach((b, idx) => {
      if (tokenSet.has(b.a) && tokenSet.has(b.b)) {
        bondIndices.push(idx);
      }
    });
    components.push({
      id: tokenIds[0],
      tokenIds,
      bondIndices,
    });
  }

  return components;
}

type ComponentIntent =
  | {
      kind: 'move';
      dir: HexDir;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'jump';
      dir: HexDir;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'rotate';
      pivot: AxialCoord;
      cwSteps: 1 | -1;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'swap';
      pivot: AxialCoord;
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

/**
 * Exact graph matching for Sink / Receiver.
 */
export function matchComponentToPattern(
  component: ConnectedComponent,
  world: SimulationWorld,
  sinkCoord: AxialCoord,
  pattern: TargetPattern,
  deliveryIdx = 0,
): { matched: boolean; reason?: string } {
  const tokens = component.tokenIds.map((id) => world.tokens.get(id)!);
  if (tokens.length !== pattern.nodes.length) {
    return { matched: false, reason: 'Несовпадение числа звеньев полимера' };
  }
  if (component.bondIndices.length !== pattern.edges.length) {
    return { matched: false, reason: 'Несовпадение структуры связей' };
  }

  const rotationsToTry = pattern.rotationInvariant ? [0, 1, 2, 3, 4, 5] : [0];

  const bondSet = new Set<string>();
  for (const idx of component.bondIndices) {
    const e = world.bonds[idx];
    const k = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    bondSet.add(k);
  }

  let lastMismatchReason: string | undefined;

  for (const rot of rotationsToTry) {
    // Map each pattern node index to a matching token at expected rotated world coord
    const matchedTokens: Token[] = [];
    let coordsOk = true;
    for (const node of pattern.nodes) {
      const rotOffset = rotateAroundPivot(node.offset, { q: 0, r: 0 }, rot);
      const expectedCoord = {
        q: sinkCoord.q + rotOffset.q,
        r: sinkCoord.r + rotOffset.r,
      };
      const tok = tokens.find((t) => hexEqual(t.coord, expectedCoord));
      if (!tok) {
        coordsOk = false;
        break;
      }
      matchedTokens.push(tok);
    }
    if (!coordsOk) continue;

    // Verify all required edges exist between mapped tokens
    let edgesOk = true;
    for (const edge of pattern.edges) {
      const tA = matchedTokens[edge.fromIdx];
      const tB = matchedTokens[edge.toIdx];
      const k = tA.id < tB.id ? `${tA.id}|${tB.id}` : `${tB.id}|${tA.id}`;
      if (!bondSet.has(k)) {
        edgesOk = false;
        break;
      }
    }
    if (!edgesOk) continue;

    if (pattern.mode === 'exact') {
      const expectedForStep = pattern.expectedNodeValues?.[deliveryIdx];
      let valuesOk = true;
      for (let i = 0; i < pattern.nodes.length; i++) {
        const reqVal = expectedForStep ? expectedForStep[i] : pattern.nodes[i].value;
        if (reqVal !== undefined && matchedTokens[i].value !== reqVal) {
          valuesOk = false;
          break;
        }
      }
      if (!valuesOk) {
        lastMismatchReason = 'Значения чисел не совпадают с эталоном';
        continue;
      }
      return { matched: true };
    }

    if (pattern.mode === 'sum_shape') {
      const sum = matchedTokens.reduce((acc, t) => acc + t.value, 0);
      if (pattern.requiredSum !== undefined && sum !== pattern.requiredSum) {
        lastMismatchReason = `Сумма звеньев равна ${sum}, требуется ${pattern.requiredSum}`;
        continue;
      }
      return { matched: true };
    }

    if (pattern.mode === 'beam_balance') {
      if (matchedTokens.length === 3) {
        // Identify hub node (degree 2 in pattern.edges) or default to middle index 1
        const deg = [0, 0, 0];
        for (const e of pattern.edges) {
          deg[e.fromIdx] = (deg[e.fromIdx] ?? 0) + 1;
          deg[e.toIdx] = (deg[e.toIdx] ?? 0) + 1;
        }
        const hubIdx = deg.indexOf(2) !== -1 ? deg.indexOf(2) : 1;
        const armIndices = [0, 1, 2].filter((idx) => idx !== hubIdx);
        const leftVal = matchedTokens[armIndices[0]].value;
        const rightVal = matchedTokens[armIndices[1]].value;
        const midVal = matchedTokens[hubIdx].value;
        if (leftVal !== rightVal) {
          lastMismatchReason = `Крылья не равны (${leftVal} ≠ ${rightVal})`;
          continue;
        }
        if (midVal !== leftVal + rightVal) {
          lastMismatchReason = `Центр равен ${midVal}, ожидается сумма крыльев (${leftVal} + ${rightVal} = ${leftVal + rightVal})`;
          continue;
        }
        return { matched: true };
      }
      lastMismatchReason = 'Для балки равновесия требуется 3 звена';
      continue;
    }

    if (pattern.mode === 'growth_ladder') {
      const step = pattern.ladderStep;
      if (!step) return { matched: true };
      let ladderOk = true;
      for (let i = 0; i < matchedTokens.length - 1; i++) {
        const cur = matchedTokens[i].value;
        const nxt = matchedTokens[i + 1].value;
        const expectedNext = step.op === 'add' ? cur + step.value : cur * step.value;
        if (nxt !== expectedNext) {
          lastMismatchReason = `Шаг роста нарушен: после ${cur} ожидается ${expectedNext}, получено ${nxt}`;
          ladderOk = false;
          break;
        }
      }
      if (!ladderOk) continue;
      return { matched: true };
    }
  }

  return { matched: false, reason: lastMismatchReason ?? 'Форма полимера не соответствует приёмнику' };
}

/**
 * Advances the simulation by exactly 1 deterministic tick across 5 strict phases:
 * 1. Snapshot & Timer/Flash Decay
 * 2. Intent Collection (Movement & Rotation from all machines symmetrically)
 * 3. Conflict Check (Thrust conflict, OOB, Solid housing, Edge swap, Target overlap)
 * 4. Simultaneous Apply (Moves, Rotations, Spawners, Arithmetic, Welds, Laser cuts)
 * 5. Delivery & Victory Check
 */
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
  }
  for (const t of world.tokens.values()) {
    t.prevCoord = { ...t.coord };
    t.prevValue = t.value;
    t.rotatedFrom = undefined;
    t.moveSource = undefined;
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

  // Phase 2: Compute Intents symmetrically (order-independent)
  const intentsByComp = new Map<string, ComponentIntent[]>();
  for (const c of components) {
    intentsByComp.set(c.id, []);
  }

  const addIntent = (compId: string, intent: ComponentIntent) => {
    intentsByComp.get(compId)!.push(intent);
  };

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
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
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
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
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
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
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
          signature: `swap:${machine.coord.q},${machine.coord.r}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    }
  }

  // Phase 3: Conflict Checks (Thrust Conflicts, Bounds, Solid Housing, Swaps, Overlaps)
  const resolvedIntentByComp = new Map<string, ComponentIntent | null>();

  for (const comp of components) {
    const intents = intentsByComp.get(comp.id)!;
    if (intents.length === 0) {
      resolvedIntentByComp.set(comp.id, null);
      continue;
    }
    const uniqueSigs = new Set(intents.map((i) => i.signature));
    if (uniqueSigs.size > 1) {
      const conflictCoords = intents.map((i) => i.sourceCoord);
      triggerError(
        world,
        'Конфликт векторов тяги: разные приводы тянут полимер в противоположных направлениях',
        conflictCoords,
        'collision',
      );
      return world;
    }
    resolvedIntentByComp.set(comp.id, intents[0]);
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

  // Process Duplicators (dup: keeps original to exit along dir, spawns copy onto altDir)
  for (const tok of Array.from(world.tokens.values())) {
    if (!movedTokenIds.has(tok.id)) continue;
    const machine = world.machines.get(hexKey(tok.coord));
    if (!machine || machine.type !== 'dup') continue;
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
    const copyFree =
      world.platformHexes.has(hexKey(copyCoord)) &&
      !Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, copyCoord)) &&
      !SOLID_MACHINE_TYPES.has(world.machines.get(hexKey(copyCoord))?.type ?? 'conveyor');
    if (!copyFree) {
      triggerError(
        world,
        'Нет свободного гекса для вывода копии дубликатора',
        [machine.coord, copyCoord],
        'blocked',
      );
      return world;
    }
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

    // Scales (Весы-сортировщик ⚖): larger exits dir, smaller spawns onto altDir
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
      const altFree =
        world.platformHexes.has(hexKey(altCoord)) &&
        !Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, altCoord)) &&
        !SOLID_MACHINE_TYPES.has(world.machines.get(hexKey(altCoord))?.type ?? 'conveyor');
      if (!altFree) {
        triggerError(
          world,
          'Нет свободного гекса для вывода меньшего числа с весов',
          [machine.coord, altCoord],
          'blocked',
        );
        return false;
      }
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      if (removeTok) {
        recordConsumed(removeTok, 'merge');
        world.tokens.delete(removeTok.id);
      }
      machine.state.memory = null;
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
    if (!movedTokenIds.has(tok.id)) continue;

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

  // Process Unary Math Pads on newly arrived tokens
  for (const tok of Array.from(world.tokens.values())) {
    if (!movedTokenIds.has(tok.id)) continue;
    const machine = world.machines.get(hexKey(tok.coord));
    if (!machine) continue;

    if (machine.type === 'add1') {
      const next = tok.value + 1;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return world;
      }
      const prev = tok.value;
      tok.value = next;
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
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `−x: ${prev} → ${next}`, severity: 'info', badge: '−x' });
    } else if (machine.type === 'divmod') {
      const b = machine.config.divisor ?? 2;
      const { q, r } = euclideanDivMod(tok.value, b);
      const prev = tok.value;
      tok.value = q;
      const remCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const remFree =
        world.platformHexes.has(hexKey(remCoord)) &&
        !Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, remCoord)) &&
        !SOLID_MACHINE_TYPES.has(world.machines.get(hexKey(remCoord))?.type ?? 'conveyor');
      if (!remFree) {
        triggerError(world, 'Нет места для вывода остатка от деления', [machine.coord, remCoord], 'blocked');
        return world;
      }
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
      const prev = tok.value;
      const half = divRes.result;
      const altCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const altFree =
        world.platformHexes.has(hexKey(altCoord)) &&
        !Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, altCoord)) &&
        !SOLID_MACHINE_TYPES.has(world.machines.get(hexKey(altCoord))?.type ?? 'conveyor');
      if (!altFree) {
        triggerError(
          world,
          'Нет свободного гекса для второй половины раскольника ½',
          [machine.coord, altCoord],
          'blocked',
        );
        return world;
      }
      tok.value = half;
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
        const deliveredVals = compTokens.map((t) => t.value);

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
        // Reject only if component is completely covering sink footprint OR scalar onto scalar sink with wrong value
        const allFootprintCovered = sinkFootprint.every((f) =>
          compTokens.some((t) => hexEqual(t.coord, f)),
        );
        const isScalarSinkWrongVal =
          pattern.nodes.length === 1 &&
          compTokens.length === 1 &&
          hexEqual(compTokens[0].coord, machine.coord);
        if (allFootprintCovered || isScalarSinkWrongVal) {
          triggerError(
            world,
            `Приёмник отклонил структуру: ${matchRes.reason ?? 'неверный образец'}`,
            [machine.coord],
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
