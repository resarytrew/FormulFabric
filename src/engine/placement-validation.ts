import { hexKey } from './hex-math';
import type {
  AxialCoord,
  HexKey,
  LevelDefinition,
  MachineConfig,
  MachineType,
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

/**
 * Every hex a machine occupies besides its centre. A receiver ("sink") with a
 * multi-node target pattern owns one pad per pattern node; every other machine
 * is single-hex. Offsets are relative to the machine centre.
 */
export function getMachineFootprint(machine: FootprintMachine): AxialCoord[] {
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

function isValidCoord(coord: AxialCoord | undefined | null): coord is AxialCoord {
  return Boolean(coord) && Number.isInteger(coord!.q) && Number.isInteger(coord!.r);
}

/** Centre plus footprint exactly as declared, including malformed cells. */
function getDeclaredCells(machine: FootprintMachine): AxialCoord[] {
  if (!machine?.coord) return [];
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

function machineName(machine: PlacedMachine, index: number): string {
  const lockedSuffix = machine.locked ? ', фиксированный' : '';
  return `${machine.type} #${index + 1} (${machine.coord.q}, ${machine.coord.r}${lockedSuffix})`;
}

/**
 * The arrangement that will actually exist after the level is built: every
 * locked fixture, every preset machine the player did not replace by placing a
 * block on its own hex, and every player block. A replaceable preset machine
 * must never be treated as a permanent obstacle for the block that replaces it.
 */
export function resolveFinalPlacement(
  level: LevelDefinition,
  blocks: FootprintMachine[],
): PlacedMachine[] {
  const playerCentres = new Set<HexKey>();
  for (const b of blocks) {
    if (isValidCoord(b?.coord)) playerCentres.add(hexKey(b.coord));
  }

  const final: PlacedMachine[] = [];
  for (const preset of level.presetMachines) {
    if (!preset.locked && isValidCoord(preset.coord) && playerCentres.has(hexKey(preset.coord))) {
      continue; // Replaced by the player's block on the same hex.
    }
    final.push({ ...preset, locked: preset.locked });
  }
  for (const block of blocks) {
    final.push({ ...block, locked: false });
  }
  return final;
}

/**
 * Full-space overlap check. Every occupied cell of every object in the final
 * arrangement is claimed at most once, so a machine dropped on a side pad of a
 * multi-hex receiver is rejected instead of silently replacing part of it.
 */
export function checkFootprintOverlaps(
  level: LevelDefinition,
  blocks: FootprintMachine[],
): string[] {
  const errors: string[] = [];
  const occupied = new Map<HexKey, string>();

  const all = resolveFinalPlacement(level, blocks);

  for (const [index, machine] of all.entries()) {
    if (!machine?.coord) {
      errors.push(`Механизм #${index + 1}: нет координат`);
      continue;
    }
    const name = machineName(machine, index);

    if (!hasValidCells(machine)) {
      errors.push(`${name}: неверные координаты`);
      continue;
    }

    // Центр учитывается даже для многоклеточного приёмника.
    const cells = getMachineOccupiedHexes(machine);

    for (const coord of cells) {
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
 * Geometry check for every occupied cell: the hex must belong to the platform
 * and must not be a narrow chasm. A player machine centre keeps the legacy
 * wording; extra pad cells and fixed fixtures are named explicitly.
 */
export function checkFootprintPlacement(
  machines: PlacedMachine[],
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): string[] {
  const errors: string[] = [];

  for (const [index, machine] of machines.entries()) {
    // Malformed entries are reported once, by checkFootprintOverlaps.
    if (!machine?.coord || !hasValidCells(machine)) continue;

    const isFixed = Boolean(machine.locked);
    for (const coord of getMachineOccupiedHexes(machine)) {
      const key = hexKey(coord);
      const isCentre = coord.q === machine.coord.q && coord.r === machine.coord.r;
      const legacyCentre = isCentre && !isFixed;
      const subject = legacyCentre
        ? `Механизм ${machine.type} на (${coord.q}, ${coord.r})`
        : `Клетка (${coord.q}, ${coord.r}) — ${machineName(machine, index)}`;

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
 * Combined footprint validation used by `validateLevelPlacement`: geometry of
 * every occupied cell plus overlap detection across the final arrangement.
 */
export function validateLevelFootprints(
  level: LevelDefinition,
  blocks: FootprintMachine[],
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): string[] {
  const finalPlacement = resolveFinalPlacement(level, blocks);
  return [
    ...checkFootprintPlacement(finalPlacement, platformHexes, narrowGapHexes),
    ...checkFootprintOverlaps(level, blocks),
  ];
}
