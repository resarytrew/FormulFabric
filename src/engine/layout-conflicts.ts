import { hexKey } from './hex-math';
import { validateLevelPlacement } from './world';
import type { LevelDefinition, MachineConfig, MachineType } from './types';

/** Minimal shape of a stored block; mirrors `PlacedBlock` without the React layer. */
export interface StoredBlock {
  type: MachineType;
  coord: { q: number; r: number };
  config: MachineConfig;
}

/**
 * Conflicts visible from the layout alone, without a level: entries without
 * coordinates and duplicate hexes. Kept separate because a stored layout may be
 * inspected before a level is chosen.
 */
export function findLayoutConflicts(blocks: StoredBlock[]): string[] {
  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (!b || !b.coord) {
      conflicts.push('Запись механизма без координат');
      continue;
    }
    const key = hexKey(b.coord);
    if (seen.has(key)) {
      conflicts.push(`Дублирующий механизм на гексе (${b.coord.q}, ${b.coord.r})`);
      continue;
    }
    seen.add(key);
  }
  return conflicts;
}

/**
 * Conflicts of a stored layout against a concrete level. This deliberately
 * delegates to the same validator the game uses before it starts a simulation —
 * including every receiver pad — so a stored layout cannot be reported as clean
 * and then rejected at launch.
 */
export function findLayoutConflictsForLevel(lvl: LevelDefinition, blocks: StoredBlock[]): string[] {
  const usable = blocks.filter((b): b is StoredBlock => Boolean(b && b.coord));
  return [...new Set([...findLayoutConflicts(blocks), ...validateLevelPlacement(lvl, usable)])];
}
