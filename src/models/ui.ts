export type VariantSlotId = 'A' | 'B' | 'C';
export interface VariantSummary { blocks: number; bestTicks?: number; }
export type UiStyleMode = 'skyline' | 'classic';
export interface LevelProgressRecord {
  completed: boolean;
  bestTicks?: number;
  bestBlocks?: number;
  bestArea?: number;
  medals?: { blocks: boolean; ticks: boolean; area: boolean };
  hintsUsed?: number;
}
