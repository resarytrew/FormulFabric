import { createWorldFromLevel } from './world';
import { hexKey } from './hex-math';
import type { LevelDefinition } from './types';
import { checkFootprintOverlaps } from './placement-validation';

/** Minimal shape of a stored block; mirrors `PlacedBlock` without the React layer. */
export interface StoredBlock {
  type: import('./types').MachineType;
  coord: { q: number; r: number };
  config: import('./types').MachineConfig;
}

/**
 * Conflicts that are visible from the layout alone, without a level: duplicate
 * keys and entries without coordinates.
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
 * Conflicts of a stored layout against a concrete level — everything that would
 * stop the layout from being built exactly as saved. Used to warn the player
 * instead of silently deleting their blocks.
 */
export function findLayoutConflictsForLevel(lvl: LevelDefinition, blocks: StoredBlock[]): string[] {
  const conflicts = findLayoutConflicts(blocks);
  const baseWorld = createWorldFromLevel(lvl, []);
  const seen = new Set<string>();

  for (const b of blocks) {
    if (!b || !b.coord) continue;
    const key = hexKey(b.coord);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!baseWorld.platformHexes.has(key)) {
      conflicts.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) находится вне платформы`);
    } else if (baseWorld.narrowGapHexes.has(key)) {
      conflicts.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) установлен над узким разломом`);
    } else if (baseWorld.machines.get(key)?.locked) {
      conflicts.push(`Механизм ${b.type} на (${b.coord.q}, ${b.coord.r}) перекрывает фиксированный модуль`);
    }
  }

  conflicts.push(...checkFootprintOverlaps(lvl, blocks as Parameters<typeof checkFootprintOverlaps>[1]));
  return [...new Set(conflicts)];
}
