import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { sound } from '../audio/sound';
import { cloneWorld, computeWorldArea, MAX_SIMULATION_TICKS, stepSimulation, verifyLevelSolution } from '../engine/hex-engine';
import type { LevelDefinition, SimulationWorld, VerificationReport } from '../engine/types';
import type { LevelProgressRecord, VariantSlotId } from '../models/ui';
import { getBlocksSignature } from '../services/blockSignature';
import { saveProgress, saveVariants, type LevelVariantsMap, type PlacedBlock } from '../services/storage';
import { TOKEN_TRIGGER_ALPHA } from '../render/tokenAnimationTimeline';
import { BASE_SIM_TICK_MS, type AppState } from './useSimulationClock';

const MAX_TICK_HISTORY = 80;
type Setter<T> = Dispatch<SetStateAction<T>>;
interface StepOptions {
  worldRef: RefObject<SimulationWorld>; tickHistoryRef: RefObject<SimulationWorld[]>; tickProgressRef: RefObject<number>;
  currentLevelRef: RefObject<LevelDefinition>; playerBlocksRef: RefObject<PlacedBlock[]>; hintsRevealedRef: RefObject<Record<string, number>>;
  activeVariantRef: RefObject<VariantSlotId>; pendingSoundTimerRef: RefObject<number | null>; simSpeedRef: RefObject<1 | 2 | 4>;
  setTickHistoryCount: Setter<number>; setWorld: Setter<SimulationWorld>; setIsSimPlaying: Setter<boolean>;
  setFailedVerificationReport: Setter<VerificationReport | null>; setVictoryReport: Setter<VerificationReport | null>;
  setAppState: Setter<AppState>; setProgress: Setter<Record<string, LevelProgressRecord>>; setVariantsMap: Setter<LevelVariantsMap>;
}

export function useSimulationStep({ worldRef, tickHistoryRef, tickProgressRef, currentLevelRef, playerBlocksRef, hintsRevealedRef, activeVariantRef, pendingSoundTimerRef, simSpeedRef, setTickHistoryCount, setWorld, setIsSimPlaying, setFailedVerificationReport, setVictoryReport, setAppState, setProgress, setVariantsMap }: StepOptions) {
  // Pure imperative tick stepper: clones world, steps simulation, pushes tick history, & fires side effects OUTSIDE React state updaters
  return useCallback((isSingleStep: boolean) => {
    const prev = worldRef.current;
    if (prev.status === 'victory' || prev.status === 'error') {
      return;
    }

    const rewindSnapshot = cloneWorld(prev);
    const nextHistory = [
      ...tickHistoryRef.current.slice(-(MAX_TICK_HISTORY - 1)),
      rewindSnapshot,
    ];
    tickHistoryRef.current = nextHistory;
    setTickHistoryCount(nextHistory.length);

    const nextWorld = cloneWorld(prev);
    stepSimulation(nextWorld);
    worldRef.current = nextWorld;
    setWorld(nextWorld);

    if (isSingleStep) {
      tickProgressRef.current = 1;
    }

    const lvl = currentLevelRef.current;
    const blocks = playerBlocksRef.current;
    const latest = nextWorld.events[nextWorld.events.length - 1];

    if (nextWorld.status === 'victory') {
      setIsSimPlaying(false);
      const report = verifyLevelSolution(lvl, blocks, MAX_SIMULATION_TICKS);
      if (report.passed < report.total) {
        const firstFail = report.results.find((r) => !r.passed);
        nextWorld.status = 'error';
        nextWorld.errorReason = firstFail
          ? `Скрытая проверка «${firstFail.name}» не пройдена: ${firstFail.reason ?? 'схема не работает на альтернативных данных'}`
          : 'Скрытая проверка алгоритма не пройдена: решение не является общим.';
        worldRef.current = nextWorld;
        setWorld(nextWorld);
        setFailedVerificationReport(report);
        sound.playError();
        return;
      }

      sound.playVictory();
      setVictoryReport(report);
      setAppState('gameover');

      const area = computeWorldArea(nextWorld);
      const blocksGold = lvl.targets?.blocksGold ?? lvl.maxBlocksBonus;
      const ticksGold = lvl.targets?.ticksGold ?? lvl.maxTicksBonus;
      const areaGold = lvl.targets?.areaGold ?? lvl.maxAreaBonus;
      const earnedMedals = {
        blocks: blocksGold !== undefined ? blocks.length <= blocksGold : true,
        ticks: ticksGold !== undefined ? nextWorld.tick <= ticksGold : true,
        area: areaGold !== undefined ? area <= areaGold : true,
      };
      const hintsUsed = hintsRevealedRef.current[lvl.id] ?? 0;

      setProgress((oldProg) => {
        const prevRec = oldProg[lvl.id];
        const updated: Record<string, LevelProgressRecord> = {
          ...oldProg,
          [lvl.id]: {
            completed: true,
            bestTicks:
              prevRec?.bestTicks !== undefined
                ? Math.min(prevRec.bestTicks, nextWorld.tick)
                : nextWorld.tick,
            bestBlocks:
              prevRec?.bestBlocks !== undefined
                ? Math.min(prevRec.bestBlocks, blocks.length)
                : blocks.length,
            bestArea:
              prevRec?.bestArea !== undefined
                ? Math.min(prevRec.bestArea, area)
                : area,
            medals: {
              blocks: Boolean(prevRec?.medals?.blocks || earnedMedals.blocks),
              ticks: Boolean(prevRec?.medals?.ticks || earnedMedals.ticks),
              area: Boolean(prevRec?.medals?.area || earnedMedals.area),
            },
            hintsUsed:
              prevRec?.hintsUsed !== undefined
                ? Math.min(prevRec.hintsUsed, hintsUsed)
                : hintsUsed,
          },
        };
        saveProgress(updated);
        return updated;
      });

      const slot = activeVariantRef.current;
      const sig = getBlocksSignature(blocks);
      setVariantsMap((oldVars) => {
        const levelVars = oldVars[lvl.id] ?? {};
        const prevSlot = levelVars[slot];
        const prevSig = prevSlot ? (prevSlot.blocksSig ?? getBlocksSignature(prevSlot.blocks)) : undefined;
        const nextBest =
          prevSlot?.bestTicks !== undefined && prevSig === sig
            ? Math.min(prevSlot.bestTicks, nextWorld.tick)
            : nextWorld.tick;
        const updatedVars: LevelVariantsMap = {
          ...oldVars,
          [lvl.id]: {
            ...levelVars,
            [slot]: {
              blocks: structuredClone(blocks),
              blocksSig: sig,
              bestTicks: nextBest,
            },
          },
        };
        saveVariants(updatedVars);
        return updatedVars;
      });
    } else {
      if (pendingSoundTimerRef.current !== null) {
        window.clearTimeout(pendingSoundTimerRef.current);
        pendingSoundTimerRef.current = null;
      }

      if (nextWorld.status === 'error') {
        sound.playError();
        setIsSimPlaying(false);
      } else if (isSingleStep) {
        if (latest?.type === 'deliver') sound.playDeliver();
        else if (latest?.type === 'weld') sound.playWeld();
        else if (latest?.type === 'destroy') sound.playDestroy();
        else if (latest?.type === 'transform' || latest?.type === 'cut' || latest?.type === 'store') sound.playTransform();
        else sound.playStep();
      } else {
        const tickEvents = nextWorld.events.filter((ev) => ev.tick === nextWorld.tick);
        const triggerEv =
          tickEvents.find((ev) => ev.type === 'deliver') ??
          tickEvents.find((ev) => ev.type === 'weld' || ev.type === 'cut') ??
          tickEvents.find((ev) => ev.type === 'destroy') ??
          tickEvents.find((ev) => ev.type === 'transform' || ev.type === 'store');

        if (triggerEv) {
          const delayMs = Math.max(
            40,
            Math.round((BASE_SIM_TICK_MS / simSpeedRef.current) * TOKEN_TRIGGER_ALPHA),
          );
          pendingSoundTimerRef.current = window.setTimeout(() => {
            pendingSoundTimerRef.current = null;
            if (triggerEv.type === 'deliver') sound.playDeliver();
            else if (triggerEv.type === 'weld' || triggerEv.type === 'cut') sound.playWeld();
            else if (triggerEv.type === 'destroy') sound.playDestroy();
            else sound.playTransform();
          }, delayMs);
        } else {
          sound.playStep();
        }
      }
    }
  }, []);

}
