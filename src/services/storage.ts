import type { VariantSlotId } from '../components/BottomDock';
import type { LevelProgressRecord } from '../components/CampaignModal';
import type { UiStyleMode } from '../components/TopHud';
import type { AxialCoord, MachineConfig, MachineType } from '../engine/types';

export interface PlacedBlock {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
}

export interface StoredVariant {
  blocks: PlacedBlock[];
  blocksSig?: string;
  bestTicks?: number;
}

export type LevelVariantsMap = Record<string, Partial<Record<VariantSlotId, StoredVariant>>>;

const PROGRESS_STORAGE_KEY = 'fabrika_chisel_progress_v1';
const VARIANTS_STORAGE_KEY = 'fabrika_chisel_variants_v1';
const HINTS_STORAGE_KEY = 'fabrika_chisel_hints_v1';
const UI_STYLE_STORAGE_KEY = 'fabrika_chisel_ui_style_v1';

export function loadSavedUiStyle(): UiStyleMode {
  try {
    const raw = localStorage.getItem(UI_STYLE_STORAGE_KEY);
    return raw === 'classic' ? 'classic' : 'skyline';
  } catch {
    return 'skyline';
  }
}

export function loadSavedProgress(): Record<string, LevelProgressRecord> {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LevelProgressRecord>;
  } catch {
    return {};
  }
}

export function saveProgress(p: Record<string, LevelProgressRecord>) {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore storage errors
  }
}

export function loadSavedVariants(): LevelVariantsMap {
  try {
    const raw = localStorage.getItem(VARIANTS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LevelVariantsMap;
  } catch {
    return {};
  }
}

export function saveVariants(v: LevelVariantsMap) {
  try {
    localStorage.setItem(VARIANTS_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore storage errors
  }
}

export function loadSavedHints(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HINTS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export function saveHints(h: Record<string, number>) {
  try {
    localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(h));
  } catch {
    // ignore storage errors
  }
}

export function saveUiStyle(style: UiStyleMode) {
  try { localStorage.setItem(UI_STYLE_STORAGE_KEY, style); } catch { /* ignore storage errors */ }
}
