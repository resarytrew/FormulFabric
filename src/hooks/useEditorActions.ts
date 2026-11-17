import { useCallback, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { sound } from '../audio/sound';
import { findLayoutConflictsForLevel, getBlockedPlacementInfo, validateLevelPlacement } from '../engine/hex-engine';
import { hexEqual, hexKey, rotateDir } from '../engine/hex-math';
import { TOOL_METADATA } from '../engine/levels';
import type { AxialCoord, HexDir, LevelDefinition, MachineConfig, MachineType, RotatorMode, SimulationWorld } from '../engine/types';
import type { VariantSlotId } from '../models/ui';
import { getBlocksSignature } from '../services/blockSignature';
import { saveVariants, type LevelVariantsMap, type PlacedBlock } from '../services/storage';
import type { AppState } from './useSimulationClock';

/**
 * True when an edit makes the layout *worse*: it must not be applied if it adds
 * a placement error that the previous layout did not already have. Comparing
 * against the previous state keeps an already-conflicted layout editable, so the
 * player can still repair it (deleting or moving the offending block).
 */
function introducesNewPlacementErrors(
  lvl: LevelDefinition,
  before: PlacedBlock[],
  after: PlacedBlock[],
): string | null {
  const beforeErrors = new Set(validateLevelPlacement(lvl, before));
  const added = validateLevelPlacement(lvl, after).filter((e) => !beforeErrors.has(e));
  return added.length > 0 ? added[0] : null;
}

type Setter<T> = Dispatch<SetStateAction<T>>;
interface EditorOptions {
  isSimPlaying: boolean; appState: AppState; inspectedCoord: AxialCoord | null; selectedTool: MachineType | 'select' | 'erase' | null; selectedDir: HexDir; rotatorMode: RotatorMode; sandboxSeqInput: string; playerBlocks: PlacedBlock[];
  currentLevel: LevelDefinition; activeVariant: VariantSlotId; variantsMap: LevelVariantsMap;
  currentLevelRef: RefObject<LevelDefinition>; playerBlocksRef: RefObject<PlacedBlock[]>; worldRef: RefObject<SimulationWorld>;
  setInspectedCoord: Setter<AxialCoord | null>; setVariantsMap: Setter<LevelVariantsMap>; setActiveVariant: Setter<VariantSlotId>; setBudgetWarning: Setter<string | null>;
  commitBlocks: (blocks: PlacedBlock[], recordHistory?: boolean) => void; showBudgetWarning: (message: string) => void;
}

export function useEditorActions({ isSimPlaying, appState, inspectedCoord, selectedTool, selectedDir, rotatorMode, sandboxSeqInput, playerBlocks, currentLevel, activeVariant, variantsMap, currentLevelRef, playerBlocksRef, worldRef, setInspectedCoord, setVariantsMap, setActiveVariant, setBudgetWarning, commitBlocks, showBudgetWarning }: EditorOptions) {
  const handleUpdateMachineConfig = useCallback(
    (coord: AxialCoord, patch: Partial<MachineConfig>) => {
      if (isSimPlaying) return;
      const idx = playerBlocksRef.current.findIndex((b) => hexEqual(b.coord, coord));
      if (idx === -1) return;
      const nextBlocks = playerBlocksRef.current.map((b, i) =>
        i === idx ? { ...b, config: { ...b.config, ...patch } } : b,
      );
      // A receiver's pattern decides its whole footprint, so a config edit can
      // invalidate the layout just like a move does.
      const newError = introducesNewPlacementErrors(
        currentLevelRef.current,
        playerBlocksRef.current,
        nextBlocks,
      );
      if (newError) {
        sound.playError();
        showBudgetWarning(newError);
        return;
      }
      sound.playRotate();
      commitBlocks(nextBlocks, true);
    },
    [isSimPlaying, commitBlocks, currentLevelRef, playerBlocksRef, showBudgetWarning],
  );

  const handleDeleteBlock = useCallback(
    (coord: AxialCoord) => {
      if (isSimPlaying) return;
      const nextBlocks = playerBlocksRef.current.filter((b) => !hexEqual(b.coord, coord));
      if (nextBlocks.length !== playerBlocksRef.current.length) {
        sound.playRemove();
        if (inspectedCoord && hexEqual(inspectedCoord, coord)) {
          setInspectedCoord(null);
        }
        commitBlocks(nextBlocks, true);
      }
    },
    [isSimPlaying, inspectedCoord, commitBlocks],
  );

  const handleSaveVariant = useCallback(
    (slot: VariantSlotId) => {
      if (isSimPlaying) return;
      const lvlId = currentLevelRef.current.id;
      const blocksCopy = structuredClone(playerBlocksRef.current);
      const nextSig = getBlocksSignature(blocksCopy);
      setVariantsMap((old) => {
        const lvlVars = old[lvlId] ?? {};
        const prevSlot = lvlVars[slot];
        const prevSig = prevSlot ? (prevSlot.blocksSig ?? getBlocksSignature(prevSlot.blocks)) : undefined;
        const prevBest = prevSlot?.bestTicks;
        const updated: LevelVariantsMap = {
          ...old,
          [lvlId]: {
            ...lvlVars,
            [slot]: {
              blocks: blocksCopy,
              blocksSig: nextSig,
              bestTicks: prevSig === nextSig ? prevBest : undefined,
            },
          },
        };
        saveVariants(updated);
        return updated;
      });
      setActiveVariant(slot);
      sound.playPlace();
    },
    [isSimPlaying],
  );

  const handleSelectVariant = useCallback(
    (slot: VariantSlotId) => {
      if (isSimPlaying || slot === activeVariant) return;
      const lvlId = currentLevelRef.current.id;
      // Auto-snapshot current non-empty work into previous slot before switching
      const currBlocks = structuredClone(playerBlocksRef.current);
      const nextVariants = structuredClone(variantsMap);
      const lvlVars = nextVariants[lvlId] ?? {};
      if (currBlocks.length > 0) {
        const oldSlot = lvlVars[activeVariant];
        const currSig = getBlocksSignature(currBlocks);
        const oldSig = oldSlot ? (oldSlot.blocksSig ?? getBlocksSignature(oldSlot.blocks)) : undefined;
        lvlVars[activeVariant] = {
          blocks: currBlocks,
          blocksSig: currSig,
          bestTicks: oldSlot && oldSig === currSig ? oldSlot.bestTicks : undefined,
        };
      }
      nextVariants[lvlId] = lvlVars;
      saveVariants(nextVariants);
      setVariantsMap(nextVariants);

      const storedBlocks = lvlVars[slot]?.blocks ?? [];
      // Load the layout exactly as saved: never drop a block silently.
      const targetBlocks: PlacedBlock[] = storedBlocks
        .filter((b): b is PlacedBlock => Boolean(b && b.coord))
        .map((b) => ({
          type: b.type,
          coord: { ...b.coord },
          config: structuredClone(b.config),
        }));
      const conflicts = findLayoutConflictsForLevel(currentLevelRef.current, targetBlocks);
      setActiveVariant(slot);
      setInspectedCoord(null);
      commitBlocks(targetBlocks, true);
      if (conflicts.length > 0) {
        // The saved data is untouched; the player can delete the offending
        // block or switch back and nothing was lost behind their back.
        sound.playError();
        showBudgetWarning(
          `Сохранённая схема содержит конфликты (${conflicts.length}): ${conflicts[0]}`,
        );
      } else {
        sound.playStep();
      }
    },
    [isSimPlaying, activeVariant, variantsMap, commitBlocks, showBudgetWarning],
  );

  const handleHexClick = useCallback(
    (coord: AxialCoord) => {
      if (appState !== 'playing' || isSimPlaying) return;
      const key = hexKey(coord);
      if (selectedTool !== 'select' && selectedTool !== 'erase') {
        const blockCheck = getBlockedPlacementInfo(worldRef.current, coord, {
          allowedOwnerId: worldRef.current.machines.get(key)?.id,
        });
        if (blockCheck.blocked) {
          sound.playError();
          if (blockCheck.reason) {
            showBudgetWarning(blockCheck.reason);
          }
          return;
        }
      } else if (!worldRef.current.platformHexes.has(key)) {
        sound.playError();
        showBudgetWarning('Нельзя разместить блок над разломом платформы.');
        return;
      }

      if (selectedTool === 'select') {
        const found = playerBlocks.find((b) => hexEqual(b.coord, coord));
        if (found) {
          setInspectedCoord({ ...coord });
          sound.playStep();
        } else {
          setInspectedCoord(null);
        }
        return;
      }

      if (selectedTool === 'erase') {
        handleDeleteBlock(coord);
        return;
      }

      if (!selectedTool) return;

      const lvl = currentLevelRef.current;
      const existingIdx = playerBlocks.findIndex((b) => hexEqual(b.coord, coord));
      let nextBlocks: PlacedBlock[];

      if (existingIdx !== -1 && playerBlocks[existingIdx].type === selectedTool) {
        // Rotate existing machine in place & open it in Inspector!
        const nextDir = rotateDir(playerBlocks[existingIdx].config.dir, 1);
        nextBlocks = playerBlocks.map((b, idx) =>
          idx === existingIdx
            ? {
                ...b,
                config: {
                  ...b.config,
                  dir: nextDir,
                  altDir: rotateDir(nextDir, 1),
                  rotMode: selectedTool === 'rotator' ? rotatorMode : b.config.rotMode,
                },
              }
            : b,
        );
        setInspectedCoord({ ...coord });
        sound.playRotate();
      } else {
        // Enforce total budget & per-type part limits before adding or swapping
        if (
          existingIdx === -1 &&
          lvl.maxTotalBlocks !== undefined &&
          playerBlocks.length >= lvl.maxTotalBlocks
        ) {
          sound.playError();
          showBudgetWarning(
            `Достигнут лимит блоков (${playerBlocks.length}/${lvl.maxTotalBlocks}). Удалите или замените лишний модуль.`,
          );
          return;
        }

        const partLimit = lvl.partLimits?.[selectedTool];
        if (partLimit !== undefined) {
          const usedOther = playerBlocks.filter(
            (b, i) => i !== existingIdx && b.type === selectedTool,
          ).length;
          if (usedOther >= partLimit) {
            sound.playError();
            showBudgetWarning(
              `Лимит модуля «${TOOL_METADATA[selectedTool].label}» (${partLimit} шт.) исчерпан.`,
            );
            return;
          }
        }

        const parsedSeq = sandboxSeqInput
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        const newConfig: MachineConfig = {
          dir: selectedDir,
          altDir: rotateDir(selectedDir, 1),
          rotMode: selectedTool === 'rotator' ? rotatorMode : undefined,
          filterRule: selectedTool === 'filter' ? 'even' : undefined,
          divisor: selectedTool === 'divmod' ? (lvl.fixedDivisor ?? 2) : undefined,
          sequence:
            selectedTool === 'spawner'
              ? parsedSeq.length > 0
                ? parsedSeq
                : [1, 2, 3]
              : undefined,
          loopSequence: selectedTool === 'spawner' ? true : undefined,
          spawnInterval: selectedTool === 'spawner' ? 3 : undefined,
          targetPattern:
            selectedTool === 'sink'
              ? {
                  mode: 'exact',
                  nodes: [{ offset: { q: 0, r: 0 } }],
                  edges: [],
                  rotationInvariant: true,
                  label: 'Любое',
                }
              : undefined,
        };
        const filtered = playerBlocks.filter((b) => !hexEqual(b.coord, coord));
        nextBlocks = [...filtered, { type: selectedTool, coord: { ...coord }, config: newConfig }];
        // A freshly placed receiver claims its whole footprint: refuse the drop
        // if any of those cells is already taken by another machine.
        const newError = introducesNewPlacementErrors(lvl, playerBlocks, nextBlocks);
        if (newError) {
          sound.playError();
          showBudgetWarning(newError);
          return;
        }
        setInspectedCoord({ ...coord });
        setBudgetWarning(null);
        sound.playPlace();
      }

      commitBlocks(nextBlocks, true);
    },
    [
      appState,
      isSimPlaying,
      selectedTool,
      selectedDir,
      rotatorMode,
      sandboxSeqInput,
      playerBlocks,
      commitBlocks,
      handleDeleteBlock,
      showBudgetWarning,
    ],
  );

  const handleHexRightClick = useCallback(
    (coord: AxialCoord) => {
      if (appState !== 'playing' || isSimPlaying) return;
      const existing = worldRef.current.machines.get(hexKey(coord));
      if (existing?.locked) return;
      handleDeleteBlock(coord);
    },
    [appState, isSimPlaying, handleDeleteBlock],
  );

  const handleMoveBlock = useCallback(
    (fromCoord: AxialCoord, toCoord: AxialCoord, newDir?: HexDir) => {
      if (appState !== 'playing' || isSimPlaying) return;
      const movingMachine = worldRef.current.machines.get(hexKey(fromCoord));
      const blockCheck = getBlockedPlacementInfo(worldRef.current, toCoord, {
        // A receiver being dragged out of its own footprint may land on one of
        // its own pads (the pads move with it); nothing else may.
        allowedOwnerId: movingMachine?.type === 'sink' ? movingMachine.id : undefined,
      });
      if (blockCheck.blocked) {
        sound.playError();
        showBudgetWarning(blockCheck.reason ?? 'Целевой гекс недоступен для размещения.');
        return;
      }

      const blocks = playerBlocksRef.current;
      const fromIdx = blocks.findIndex((b) => hexEqual(b.coord, fromCoord));
      if (fromIdx === -1) return;

      const moving = blocks[fromIdx];
      const nextDir = newDir ?? moving.config.dir;
      const dirDelta = ((nextDir - moving.config.dir) % 6 + 6) % 6;
      const nextAltDir =
        moving.config.altDir !== undefined
          ? rotateDir(moving.config.altDir, dirDelta)
          : rotateDir(nextDir, 1);

      const destIdx = blocks.findIndex((b) => hexEqual(b.coord, toCoord));
      if (hexEqual(fromCoord, toCoord) && dirDelta === 0) return;

      const updatedMoving: PlacedBlock = {
        ...moving,
        coord: { ...toCoord },
        config: {
          ...moving.config,
          dir: nextDir,
          altDir: nextAltDir,
        },
      };

      let nextBlocks: PlacedBlock[];
      if (destIdx !== -1 && destIdx !== fromIdx) {
        // Swap with unlocked player block on destination hex cleanly
        const swappedDest: PlacedBlock = {
          ...blocks[destIdx],
          coord: { ...fromCoord },
        };
        nextBlocks = blocks.map((b, i) =>
          i === fromIdx ? updatedMoving : i === destIdx ? swappedDest : b,
        );
      } else {
        nextBlocks = blocks.map((b, i) => (i === fromIdx ? updatedMoving : b));
      }

      // The whole new layout must be legal, not just the destination hex: moving
      // a receiver also moves every pad it occupies.
      const newError = introducesNewPlacementErrors(currentLevelRef.current, blocks, nextBlocks);
      if (newError) {
        sound.playError();
        showBudgetWarning(newError);
        return;
      }

      setInspectedCoord({ ...toCoord });
      setBudgetWarning(null);
      sound.playPlace();
      commitBlocks(nextBlocks, true);
    },
    [appState, isSimPlaying, commitBlocks, showBudgetWarning, currentLevelRef, worldRef, playerBlocksRef],
  );

  const handleApplyDemo = useCallback(
    (variantIdx = 0) => {
      if (isSimPlaying) return;
      const sourceBlocks =
        variantIdx === 0
          ? currentLevel.demoSolution
          : currentLevel.altDemoSolutions?.[variantIdx - 1]?.blocks;
      if (!sourceBlocks) return;
      const demoBlocks: PlacedBlock[] = sourceBlocks.map((d) => ({
        type: d.type,
        coord: { ...d.coord },
        config: { ...d.config },
      }));
      sound.playPlace();
      setInspectedCoord(null);
      commitBlocks(demoBlocks, true);
    },
    [isSimPlaying, currentLevel, commitBlocks],
  );

  const handleClearBoard = useCallback(() => {
    if (isSimPlaying) return;
    sound.playRemove();
    setInspectedCoord(null);
    commitBlocks([], true);
  }, [isSimPlaying, commitBlocks]);

  return { handleUpdateMachineConfig, handleDeleteBlock, handleSaveVariant, handleSelectVariant, handleHexClick, handleHexRightClick, handleMoveBlock, handleApplyDemo, handleClearBoard };
}
