import { hexKey } from './hex-math';
import type {
  AxialCoord,
  HexKey,
  LevelDefinition,
  MachineConfig,
  MachineType,
  TargetPattern,
} from './types';

/**
 * A machine that participates in placement validation: a level fixture or a
 * player-placed block. `locked` matters because unlocked preset machines are
 * replaceable and therefore must not act as permanent obstacles.
 */
export type PlacedMachine = {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
  locked?: boolean;
};

export type FootprintMachine = {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
};

/** A single machine in the definitive arrangement that becomes the world. */
export type FinalMachine = {
  /** `level.presetMachines[i]` for fixtures, `player[i]` for player blocks. */
  origin: `preset:${number}` | `player:${number}`;
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
  locked: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isValidCoord(coord: unknown): coord is AxialCoord {
  if (!isRecord(coord)) return false;
  return Number.isInteger(coord.q) && Number.isInteger(coord.r);
}

/**
 * Defensive access to a machine config. Corrupted persisted layouts may carry
 * machines without `config`; the world builder and the validators must report
 * that instead of throwing.
 */
export function getMachineConfig(machine: { config?: MachineConfig } | null | undefined): MachineConfig | undefined {
  return isRecord(machine?.config) ? (machine!.config as MachineConfig) : undefined;
}

function getPattern(machine: FootprintMachine): TargetPattern | undefined {
  const config = getMachineConfig(machine);
  const pattern = config?.targetPattern;
  return isRecord(pattern) && Array.isArray(pattern.nodes) ? pattern : undefined;
}

/**
 * Every hex a machine occupies besides its centre. A receiver ("sink") with a
 * multi-node target pattern owns one pad per pattern node; every other machine
 * is single-hex. Offsets are relative to the machine centre.
 */
export function getMachineFootprint(machine: FootprintMachine): AxialCoord[] {
  const pattern = getPattern(machine);
  if (machine?.type === 'sink' && pattern && pattern.nodes.length > 0) {
    return pattern.nodes.filter((n) => isRecord(n?.offset)).map((n) => ({
      q: machine.coord.q + n.offset.q,
      r: machine.coord.r + n.offset.r,
    }));
  }
  return [{ ...machine.coord }];
}

/** Centre plus footprint exactly as declared, including malformed cells. */
function getDeclaredCells(machine: FootprintMachine): AxialCoord[] {
  if (!machine || !isValidCoord(machine.coord)) return [];
  return [machine.coord, ...getMachineFootprint(machine)];
}

/**
 * The centre plus the full footprint, de-duplicated and validated. For
 * single-hex machines the footprint *is* the centre, so the hex is counted once
 * instead of looking like a self-overlap.
 */
export function getMachineOccupiedHexes(machine: FootprintMachine): AxialCoord[] {
  const cells: AxialCoord[] = [];
  const seen = new Set<HexKey>();
  for (const coord of getDeclaredCells(machine)) {
    if (!isValidCoord(coord)) continue;
    const key = hexKey(coord);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ q: coord.q, r: coord.r });
  }
  return cells;
}

/** True when every declared cell (centre and pads) has integer coordinates. */
function hasValidCells(machine: FootprintMachine): boolean {
  const declared = getDeclaredCells(machine);
  return declared.length > 0 && declared.every(isValidCoord);
}

function machineLabel(machine: FootprintMachine, index: number): string {
  return `${machine.type} #${index + 1} (${machine.coord.q}, ${machine.coord.r})`;
}

function finalMachineLabel(machine: FinalMachine): string {
  return machine.origin.startsWith('preset')
    ? `${machine.type} #${machine.origin.slice('preset:'.length)} (исходный${machine.locked ? ', фиксированный' : ''})`
    : `${machine.type} #${machine.origin.slice('player:'.length)} (установлен игроком)`;
}

/**
 * Structural check of a receiver target pattern. Geometry-only checks cannot
 * catch a duplicated vertex or an edge pointing outside the graph, and those
 * would silently produce a receiver nobody can ever fill.
 */
export function lintPattern(pattern: TargetPattern): string[] {
  const errors: string[] = [];
  if (!pattern || !Array.isArray(pattern.nodes) || pattern.nodes.length === 0) {
    return ['образец приёмника не содержит ни одной вершины'];
  }

  const offsets = new Set<HexKey>();
  pattern.nodes.forEach((node, idx) => {
    if (!isValidCoord(node?.offset)) {
      errors.push(`вершина ${idx + 1} образца имеет неверные координаты`);
      return;
    }
    const key = hexKey(node.offset);
    if (offsets.has(key)) {
      errors.push(`вершина ${idx + 1} образца повторяет координаты (${key})`);
    }
    offsets.add(key);
  });

  const edges = Array.isArray(pattern.edges) ? pattern.edges : [];
  const pairs = new Set<HexKey>();
  edges.forEach((edge, idx) => {
    const { fromIdx, toIdx } = edge ?? {};
    if (
      !Number.isInteger(fromIdx) ||
      !Number.isInteger(toIdx) ||
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= pattern.nodes.length ||
      toIdx >= pattern.nodes.length
    ) {
      errors.push(`связь ${idx + 1} образца ссылается на несуществующую вершину`);
      return;
    }
    if (fromIdx === toIdx) {
      errors.push(`связь ${idx + 1} образца соединяет вершину саму с собой`);
      return;
    }
    const pairKey = `${Math.min(fromIdx, toIdx)}-${Math.max(fromIdx, toIdx)}`;
    if (pairs.has(pairKey)) {
      errors.push(`связь ${idx + 1} образца дублирует уже объявленную связь`);
    }
    pairs.add(pairKey);
  });

  // Expected node rows are matched per delivery against `pattern.nodes`; a row
  // of the wrong length can never match and would make the receiver unusable.
  if (Array.isArray(pattern.expectedNodeValues)) {
    pattern.expectedNodeValues.forEach((row, idx) => {
      if (!Array.isArray(row) || row.length !== pattern.nodes.length) {
        errors.push(
          `ожидаемый полимер ${idx + 1} образца описывает ${Array.isArray(row) ? row.length : 0} звеньев вместо ${pattern.nodes.length}`,
        );
      }
    });
  }
  if (pattern.mode === 'sum_shape' && typeof pattern.requiredSum !== 'number') {
    errors.push('образец режима «сохрани форму» не задаёт требуемую сумму');
  }
  if (pattern.mode === 'growth_ladder' && !pattern.ladderStep) {
    errors.push('образец режима «лестница» не задаёт шаг роста');
  }

  return errors;
}

/**
 * The arrangement the world builder will actually create.
 *
 * - Locked fixtures are always kept.
 * - An unlocked preset is dropped when the player put a block on its centre
 *   (replacement) *or* on any cell of its footprint, because part of that
 *   footprint would otherwise be taken over by the player's machine.
 * - Player blocks are dropped when they land on a locked fixture, on a narrow
 *   chasm, off the platform, or on a cell already claimed earlier.
 *
 * Both `validateLevelPlacement` and `createWorldFromLevel` use this, so a
 * validated layout and the built world cannot disagree.
 */
export function resolveFinalPlacement(
  level: LevelDefinition,
  blocks: FootprintMachine[],
  platformHexes?: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey> = new Set(),
  /**
   * `dropConflicts` (default) keeps only what can actually be built, so the
   * result is the world's machine set. `false` keeps every declared machine so
   * the overlap validator can report the conflicts instead of hiding them.
   */
  options: { dropConflicts?: boolean } = {},
): FinalMachine[] {
  const playerMachines = blocks ?? [];
  const playerCentres = new Set<HexKey>();
  for (const b of playerMachines) {
    if (b && isValidCoord(b.coord)) playerCentres.add(hexKey(b.coord));
  }

  const isReplacedPreset = (preset: PlacedMachine): boolean => {
    if (preset.locked) return false;
    if (!isValidCoord(preset.coord)) return false;
    if (playerCentres.has(hexKey(preset.coord))) return true;
    // A player block anywhere on this preset's own (non-centre) footprint
    // would take over part of it — the same replacement in another disguise.
    const centreKey = hexKey(preset.coord);
    return getMachineOccupiedHexes(preset).some((cell) => {
      const key = hexKey(cell);
      return key !== centreKey && playerCentres.has(key);
    });
  };

  const final: FinalMachine[] = [];
  const claimed = new Set<HexKey>();
  const dropConflicts = options.dropConflicts !== false;

  for (const [index, preset] of level.presetMachines.entries()) {
    if (isReplacedPreset(preset)) continue;
    final.push({
      origin: `preset:${index}`,
      type: preset.type,
      coord: { ...preset.coord },
      config: preset.config,
      locked: Boolean(preset.locked),
    });
    if (dropConflicts) {
      for (const cell of getMachineOccupiedHexes(preset)) claimed.add(hexKey(cell));
    }
  }

  for (const [index, block] of playerMachines.entries()) {
    if (!block || !isValidCoord(block.coord)) continue;
    const key = hexKey(block.coord);
    if (dropConflicts) {
      if (narrowGapHexes.has(key)) continue;
      if (platformHexes && !platformHexes.has(key)) continue;
      if (claimed.has(key)) continue;
    }
    const cells = getMachineOccupiedHexes(block);
    if (cells.length === 0) continue;
    if (getMachineConfig(block) === undefined) continue;
    // A receiver's whole footprint must be free, not only its centre.
    if (dropConflicts && cells.some((cell) => claimed.has(hexKey(cell)))) continue;
    final.push({
      origin: `player:${index}`,
      type: block.type,
      coord: { ...block.coord },
      config: block.config,
      locked: false,
    });
    if (dropConflicts) {
      for (const cell of cells) claimed.add(hexKey(cell));
    }
  }

  return final;
}

/**
 * Full-space overlap check over the definitive arrangement. Every occupied cell
 * of every object is claimed at most once, so a machine dropped on a side pad of
 * a multi-hex receiver is reported instead of silently replacing part of it.
 */
export function checkFootprintOverlaps(
  level: LevelDefinition,
  blocks: FootprintMachine[],
): string[] {
  const errors: string[] = [];
  const occupied = new Map<HexKey, string>();
  const final = resolveFinalPlacement(level, blocks, undefined, new Set(), { dropConflicts: false });

  for (const [index, machine] of final.entries()) {
    const name = finalMachineLabel(machine);

    if (!isValidCoord(machine.coord)) {
      errors.push(`Механизм #${index + 1}: неверные координаты`);
      continue;
    }
    if (!hasValidCells(machine)) {
      errors.push(`Механизм ${machineLabel(machine, index)}: неверные координаты площадки`);
      continue;
    }

    // Центр учитывается даже для многоклеточного приёмника.
    for (const coord of getMachineOccupiedHexes(machine)) {
      const key = hexKey(coord);
      const previous = occupied.get(key);

      if (previous && previous !== name) {
        errors.push(`Пересечение ${name} и ${previous} на ${key}`);
      } else {
        occupied.set(key, name);
      }
    }
  }

  return errors;
}

/**
 * Geometry check for every occupied cell of the definitive arrangement: the hex
 * must belong to the platform and must not be a narrow chasm. A player machine
 * centre keeps the legacy wording; extra pad cells and fixed fixtures are named
 * explicitly.
 */
export function checkFootprintPlacement(
  machines: Array<PlacedMachine | FinalMachine>,
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): string[] {
  const errors: string[] = [];

  for (const [index, machine] of machines.entries()) {
    // Malformed entries are reported once, by checkFootprintOverlaps.
    if (!machine || !isValidCoord(machine.coord) || !hasValidCells(machine)) continue;

    const isFixed = Boolean(machine.locked);
    for (const coord of getMachineOccupiedHexes(machine)) {
      const key = hexKey(coord);
      const isCentre = coord.q === machine.coord.q && coord.r === machine.coord.r;
      const legacyCentre = isCentre && !isFixed;
      const subject = legacyCentre
        ? `Механизм ${machine.type} на (${coord.q}, ${coord.r})`
        : `Клетка (${coord.q}, ${coord.r}) — ${machineLabel(machine, index)}`;

      if (!platformHexes.has(key)) {
        errors.push(
          legacyCentre
            ? `${subject} находится вне платформы`
            : `${subject}: вне платформы`,
        );
      } else if (narrowGapHexes.has(key)) {
        errors.push(
          legacyCentre
            ? `${subject} установлен над узким разломом`
            : `${subject}: над узким разломом, площадкой быть не может`,
        );
      }
    }
  }

  return errors;
}

/**
 * Combined footprint validation used by `validateLevelPlacement`: padding
 * geometry of every occupied cell plus overlap detection across the definitive
 * arrangement.
 */
export function validateLevelFootprints(
  level: LevelDefinition,
  blocks: FootprintMachine[],
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): string[] {
  const finalPlacement = resolveFinalPlacement(level, blocks, platformHexes, narrowGapHexes);
  return [
    ...checkFootprintPlacement(finalPlacement, platformHexes, narrowGapHexes),
    ...checkFootprintOverlaps(level, blocks),
  ];
}
