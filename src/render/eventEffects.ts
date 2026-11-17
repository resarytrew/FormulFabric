import { hexToWorld } from '../engine/hex-math';
import type { SimEvent } from '../engine/types';

interface EffectActions {
  spawnSteamBurst: (x: number, z: number, count?: number) => void;
  spawnSparkBurst: (x: number, z: number, count?: number) => void;
  spawnPulseRing: (x: number, z: number, color: number, maxScale?: number, delay?: number) => void;
  spawnOpPopup: (x: number, z: number, badge: string, severity: SimEvent['severity']) => void;
  addTrauma: (amount: number) => void;
  isTitleMode: () => boolean;
}

export function createEventEffects({ spawnSteamBurst, spawnSparkBurst, spawnPulseRing, spawnOpPopup, addTrauma, isTitleMode }: EffectActions) {
    return function emitEventFx(ev: SimEvent) {
      const w = hexToWorld(ev.coord);
      if (ev.type === 'deliver' || ev.type === 'weld' || ev.type === 'spawn' || ev.type === 'cut') {
        const burstCount = ev.type === 'deliver' ? 8 : ev.type === 'cut' ? 4 : 3;
        spawnSteamBurst(w.x, w.z, burstCount);
      }
      if (ev.type === 'weld' || ev.type === 'cut' || ev.type === 'transform' || ev.type === 'destroy') {
        spawnSparkBurst(w.x, w.z, ev.type === 'transform' ? 6 : 9);
      }
      if (ev.type === 'deliver') {
        spawnPulseRing(w.x, w.z, 0x26b557, 1.95);
        addTrauma(0.16);
      } else if (ev.type === 'weld') {
        spawnPulseRing(w.x, w.z, 0xfbbf24, 1.7);
        addTrauma(0.14);
      } else if (ev.type === 'cut') {
        spawnPulseRing(w.x, w.z, 0x38bdf8, 1.7);
        addTrauma(0.14);
      } else if (ev.type === 'destroy') {
        spawnPulseRing(w.x, w.z, 0xf97316, 1.75);
        addTrauma(0.14);
      } else if (ev.type === 'transform') {
        spawnPulseRing(w.x, w.z, 0xfde047, 1.82, 0);
        spawnPulseRing(w.x, w.z, 0xffffff, 1.35, 0.05);
      } else if (ev.type === 'store') {
        spawnPulseRing(w.x, w.z, 0xfde047, 1.55);
      } else if (ev.type === 'collision' || ev.type === 'error') {
        spawnPulseRing(w.x, w.z, 0xff3b30, 1.95, 0);
        spawnPulseRing(w.x, w.z, 0xff3b30, 2.25, 0.11);
        addTrauma(0.55);
      }
      if (ev.badge && !isTitleMode()) {
        spawnOpPopup(w.x, w.z, ev.badge, ev.severity);
      }
    }

}
