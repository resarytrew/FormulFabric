import { hexKey } from './hex-math';
import { isValidCoord } from './placement-validation';
import { validateLevelPlacement, validateLevelPlacementIssues } from './world';
import type { LevelDefinition, MachineConfig, MachineType } from './types';
import type { PlacementIssue } from './placement-validation';

/** Minimal shape of a stored block; mirrors `PlacedBlock` without the React layer. */
export interface StoredBlock {
  type: MachineType;
  coord: { q: number; r: number };
  config: MachineConfig;
}

/** A stored block the scene cannot represent, so it can never be selected. */
export interface UnplaceableBlock {
  /** Index in the stored layout, so the editor can remove exactly this record. */
  index: number;
  reason: string;
  type: MachineType;
  coord?: { q: number; r: number };
}

/**
 * Conflicts visible from the layout alone, without a level: entries without
 * coordinates and duplicate hexes. Kept separate because a stored layout may be
 * inspected before a level is chosen.
 */
export function findLayoutConflicts(blocks: StoredBlock[]): string[] {
  return findLayoutConflictIssues(blocks).map((i) => i.message);
}

function findLayoutConflictIssues(blocks: StoredBlock[]): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  const seen = new Set<string>();
  (blocks ?? []).forEach((b, index) => {
    if (!b || !isValidCoord(b.coord)) {
      issues.push({
        code: 'invalid-data',
        message: b?.coord ? 'Некорректные координаты механизма' : 'Запись механизма без координат',
        coords: [],
        machineIndex: index,
      });
      return;
    }
    const key = hexKey(b.coord);
    if (seen.has(key)) {
      issues.push({
        code: 'duplicate',
        message: `Дублирующий механизм на гексе (${b.coord.q}, ${b.coord.r})`,
        coords: [{ ...b.coord }],
        machineIndex: index,
      });
      return;
    }
    seen.add(key);
  });
  return issues;
}

/**
 * Blocks a stored layout contains that the scene can never display: records
 * without coordinates and duplicate records on the same hex (the world is a
 * Map keyed by hex, so only one of them can exist). The editor turns these into
 * an actionable "remove this block" list instead of leaving them invisible.
 */
export function findUnplaceableBlocks(blocks: StoredBlock[]): UnplaceableBlock[] {
  const seen = new Set<string>();
  const unplaceable: UnplaceableBlock[] = [];
  (blocks ?? []).forEach((b, index) => {
    if (!b || !isValidCoord(b.coord)) {
      unplaceable.push({
        index,
        reason: b?.coord ? 'некорректные координаты' : 'механизм без координат',
        type: (b?.type ?? 'conveyor') as MachineType,
      });
      return;
    }
    const key = hexKey(b.coord);
    if (seen.has(key)) {
      unplaceable.push({
        index,
        reason: `дубликат на гексе (${b.coord.q}, ${b.coord.r})`,
        type: b.type,
        coord: { ...b.coord },
      });
      return;
    }
    seen.add(key);
  });
  return unplaceable;
}

/** Removes exactly the listed records, leaving every other block untouched. */
export function removeUnplaceableBlocks(blocks: StoredBlock[], unplaceable: UnplaceableBlock[]): StoredBlock[] {
  const drop = new Set(unplaceable.map((u) => u.index));
  return (blocks ?? []).filter((_, index) => !drop.has(index));
}

/**
 * Conflicts of a stored layout against a concrete level. This deliberately
 * delegates to the same validator the game uses before it starts a simulation —
 * including every receiver pad — so a stored layout cannot be reported as clean
 * and then rejected at launch.
 */
export function findLayoutConflictsForLevel(lvl: LevelDefinition, blocks: StoredBlock[]): string[] {
  const usable = (blocks ?? []).filter((b): b is StoredBlock => Boolean(b && b.coord));
  return [
    ...new Set([
      ...findLayoutConflicts(blocks ?? []),
      ...validateLevelPlacement(lvl, usable),
    ]),
  ];
}

/** Structured equivalent of `findLayoutConflictsForLevel`. */
export function findLayoutIssuesForLevel(
  lvl: LevelDefinition,
  blocks: StoredBlock[],
): PlacementIssue[] {
  const usable = (blocks ?? []).filter((b): b is StoredBlock => Boolean(b && b.coord));
  return [...findLayoutConflictIssues(blocks ?? []), ...validateLevelPlacementIssues(lvl, usable)];
}
