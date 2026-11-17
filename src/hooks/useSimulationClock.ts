import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { cloneWorld, createWorldFromLevel, stepSimulation } from '../engine/hex-engine';
import type { LevelDefinition, SimulationWorld } from '../engine/types';

export const BASE_SIM_TICK_MS = 1050;
export type AppState = 'title' | 'playing' | 'paused' | 'gameover';

interface ClockOptions {
  appState: AppState;
  isSimPlaying: boolean;
  simSpeed: 1 | 2 | 4;
  titleTourLevel: LevelDefinition;
  advanceSimulationTick: (isSingleStep: boolean) => void;
  tickProgressRef: RefObject<number>;
  worldRef: RefObject<SimulationWorld>;
  pendingSoundTimerRef: RefObject<number | null>;
  setWorld: Dispatch<SetStateAction<SimulationWorld>>;
}

export function useSimulationClock({ appState, isSimPlaying, simSpeed, titleTourLevel, advanceSimulationTick, tickProgressRef, worldRef, pendingSoundTimerRef, setWorld }: ClockOptions) {
  // Title Screen ambient showcase loop & Playing Simulation Stepper
  useEffect(() => {
    if (appState === 'title') {
      const intervalMs = BASE_SIM_TICK_MS;
      let lastTickTime = performance.now();
      let animId = 0;

      const frame = (now: number) => {
        const elapsed = now - lastTickTime;
        tickProgressRef.current = Math.min(1, elapsed / intervalMs);
        if (elapsed >= intervalMs) {
          lastTickTime = now;
          tickProgressRef.current = 0;
          const prev = worldRef.current;
          if (prev.status === 'victory' || prev.status === 'error' || prev.tick > 45) {
            const fresh = createWorldFromLevel(
              titleTourLevel,
              titleTourLevel.demoSolution ?? [],
            );
            worldRef.current = fresh;
            setWorld(fresh);
          } else {
            const nextClone = cloneWorld(prev);
            stepSimulation(nextClone);
            worldRef.current = nextClone;
            setWorld(nextClone);
          }
        }
        animId = requestAnimationFrame(frame);
      };
      animId = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(animId);
    }

    if (appState !== 'playing' || !isSimPlaying) {
      tickProgressRef.current = 1;
      return;
    }

    const intervalMs = BASE_SIM_TICK_MS / simSpeed;
    let lastTickTime = performance.now();
    let animId = 0;

    const frame = (now: number) => {
      const elapsed = now - lastTickTime;
      tickProgressRef.current = Math.min(1, elapsed / intervalMs);

      if (elapsed >= intervalMs) {
        lastTickTime = now;
        tickProgressRef.current = 0;
        advanceSimulationTick(false);
      }
      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animId);
      if (pendingSoundTimerRef.current !== null) {
        window.clearTimeout(pendingSoundTimerRef.current);
        pendingSoundTimerRef.current = null;
      }
    };
  }, [appState, isSimPlaying, simSpeed, titleTourLevel, advanceSimulationTick]);

}
