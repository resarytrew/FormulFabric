import { useCallback, useState } from 'react';
import type { PlacedBlock } from '../services/storage';

const MAX_EDIT_HISTORY = 50;

/** Undo and redo stacks contain independent snapshots, not mutable editor state. */
export function useEditHistory() {
  const [past, setPast] = useState<PlacedBlock[][]>([]);
  const [future, setFuture] = useState<PlacedBlock[][]>([]);

  const record = useCallback((current: PlacedBlock[]) => {
    const snapshot = structuredClone(current);
    setPast(previous => [...previous.slice(-(MAX_EDIT_HISTORY - 1)), snapshot]);
    setFuture([]);
  }, []);

  const clear = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  const undo = useCallback((current: PlacedBlock[]): PlacedBlock[] | undefined => {
    if (!past.length) return undefined;
    const previous = past[past.length - 1];
    const snapshot = structuredClone(current);
    setPast(items => items.slice(0, -1));
    setFuture(items => [snapshot, ...items]);
    return previous;
  }, [past]);

  const redo = useCallback((current: PlacedBlock[]): PlacedBlock[] | undefined => {
    if (!future.length) return undefined;
    const next = future[0];
    const snapshot = structuredClone(current);
    setFuture(items => items.slice(1));
    setPast(items => [...items.slice(-(MAX_EDIT_HISTORY - 1)), snapshot]);
    return next;
  }, [future]);

  return { canUndo: past.length > 0, canRedo: future.length > 0, record, clear, undo, redo };
}
