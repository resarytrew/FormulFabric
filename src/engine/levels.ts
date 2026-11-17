import type { LevelDefinition } from './types';
import { ALL_TOOLS } from './machine-catalog';
import { CAMPAIGN_LEVELS } from './chapters/campaign';
import { EUREKA_LEVELS } from './chapters/eureka';
import { IMPOSSIBLE_LEVELS } from './chapters/impossible';
import { GRADE5_LEVELS } from './chapters/grade5';

export { ALL_TOOLS, TOOL_METADATA } from './machine-catalog';
export type { ToolMeta } from './machine-catalog';
export { CAMPAIGN_LEVELS, EUREKA_LEVELS, IMPOSSIBLE_LEVELS, GRADE5_LEVELS };

export const ALL_PUZZLE_LEVELS: LevelDefinition[] = [
  ...CAMPAIGN_LEVELS,
  ...EUREKA_LEVELS,
  ...IMPOSSIBLE_LEVELS,
  ...GRADE5_LEVELS,
];

export const SANDBOX_LEVEL: LevelDefinition = {
  id: 'sandbox',
  index: 0,
  title: 'Песочница',
  subtitle: 'Свободное проектирование фабрик, полимеров и математических конвейеров',
  tier: 'Продвинутый',
  radius: 5,
  availableTools: ALL_TOOLS,
  requiredDeliveries: 0,
  infiniteMode: true,
  presetMachines: [
    {
      type: 'spawner',
      coord: { q: -3, r: 0 },
      locked: false,
      config: { dir: 0, sequence: [1, 2, 3, 4], loopSequence: true, spawnInterval: 3 },
    },
    {
      type: 'sink',
      coord: { q: 3, r: 0 },
      locked: false,
      config: {
        dir: 0,
        sinkId: 'sandbox-out',
        targetPattern: {
          mode: 'exact',
          nodes: [{ offset: { q: 0, r: 0 } }],
          edges: [],
          rotationInvariant: true,
          label: 'Любое',
        },
      },
    },
  ],
  demoSolution: [
    { type: 'conveyor', coord: { q: -2, r: 0 }, config: { dir: 0 } },
    { type: 'add1', coord: { q: -1, r: 0 }, config: { dir: 0 } },
    { type: 'mul2', coord: { q: 0, r: 0 }, config: { dir: 0 } },
    { type: 'conveyor', coord: { q: 1, r: 0 }, config: { dir: 0 } },
    { type: 'conveyor', coord: { q: 2, r: 0 }, config: { dir: 0 } },
  ],
  pedagogyNote: 'Свободный режим: стройте любые схемы, добавляйте источники, инверторы, дубликаторы, магниты и ротаторы.',
  bonusGoalText: 'Без ограничений',
};
