import { validateLevelPlacement } from '../engine/world';
import type { LevelDefinition } from '../engine/types';
import type { PlacedBlock } from './storage';

export type RestoreVariantResult = { ok: true; blocks: PlacedBlock[] } | { ok: false; reason: string };

/** Validate the complete saved layout before touching the active board or slots. */
export function prepareSavedVariant(level: LevelDefinition, saved: unknown): RestoreVariantResult {
  if (!Array.isArray(saved)) return { ok: false, reason: 'Сохранённая схема повреждена: список механизмов недоступен.' };
  try {
    const blocks = structuredClone(saved) as PlacedBlock[];
    const errors = validateLevelPlacement(level, blocks);
    if (errors.length) return { ok: false, reason: `Не удалось загрузить схему: ${errors.join('; ')}` };
    return { ok: true, blocks };
  } catch {
    return { ok: false, reason: 'Сохранённая схема повреждена: не удалось прочитать механизмы.' };
  }
}
