export type HexDir = 0 | 1 | 2 | 3 | 4 | 5;

export interface AxialCoord {
  q: number;
  r: number;
}

export type HexKey = string; // `${q},${r}`

