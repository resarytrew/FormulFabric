import type { PlacedBlock } from './storage';

export function getBlocksSignature(blocks: PlacedBlock[]): string {
  return blocks
    .slice()
    .sort((a, b) => a.coord.q - b.coord.q || a.coord.r - b.coord.r)
    .map((b) => `${b.type}@${b.coord.q},${b.coord.r}:${JSON.stringify(b.config)}`)
    .join('|');
}

