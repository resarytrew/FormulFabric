import type { HexKey, MachineInstance } from '../engine/types';

/** Inputs used by sockets, conveyor connectors and inlaid channels. */
export function decorationSignature(machines: Map<HexKey, MachineInstance>, platform: Set<HexKey>, theme: string): string {
  return JSON.stringify({
    theme,
    platform: [...platform].sort(),
    machines: [...machines.entries()].map(([key, machine]) => ({ key, type: machine.type, coord: machine.coord, config: machine.config })),
  });
}

export function createDecorationSynchronizer() {
  let previous: string | undefined;
  return (signature: string, rebuild: () => void): boolean => {
    if (signature === previous) return false;
    rebuild();
    previous = signature;
    return true;
  };
}
