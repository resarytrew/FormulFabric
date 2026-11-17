import { useState } from 'react';
import type { LevelProgressRecord, UiStyleMode } from '../models/ui';
import { loadSavedHints, loadSavedProgress, loadSavedUiStyle, loadSavedVariants, type LevelVariantsMap } from '../services/storage';

/** Load persistent state once; callers retain control of when updates are persisted. */
export function useProgressState() {
  const [uiStyle, setUiStyle] = useState<UiStyleMode>(loadSavedUiStyle);
  const [progress, setProgress] = useState<Record<string, LevelProgressRecord>>(loadSavedProgress);
  const [variantsMap, setVariantsMap] = useState<LevelVariantsMap>(loadSavedVariants);
  const [hintsRevealedByLevel, setHintsRevealedByLevel] = useState<Record<string, number>>(loadSavedHints);
  return { uiStyle, setUiStyle, progress, setProgress, variantsMap, setVariantsMap, hintsRevealedByLevel, setHintsRevealedByLevel };
}
