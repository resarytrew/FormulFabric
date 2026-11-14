import type { AxialCoord, HexDir, HexKey } from './types';

export const HEX_DIRS: readonly AxialCoord[] = [
  { q: 1, r: 0 },   // 0: East
  { q: 0, r: 1 },   // 1: South-East
  { q: -1, r: 1 },  // 2: South-West
  { q: -1, r: 0 },  // 3: West
  { q: 0, r: -1 },  // 4: North-West
  { q: 1, r: -1 },  // 5: North-East
];

export const DIR_LABELS_RU: readonly string[] = [
  'Восток (→)',
  'Юго-восток (↘)',
  'Юго-запад (↙)',
  'Запад (←)',
  'Северо-запад (↖)',
  'Северо-восток (↗)',
];

export function hexKey(c: AxialCoord): HexKey {
  return `${c.q},${c.r}`;
}

export function parseHexKey(key: HexKey): AxialCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexEqual(a: AxialCoord, b: AxialCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: AxialCoord, b: AxialCoord): AxialCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSub(a: AxialCoord, b: AxialCoord): AxialCoord {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexNeighbor(c: AxialCoord, dir: HexDir): AxialCoord {
  const d = HEX_DIRS[dir];
  return { q: c.q + d.q, r: c.r + d.r };
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function rotateDir(dir: HexDir, steps: number): HexDir {
  return (((dir + steps) % 6 + 6) % 6) as HexDir;
}

export function oppositeDir(dir: HexDir): HexDir {
  return ((dir + 3) % 6) as HexDir;
}

/**
 * Rotate axial offset by steps * 60deg clockwise around (0, 0).
 * 60deg CW: (q, r) -> (-r, q + r)
 * 60deg CCW: (q, r) -> (q + r, -q)
 */
export function rotateAxialOffset(offset: AxialCoord, cwSteps: number): AxialCoord {
  const steps = ((cwSteps % 6) + 6) % 6;
  let q = offset.q;
  let r = offset.r;
  for (let i = 0; i < steps; i++) {
    const nq = -r;
    const nr = q + r;
    q = nq;
    r = nr;
  }
  return { q: q === 0 ? 0 : q, r: r === 0 ? 0 : r };
}

export function rotateAroundPivot(
  coord: AxialCoord,
  pivot: AxialCoord,
  cwSteps: number,
): AxialCoord {
  const rel = hexSub(coord, pivot);
  const rot = rotateAxialOffset(rel, cwSteps);
  return hexAdd(pivot, rot);
}

/**
 * Pointy-top hex to 3D XZ world coordinates.
 * Spacing radius = hexSize.
 */
export const HEX_SIZE = 1.05;
const SQRT3 = Math.sqrt(3);

export function hexToWorld(c: AxialCoord, hexSize = HEX_SIZE): { x: number; z: number } {
  const x = hexSize * SQRT3 * (c.q + c.r * 0.5);
  const z = hexSize * 1.5 * c.r;
  return { x, z };
}

export function worldToHex(x: number, z: number, hexSize = HEX_SIZE): AxialCoord {
  const qf = ((SQRT3 / 3) * x - (1 / 3) * z) / hexSize;
  const rf = ((2 / 3) * z) / hexSize;
  return axialRound(qf, rf);
}

export function axialRound(qf: number, rf: number): AxialCoord {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);

  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  }
  return { q: q === 0 ? 0 : q, r: r === 0 ? 0 : r };
}

export function generateHexDisk(radius: number): AxialCoord[] {
  const res: AxialCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      res.push({ q, r });
    }
  }
  return res;
}

export function dirToWorldYaw(dir: HexDir): number {
  return -dir * (Math.PI / 3);
}
