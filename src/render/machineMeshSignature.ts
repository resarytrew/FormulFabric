import type { HexKey, MachineInstance } from '../engine/types';
import { computeConveyorTopology } from './conveyorTopology';

/** Inputs used to build a mesh, including the neighbouring conveyor topology. */
export function machineMeshSignature(machine: MachineInstance, machines: Map<HexKey, MachineInstance>, theme: string): string {
  return JSON.stringify({
    id: machine.id,
    type: machine.type,
    coord: machine.coord,
    config: machine.config,
    memory: machine.state.memory,
    theme,
    topology: machine.type === 'conveyor' ? computeConveyorTopology(machine, machines) : undefined,
  });
}
