import type { LevelDefinition, SimulationWorld } from './types';
import type { createWorldFromLevel } from './world';

const base: LevelDefinition = { id: 'errors', index: 99, title: '', subtitle: '', tier: 'Начальный', radius: 2, availableTools: [], requiredDeliveries: 1, presetMachines: [], pedagogyNote: '', bonusGoalText: '' };
export function errorScenarios(createWorld: typeof createWorldFromLevel): Record<string, SimulationWorld> {
  const overflow = createWorld({ ...base, presetMachines: [
    { type: 'spawner', coord: { q: -2, r: 0 }, locked: true, config: { dir: 0, sequence: [600] } },
    { type: 'mul2', coord: { q: -1, r: 0 }, locked: true, config: { dir: 0 } },
  ] });
  const conflict = createWorld({ ...base, presetMachines: [
    { type: 'conveyor', coord: { q: 0, r: 0 }, locked: true, config: { dir: 0 } },
    { type: 'conveyor', coord: { q: 1, r: 0 }, locked: true, config: { dir: 3 } },
  ] });
  conflict.tokens.set('t_1', { id: 't_1', value: 1, coord: { q: 0, r: 0 }, prevCoord: { q: 0, r: 0 }, spawnOrder: 1 });
  conflict.tokens.set('t_2', { id: 't_2', value: 2, coord: { q: 1, r: 0 }, prevCoord: { q: 1, r: 0 }, spawnOrder: 2 });
  conflict.bonds.push({ a: 't_1', b: 't_2' });
  return { overflow, conflict };
}
