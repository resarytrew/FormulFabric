import { hexDistance, hexKey, hexToWorld, rotateAroundPivot, worldToHex } from './hex-math';
import type { AxialCoord, HexKey } from './types';

/**
 * Computes intermediate hex coordinates swept by a token rotating 60° around pivot.
 * Distance-1 orbits sweep cleanly across the shared hex edge; radius >= 2 arms sweep through
 * intermediate sector hexes whose clearance must be verified against solid housings & other spheres.
 */
export function getRotationSweptHexes(
  coord: AxialCoord,
  pivot: AxialCoord,
  cwSteps: 1 | -1,
): AxialCoord[] {
  if (hexDistance(coord, pivot) <= 1) {
    return [];
  }
  const dest = rotateAroundPivot(coord, pivot, cwSteps);
  const pW = hexToWorld(pivot);
  const sW = hexToWorld(coord);
  const dx = sW.x - pW.x;
  const dz = sW.z - pW.z;
  const totalAngle = cwSteps === 1 ? Math.PI / 3 : -Math.PI / 3;
  const seen = new Set<HexKey>([hexKey(coord), hexKey(dest), hexKey(pivot)]);
  const swept: AxialCoord[] = [];
  const SAMPLES = 10;
  for (let i = 1; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const ang = totalAngle * u;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const wx = pW.x + (dx * cos - dz * sin);
    const wz = pW.z + (dx * sin + dz * cos);
    const midHex = worldToHex(wx, wz);
    const mk = hexKey(midHex);
    if (!seen.has(mk)) {
      seen.add(mk);
      swept.push(midHex);
    }
  }
  return swept;
}

