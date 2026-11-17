import type { AxialCoord } from './coordinates';

export interface TokenRotation {
  pivot: AxialCoord;
  angleDelta: number;
}

export type TokenMoveSource =
  | 'conveyor'
  | 'pusher'
  | 'magnet'
  | 'rotator'
  | 'spawner'
  | 'split'
  | 'jump'
  | 'swap';

export type ConsumedTokenKind = 'deliver' | 'store' | 'destroy' | 'merge';

export interface ConsumedTokenVisual {
  id: string;
  value: number;
  coord: AxialCoord;
  prevCoord: AxialCoord;
  moveSource?: TokenMoveSource;
  rotatedFrom?: TokenRotation;
  kind: ConsumedTokenKind;
}

