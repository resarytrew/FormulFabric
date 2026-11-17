import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFootprintOverlaps,
  createWorldFromLevel,
  findLayoutConflicts,
  findLayoutConflictsForLevel,
  getBlockedPlacementInfo,
  getMachineFootprint,
  getMachineOccupiedHexes,
  lintPattern,
  resolveFinalPlacement,
  validateLevelFootprints,
  validateLevelPlacement,
} from './hex-engine';
import type { PlacedBlock } from '../services/storage';
import { generateHexDisk, hexKey } from './hex-math';
import { ALL_PUZZLE_LEVELS, SANDBOX_LEVEL } from './levels';
import type { LevelDefinition, MachineConfig, MachineType, TargetPattern } from './types';

const TWO_NODE_PATTERN: TargetPattern = {
  mode: 'exact',
  nodes: [
    { offset: { q: 0, r: 0 }, value: 1 },
    { offset: { q: 1, r: 0 }, value: 2 },
  ],
  edges: [{ fromIdx: 0, toIdx: 1 }],
  rotationInvariant: false,
  label: 'Два числа',
};

function emptyLevel(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return {
    id: 'placement-test',
    index: 99,
    title: 'Placement',
    subtitle: '',
    tier: 'Начальный',
    radius: 3,
    availableTools: ['sink', 'conveyor', 'pusher'],
    requiredDeliveries: 1,
    presetMachines: [],
    pedagogyNote: '',
    bonusGoalText: '',
    ...overrides,
  };
}

const TWO_PAD_SINK = {
  type: 'sink' as const,
  coord: { q: 0, r: 0 },
  locked: true,
  config: {
    dir: 0 as const,
    sinkId: 'test',
    targetPattern: TWO_NODE_PATTERN,
  },
};

test('getMachineFootprint covers every receiver pad and the centre for single-hex machines', () => {
  const sink = { type: 'sink' as const, coord: { q: 2, r: -1 }, config: TWO_PAD_SINK.config };
  assert.deepEqual(getMachineFootprint(sink), [
    { q: 2, r: -1 },
    { q: 3, r: -1 },
  ]);
  // The centre is part of the occupied space even when the pattern omits it.
  const offsetOnly = {
    type: 'sink' as const,
    coord: { q: 2, r: -1 },
    config: {
      ...TWO_PAD_SINK.config,
      targetPattern: { ...TWO_NODE_PATTERN, nodes: [{ offset: { q: 1, r: 0 }, value: 2 }], edges: [] },
    },
  };
  assert.deepEqual(getMachineOccupiedHexes(offsetOnly), [
    { q: 2, r: -1 },
    { q: 3, r: -1 },
  ]);
  // Single-hex machines are counted exactly once.
  assert.deepEqual(
    getMachineOccupiedHexes({ type: 'conveyor', coord: { q: 1, r: 1 }, config: { dir: 0 } }),
    [{ q: 1, r: 1 }],
  );
});

test('нельзя перекрыть площадку приёмника', () => {
  const level = emptyLevel({ presetMachines: [TWO_PAD_SINK] });
  const errors = checkFootprintOverlaps(level, [
    {
      type: 'sink',
      coord: { q: 0, r: 0 },
      config: {
        dir: 0,
        sinkId: 'test',
        targetPattern: {
          mode: 'exact',
          nodes: [
            { offset: { q: 0, r: 0 } },
            { offset: { q: 1, r: 0 } },
          ],
          edges: [{ fromIdx: 0, toIdx: 1 }],
          rotationInvariant: false,
          label: 'Два числа',
        },
      },
    },
    {
      type: 'conveyor',
      coord: { q: 1, r: 0 },
      config: { dir: 0 },
    },
  ]);

  assert.ok(errors.some(e => e.includes('Пересечение')));
});

test('side pad of a multi-cell receiver is rejected for every machine type', () => {
  const level = emptyLevel({ presetMachines: [TWO_PAD_SINK] });
  const padBlocks: Array<{ type: MachineType; coord: { q: number; r: number }; config: MachineConfig }> = [
    { type: 'conveyor', coord: { q: 1, r: 0 }, config: { dir: 0 } },
    { type: 'pusher', coord: { q: 1, r: 0 }, config: { dir: 3 } },
  ];
  for (const block of padBlocks) {
    assert.ok(
      checkFootprintOverlaps(level, [block]).some(e => e.includes('Пересечение')),
      `${block.type} on a receiver pad must be rejected`,
    );
    const placementErrors = validateLevelPlacement(level, [block]);
    assert.ok(
      placementErrors.some(e => e.includes('Пересечение')),
      `validateLevelPlacement must reject ${block.type} on a receiver pad`,
    );
    // The invalid layout never becomes a different set of machines in the world.
    const world = createWorldFromLevel(level, [block]);
    assert.equal(world.status, 'error');
    assert.match(world.errorReason ?? '', /Пересечение/);
  }
});

test('receiver pads must stay on platform and off narrow chasms', () => {
  const platform = new Set(generateHexDisk(3).map(hexKey));
  const narrowGap = new Set([hexKey({ q: 1, r: 0 })]);
  narrowGap.forEach((k) => platform.add(k));
  const centred = emptyLevel({ presetMachines: [{ ...TWO_PAD_SINK, coord: { q: 3, r: 0 } }] });

  const diskOnly = new Set(generateHexDisk(3).map(hexKey));
  const offPlatform = validateLevelFootprints(centred, [], diskOnly, new Set());
  assert.ok(offPlatform.some(e => e.includes('(4, 0)') && e.includes('вне платформы')));

  const onGap = emptyLevel({ presetMachines: [TWO_PAD_SINK] });
  const gapErrors = validateLevelFootprints(onGap, [], platform, narrowGap);
  assert.ok(gapErrors.some(e => e.includes('разлом') && e.includes('(1, 0)')));

  // A sink that is fully on solid ground reports nothing.
  assert.deepEqual(validateLevelFootprints(emptyLevel({ presetMachines: [TWO_PAD_SINK] }), [], platform, new Set()), []);
});

test('a receiver placed by the player also claims all of its pads', () => {
  const level = emptyLevel({ availableTools: ['sink', 'conveyor'] });
  const errors = checkFootprintOverlaps(level, [
    { type: 'sink', coord: { q: 0, r: 0 }, config: TWO_PAD_SINK.config },
    { type: 'conveyor', coord: { q: 1, r: 0 }, config: { dir: 0 } },
    { type: 'conveyor', coord: { q: 0, r: 1 }, config: { dir: 0 } },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Пересечение/);
  assert.ok(!errors[0].includes('0,1'), 'unrelated free hexes must not be reported');
});

test('replaceable preset machines are not permanent obstacles for their replacement', () => {
  const replaceable: LevelDefinition = emptyLevel({
    availableTools: ['conveyor', 'add1', 'sink'],
    presetMachines: [
      { type: 'conveyor', coord: { q: 0, r: 0 }, locked: false, config: { dir: 0 } },
      { type: 'sink', coord: { q: 2, r: 0 }, locked: false, config: { dir: 0, sinkId: 'sandbox-out', targetPattern: TWO_PAD_SINK.config.targetPattern! } },
    ],
  });

  // Replacing the unlocked preset on its own hex is fine…
  assert.deepEqual(
    validateLevelPlacement(replaceable, [{ type: 'add1', coord: { q: 0, r: 0 }, config: { dir: 0 } }]),
    [],
  );
  // …and the replacement really does appear in the resulting world.
  const world = createWorldFromLevel(replaceable, [{ type: 'add1', coord: { q: 0, r: 0 }, config: { dir: 0 } }]);
  assert.notEqual(world.status, 'error');
  assert.equal(world.machines.get('0,0')?.type, 'add1');

  // Moving the unlocked receiver is fine as long as the old pads are freed.
  assert.deepEqual(
    validateLevelPlacement(replaceable, [
      { type: 'conveyor', coord: { q: 0, r: 0 }, config: { dir: 0 } },
      { type: 'sink', coord: { q: 2, r: 0 }, config: { dir: 0, sinkId: 'sandbox-out', targetPattern: TWO_PAD_SINK.config.targetPattern! } },
    ]),
    [],
  );
});

test('locked fixtures still block and the resolved arrangement matches the built world', () => {
  const level = emptyLevel({ presetMachines: [TWO_PAD_SINK] });
  assert.deepEqual(
    validateLevelPlacement(level, [{ type: 'conveyor', coord: { q: 0, r: 1 }, config: { dir: 0 } }]),
    [],
  );
  const onLockedCentre = validateLevelPlacement(level, [{ type: 'conveyor', coord: { q: 0, r: 0 }, config: { dir: 0 } }]);
  assert.ok(onLockedCentre.some(e => e.includes('фиксированный модуль')));

  const finalPlacement = resolveFinalPlacement(level, [{ type: 'conveyor', coord: { q: 0, r: 1 }, config: { dir: 0 } }]);
  const world = createWorldFromLevel(level, [{ type: 'conveyor', coord: { q: 0, r: 1 }, config: { dir: 0 } }]);
  assert.equal(finalPlacement.length, world.machines.size);
  for (const machine of finalPlacement) {
    assert.deepEqual(
      world.machines.get(hexKey(machine.coord))?.type,
      machine.type,
      `resolved arrangement must match the world at ${hexKey(machine.coord)}`,
    );
  }
});

test('sandbox preset receiver can be moved without colliding with its own old position', () => {
  const blocks = [
    { type: 'sink' as const, coord: { q: 3, r: 0 }, config: { dir: 0 as const, sinkId: 'sandbox-out', targetPattern: SANDBOX_LEVEL.presetMachines[1].config.targetPattern! } },
    { type: 'conveyor' as const, coord: { q: -2, r: 0 }, config: { dir: 0 as const } },
  ];
  assert.deepEqual(validateLevelPlacement(SANDBOX_LEVEL, blocks), []);
});

test('invalid coordinates inside a receiver pattern are reported, not crashed on', () => {
  const level = emptyLevel();
  const broken = {
    type: 'sink' as const,
    coord: { q: 0, r: 0 },
    config: {
      dir: 0 as const,
      sinkId: 'test',
      targetPattern: {
        ...TWO_NODE_PATTERN,
        nodes: [{ offset: { q: 0.5, r: 0 }, value: 1 }],
      } as TargetPattern,
    },
  };
  const errors = checkFootprintOverlaps(level, [broken]);
  assert.ok(errors.some(e => e.includes('неверные координаты')));
});

test('resolved arrangement matches the built world for every shipped solution', () => {
  for (const level of [...ALL_PUZZLE_LEVELS, SANDBOX_LEVEL]) {
    const solutions = [
      level.demoSolution ?? [],
      ...(level.altDemoSolutions ?? []).map((a) => a.blocks),
    ];
    for (const blocks of solutions) {
      const finalPlacement = resolveFinalPlacement(level, blocks);
      const world = createWorldFromLevel(level, blocks);
      assert.notEqual(world.status, 'error', `${level.id} must accept its own reference solution`);
      assert.equal(
        finalPlacement.length,
        world.machines.size,
        `${level.id}: resolved arrangement must have one entry per built machine`,
      );
      // Every occupied cell of every resolved machine is actually owned by it.
      for (const machine of finalPlacement) {
        const centre = world.machines.get(hexKey(machine.coord));
        assert.equal(centre?.type, machine.type, `${level.id}: ${hexKey(machine.coord)} must hold ${machine.type}`);
        for (const cell of getMachineOccupiedHexes(machine)) {
          const key = hexKey(cell);
          if (machine.type === 'sink') {
            assert.equal(world.sinkFootprintHexes.get(key), centre?.id, `${level.id}: pad ${key} must belong to ${machine.type}`);
          } else {
            assert.equal(world.sinkFootprintHexes.get(key), undefined, `${level.id}: non-sink ${key} must not claim a pad`);
          }
        }
      }
      // No two machines in a reference solution share a cell.
      assert.deepEqual(validateLevelFootprints(level, blocks, world.platformHexes, world.narrowGapHexes), []);
    }
  }
});

test('getBlockedPlacementInfo only lets a receiver use its own pads', () => {
  const level = emptyLevel({ presetMachines: [TWO_PAD_SINK] });
  const world = createWorldFromLevel(level, []);
  const sinkId = world.machines.get('0,0')!.id;

  assert.equal(getBlockedPlacementInfo(world, { q: 1, r: 0 }).blocked, true);
  assert.equal(getBlockedPlacementInfo(world, { q: 1, r: 0 }, { allowedOwnerId: sinkId }).blocked, false);
  assert.equal(getBlockedPlacementInfo(world, { q: 1, r: 0 }, { allowedOwnerId: 'm_someone_else' }).blocked, true);
  // The centre stays closed to everything but its own fixture rules.
  assert.equal(getBlockedPlacementInfo(world, { q: 0, r: 0 }, { allowedOwnerId: sinkId }).blocked, true);
});

test('unlocked sink is replaced in actual world', () => {
  const blocks = [{
    type: 'conveyor' as const,
    coord: { q: 3, r: 0 },
    config: { dir: 0 as const },
  }];

  assert.deepEqual(
    validateLevelPlacement(SANDBOX_LEVEL, blocks),
    [],
  );

  const world = createWorldFromLevel(SANDBOX_LEVEL, blocks);

  assert.equal(world.machines.get('3,0')?.type, 'conveyor');
  assert.equal(world.sinkFootprintHexes.has('3,0'), false);
});

test('validated layout and built world always agree', () => {
  // Every accepted layout must produce exactly the machines the resolver
  // predicted — no preset may be resurrected behind a replacement.
  const layouts: Array<{ name: string; blocks: Array<{ type: MachineType; coord: { q: number; r: number }; config: MachineConfig }> }> = [
    {
      name: 'replace preset sink',
      blocks: [{ type: 'conveyor', coord: { q: 3, r: 0 }, config: { dir: 0 } }],
    },
    {
      name: 'replace preset spawner',
      blocks: [{ type: 'conveyor', coord: { q: -3, r: 0 }, config: { dir: 0 } }],
    },
    {
      name: 'replace both presets and add traffic',
      blocks: [
        { type: 'conveyor', coord: { q: -3, r: 0 }, config: { dir: 0 } },
        { type: 'add1', coord: { q: -2, r: 0 }, config: { dir: 0 } },
        { type: 'conveyor', coord: { q: 3, r: 0 }, config: { dir: 0 } },
      ],
    },
    {
      name: 'keep everything',
      blocks: [{ type: 'conveyor', coord: { q: 0, r: 0 }, config: { dir: 0 } }],
    },
  ];

  for (const layout of layouts) {
    assert.deepEqual(validateLevelPlacement(SANDBOX_LEVEL, layout.blocks), [], `${layout.name}: must be valid`);
    const world = createWorldFromLevel(SANDBOX_LEVEL, layout.blocks);
    assert.notEqual(world.status, 'error', `${layout.name}: must build`);

    const resolved = resolveFinalPlacement(
      SANDBOX_LEVEL,
      layout.blocks,
      world.platformHexes,
      world.narrowGapHexes,
    );
    assert.equal(world.machines.size, resolved.length, `${layout.name}: machine count`);
    for (const machine of resolved) {
      const built = world.machines.get(hexKey(machine.coord));
      assert.equal(built?.type, machine.type, `${layout.name}: ${hexKey(machine.coord)} holds ${machine.type}`);
      assert.equal(built?.locked, machine.locked, `${layout.name}: ${hexKey(machine.coord)} lock flag`);
    }
  }
});

test('a dragged receiver may use its own pads, and the whole layout is revalidated', () => {
  // A player-owned multi-cell receiver: the editor lets it be dragged within its
  // own footprint, but the resulting layout must still pass full validation.
  const level = emptyLevel({ availableTools: ['sink', 'conveyor'] });
  const placed = { type: 'sink' as const, coord: { q: 0, r: 0 }, config: TWO_PAD_SINK.config };
  const world = createWorldFromLevel(level, [placed]);
  const sinkId = world.machines.get('0,0')!.id;
  const ownPad = { q: 1, r: 0 };

  // Own pad of the moving receiver: allowed via its own owner id only.
  assert.equal(getBlockedPlacementInfo(world, ownPad, { allowedOwnerId: sinkId }).blocked, false);
  assert.equal(getBlockedPlacementInfo(world, ownPad, { allowedOwnerId: undefined }).blocked, true);
  assert.equal(getBlockedPlacementInfo(world, ownPad, { allowedOwnerId: 'm_other' }).blocked, true);

  // Dragging it one hex east: still valid, and the only sink in the world.
  const moved = [{ ...placed, coord: { q: 1, r: 0 } }];
  assert.deepEqual(validateLevelPlacement(level, moved), []);
  const movedWorld = createWorldFromLevel(level, moved);
  assert.equal(movedWorld.machines.size, 1);
  assert.equal(movedWorld.machines.get('1,0')?.type, 'sink');
  assert.equal(movedWorld.sinkFootprintHexes.get('2,0'), movedWorld.machines.get('1,0')?.id);

  // A machine already sitting inside the new footprint rejects the drag.
  const blockedMove = [{ ...placed, coord: { q: 1, r: 0 } }, { type: 'conveyor' as const, coord: { q: 2, r: 0 }, config: { dir: 0 as const } }];
  assert.ok(
    validateLevelPlacement(level, blockedMove).some((e) => e.includes('Пересечение')),
    'the moved receiver must not claim a hex occupied by another machine',
  );
});

test('pattern linter reports structural corruption of a receiver pattern', () => {
  const base: TargetPattern = {
    mode: 'exact',
    nodes: [
      { offset: { q: 0, r: 0 }, value: 1 },
      { offset: { q: 1, r: 0 }, value: 2 },
    ],
    edges: [{ fromIdx: 0, toIdx: 1 }],
    rotationInvariant: false,
    label: 'ok',
  };
  assert.deepEqual(lintPattern(base), []);

  assert.ok(lintPattern({ ...base, nodes: [...base.nodes, { offset: { q: 1, r: 0 }, value: 3 }] })
    .some((e) => e.includes('повторяет координаты')));
  assert.ok(lintPattern({ ...base, edges: [{ fromIdx: 0, toIdx: 7 }] })
    .some((e) => e.includes('несуществующую вершину')));
  assert.ok(lintPattern({ ...base, edges: [{ fromIdx: 1, toIdx: 0 }, { fromIdx: 0, toIdx: 1 }] })
    .some((e) => e.includes('дублирует')));
  assert.ok(lintPattern({ ...base, edges: [{ fromIdx: 0, toIdx: 0 }] })
    .some((e) => e.includes('саму с собой')));
  assert.ok(lintPattern({ ...base, expectedNodeValues: [[1, 2], [3]] })
    .some((e) => e.includes('описывает 1 звеньев')));
  assert.ok(lintPattern({ ...base, mode: 'sum_shape' })
    .some((e) => e.includes('требуемую сумму')));
  assert.ok(lintPattern({ ...base, mode: 'growth_ladder' })
    .some((e) => e.includes('шаг роста')));
  assert.deepEqual(lintPattern({ ...base, nodes: [] }), ['образец приёмника не содержит ни одной вершины']);
});

test('corrupted receiver config is reported instead of throwing', () => {
  const level = emptyLevel({ availableTools: ['sink'] });
  const noConfig = {
    type: 'sink' as const,
    coord: { q: 0, r: 0 },
    config: undefined as unknown as MachineConfig,
  };
  assert.doesNotThrow(() => getMachineFootprint({ ...noConfig }));
  assert.deepEqual(getMachineFootprint({ ...noConfig }), [{ q: 0, r: 0 }]);
  const errors = validateLevelPlacement(level, [noConfig]);
  assert.ok(errors.some((e) => e.includes('Некорректные данные')));
  assert.equal(createWorldFromLevel(level, [noConfig]).status, 'error');

  const noPattern = { type: 'sink' as const, coord: { q: 0, r: 0 }, config: { dir: 0 as const, sinkId: 'x' } };
  assert.ok(validateLevelPlacement(level, [noPattern]).some((e) => e.includes('не содержит образца')));
  assert.equal(createWorldFromLevel(level, [noPattern]).status, 'error');
});

test('stored layout conflicts are reported without touching the saved blocks', () => {
  const level = emptyLevel({ availableTools: ['sink', 'conveyor'], presetMachines: [TWO_PAD_SINK] });
  const stored: PlacedBlock[] = [
    { type: 'conveyor', coord: { q: 0, r: 1 }, config: { dir: 0 } as MachineConfig },
    { type: 'conveyor', coord: { q: 1, r: 0 }, config: { dir: 0 } as MachineConfig },
  ];
  const snapshot = JSON.stringify(stored);

  const conflicts = findLayoutConflictsForLevel(level, stored);
  assert.ok(conflicts.some((c) => c.includes('Пересечение')));
  // Reporting is side-effect free: the saved layout is preserved verbatim.
  assert.equal(JSON.stringify(stored), snapshot);

  assert.deepEqual(findLayoutConflicts(stored), []);
  assert.ok(findLayoutConflicts([
    { type: 'conveyor', coord: { q: 0, r: 0 }, config: { dir: 0 } as MachineConfig },
    { type: 'conveyor', coord: { q: 0, r: 0 }, config: { dir: 1 } as MachineConfig },
  ]).some((c) => c.includes('Дублирующий')));
});

test('an already-conflicted layout can still be repaired', () => {
  // Regression for the editor guard: an edit that removes a conflict must be
  // accepted even though the starting layout is invalid, and the world must
  // still build from the repaired layout.
  const level = emptyLevel({ availableTools: ['sink', 'conveyor'], presetMachines: [TWO_PAD_SINK] });
  const conflicted: PlacedBlock[] = [
    { type: 'conveyor', coord: { q: 1, r: 0 }, config: { dir: 0 } as MachineConfig },
  ];
  assert.ok(validateLevelPlacement(level, conflicted).some((e) => e.includes('Пересечение')));

  const repaired: PlacedBlock[] = [];
  assert.deepEqual(validateLevelPlacement(level, repaired), []);
  const world = createWorldFromLevel(level, repaired);
  assert.notEqual(world.status, 'error');
  assert.equal(world.machines.size, 1, 'only the locked fixture remains');
});

test('resolved arrangement never keeps a preset the player partially took over', () => {
  const level = emptyLevel({
    availableTools: ['sink', 'conveyor'],
    presetMachines: [{ ...TWO_PAD_SINK, locked: false }],
  });
  // Player block on the preset's side pad: the preset must give way, otherwise
  // the world would contain a receiver missing one of its pads.
  const blocks = [{ type: 'conveyor' as const, coord: { q: 1, r: 0 }, config: { dir: 0 as const } }];
  const resolved = resolveFinalPlacement(level, blocks);
  assert.deepEqual(resolved.map((m) => `${m.type}@${hexKey(m.coord)}`), ['conveyor@1,0']);

  const world = createWorldFromLevel(level, blocks);
  assert.notEqual(world.status, 'error');
  assert.equal(world.machines.size, 1);
  assert.equal(world.machines.get('1,0')?.type, 'conveyor');
  // A locked preset is never displaced, which stays a reported conflict.
  const lockedLevel = emptyLevel({ availableTools: ['sink', 'conveyor'], presetMachines: [TWO_PAD_SINK] });
  assert.ok(validateLevelPlacement(lockedLevel, blocks).some((e) => e.includes('Пересечение')));
});
