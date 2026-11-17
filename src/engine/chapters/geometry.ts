import { generateHexDisk, hexEqual } from '../hex-math';
import type { AxialCoord } from '../types';

export function diskExcept(radius: number, excluded: AxialCoord[]): AxialCoord[] {
  return generateHexDisk(radius).filter(c => !excluded.some(ex => hexEqual(c, ex)));
}
