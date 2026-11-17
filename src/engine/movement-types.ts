import type { AxialCoord, HexDir, MachineType } from './types';

export type ThrustTier = 1 | 2;

export type ComponentIntent =
  | {
      kind: 'move';
      dir: HexDir;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
      pushChainIndex?: number;
    }
  | {
      kind: 'jump';
      dir: HexDir;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'rotate';
      pivot: AxialCoord;
      cwSteps: 1 | -1;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    }
  | {
      kind: 'swap';
      pivot: AxialCoord;
      tier: ThrustTier;
      signature: string;
      sourceCoord: AxialCoord;
      sourceMachineType: MachineType;
    };

