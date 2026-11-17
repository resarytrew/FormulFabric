import { hexKey } from './hex-math';
import type {
  AxialCoord,
  HexKey,
  LevelDefinition,
  MachineConfig,
  MachineType,
  TargetPattern,
} from './types';

/**
 * A machine that participates in placement validation: a level fixture or a
 * player-placed block. `locked` matters because unlocked preset machines are
 * replaceable and therefore must not act as permanent obstacles.
 */
export type PlacedMachine = {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
  locked?: boolean;
};

export type FootprintMachine = {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
};

/** A single machine in the definitive arrangement that becomes the world. */
export type FinalMachine = {
  /** `level.presetMachines[i]` for fixtures, `player[i]` for player blocks. */
  origin: `preset:${number}` | `player:${number}`;
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
  locked: boolean;
  /**
   * For a player block: the index of the unlocked preset whose *centre* it
   * stands on. This is the only rule that replaces a preset — a block on a
   * receiver pad is a conflict, never a silent removal.
   */
  replacesPresetIndex?: number;
};

/**
 * A single, machine-readable placement problem. `coords` is exactly what the
 * player must look at, so the UI can highlight the offending cell or receiver
 * pad instead of guessing from a sentence.
 */
export interface PlacementIssue {
  /** Stable machine-readable code, e.g. `overlap`, `pad@chasm`. */
  code: PlacementIssueCode;
  message: string;
  coords: AxialCoord[];
  /** Index into the player block list, when the issue belongs to one block. */
  machineIndex?: number;
}

export type PlacementIssueCode =
  | 'invalid-data'
  | 'invalid-direction'
  | 'unknown-pattern'
  | 'invalid-pattern'
  | 'tool-unavailable'
  | 'duplicate'
  | 'outside-platform'
  | 'narrow-chasm'
  | 'locked-fixture'
  | 'overlap'
  | 'total-limit'
  | 'part-limit';

export function issue(
  code: PlacementIssueCode,
  message: string,
  coords: AxialCoord[],
  machineIndex?: number,
): PlacementIssue {
  // De-duplicated: a contested cell is often both the pad and the block centre.
  const seen = new Set<HexKey>();
  const unique: AxialCoord[] = [];
  for (const coord of coords) {
    if (!isValidCoord(coord)) continue;
    const key = hexKey(coord);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ q: coord.q, r: coord.r });
  }
  return {
    code,
    message,
    coords: unique,
    ...(machineIndex === undefined ? {} : { machineIndex }),
  };
}

/** Flatten structured issues for call sites that only need text. */
export function issueMessages(issues: PlacementIssue[]): string[] {
  return issues.map((i) => i.message);
}

/** Every distinct hex mentioned by the given issues (for error highlighting). */
export function issueCoords(issues: PlacementIssue[]): AxialCoord[] {
  const seen = new Set<HexKey>();
  const coords: AxialCoord[] = [];
  for (const i of issues) {
    for (const c of i.coords) {
      const key = hexKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      coords.push({ q: c.q, r: c.r });
    }
  }
  return coords;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isValidCoord(coord: unknown): coord is AxialCoord {
  if (!isRecord(coord)) return false;
  return Number.isInteger(coord.q) && Number.isInteger(coord.r);
}

/**
 * Defensive access to a machine config. Corrupted persisted layouts may carry
 * machines without `config`; the world builder and the validators must report
 * that instead of throwing.
 */
export function getMachineConfig(
  machine: { config?: MachineConfig } | null | undefined,
): MachineConfig | undefined {
  return isRecord(machine?.config) ? (machine!.config as MachineConfig) : undefined;
}

function getPattern(machine: FootprintMachine): TargetPattern | undefined {
  const config = getMachineConfig(machine);
  const pattern = config?.targetPattern;
  return isRecord(pattern) && Array.isArray(pattern.nodes) ? pattern : undefined;
}

/**
 * Every hex a machine occupies besides its centre. A receiver ("sink") with a
 * multi-node target pattern owns one pad per pattern node; every other machine
 * is single-hex. Offsets are relative to the machine centre.
 */
export function getMachineFootprint(machine: FootprintMachine): AxialCoord[] {
  const pattern = getPattern(machine);
  if (machine?.type === 'sink' && pattern && pattern.nodes.length > 0) {
    return pattern.nodes.filter((n) => isRecord(n?.offset)).map((n) => ({
      q: machine.coord.q + n.offset.q,
      r: machine.coord.r + n.offset.r,
    }));
  }
  return [{ ...machine.coord }];
}

/** Centre plus footprint exactly as declared, including malformed cells. */
function getDeclaredCells(machine: FootprintMachine): AxialCoord[] {
  if (!machine || !isValidCoord(machine.coord)) return [];
  return [machine.coord, ...getMachineFootprint(machine)];
}

/**
 * The centre plus the full footprint, de-duplicated and validated. For
 * single-hex machines the footprint *is* the centre, so the hex is counted once
 * instead of looking like a self-overlap.
 */
export function getMachineOccupiedHexes(machine: FootprintMachine): AxialCoord[] {
  const cells: AxialCoord[] = [];
  const seen = new Set<HexKey>();
  for (const coord of getDeclaredCells(machine)) {
    if (!isValidCoord(coord)) continue;
    const key = hexKey(coord);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ q: coord.q, r: coord.r });
  }
  return cells;
}

/** True when every declared cell (centre and pads) has integer coordinates. */
function hasValidCells(machine: FootprintMachine): boolean {
  const declared = getDeclaredCells(machine);
  return declared.length > 0 && declared.every(isValidCoord);
}

function machineLabel(machine: FootprintMachine, index: number): string {
  return `${machine.type} #${index + 1} (${machine.coord.q}, ${machine.coord.r})`;
}

function finalMachineLabel(machine: FinalMachine): string {
  return machine.origin.startsWith('preset')
    ? `${machine.type} #${machine.origin.slice('preset:'.length)} (исходный${machine.locked ? ', фиксированный' : ''})`
    : `${machine.type} #${machine.origin.slice('player:'.length)} (установлен игроком)`;
}

/**
 * Structural check of a receiver target pattern. Geometry-only checks cannot
 * catch a duplicated vertex or an edge pointing outside the graph, and those
 * would silently produce a receiver nobody can ever fill.
 *
 * The linter is stricter than the type on purpose: patterns arrive from
 * persisted saves and level data, so a missing `edges` array, an unknown `mode`
 * or a malformed `growth_ladder` step must be a reported error rather than a
 * runtime TypeError inside the world builder.
 */
export function lintPattern(pattern: TargetPattern): string[] {
  const errors: string[] = [];
  if (!isRecord(pattern)) {
    return ['образец приёмника отсутствует или повреждён'];
  }
  if (!Array.isArray(pattern.nodes) || pattern.nodes.length === 0) {
    return ['образец приёмника не содержит ни одной вершины'];
  }
  // Both arrays are dereferenced when the world is built, so a missing one is a
  // hard error here rather than a TypeError later.
  if (!Array.isArray(pattern.edges)) {
    errors.push('образец приёмника не содержит списка связей (edges)');
  }
  if (!TARGET_MODES.has(pattern.mode)) {
    errors.push(`неизвестный режим проверки приёмника: ${String(pattern.mode)}`);
  }
  if (typeof pattern.rotationInvariant !== 'boolean') {
    errors.push('образец приёмника не задаёт признак rotationInvariant');
  }
  if (typeof pattern.label !== 'string') {
    errors.push('образец приёмника не содержит подписи (label)');
  }

  const declaredOffsets = new Set<HexKey>();
  pattern.nodes.forEach((node, idx) => {
    if (!isRecord(node) || !isValidCoord(node.offset)) {
      errors.push(`вершина ${idx + 1} образца имеет неверные координаты`);
      return;
    }
    const declaredKey = hexKey(node.offset);
    if (declaredOffsets.has(declaredKey)) {
      errors.push(`вершина ${idx + 1} образца повторяет координаты (${declaredKey})`);
    }
    declaredOffsets.add(declaredKey);
    if (node.value !== undefined && !Number.isInteger(node.value)) {
      errors.push(`вершина ${idx + 1} образца имеет нецелое значение ${String(node.value)}`);
    }
  });

  const edges = Array.isArray(pattern.edges) ? pattern.edges : [];
  const pairs = new Set<HexKey>();
  edges.forEach((edge, idx) => {
    const fromIdx = edge?.fromIdx;
    const toIdx = edge?.toIdx;
    if (
      !Number.isInteger(fromIdx) ||
      !Number.isInteger(toIdx) ||
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= pattern.nodes.length ||
      toIdx >= pattern.nodes.length
    ) {
      errors.push(`связь ${idx + 1} образца ссылается на несуществующую вершину`);
      return;
    }
    if (fromIdx === toIdx) {
      errors.push(`связь ${idx + 1} образца соединяет вершину саму с собой`);
      return;
    }
    const pairKey = `${Math.min(fromIdx, toIdx)}-${Math.max(fromIdx, toIdx)}`;
    if (pairs.has(pairKey)) {
      errors.push(`связь ${idx + 1} образца дублирует уже объявленную связь`);
    }
    pairs.add(pairKey);
  });

  if (pattern.expectedValues !== undefined) {
    if (!Array.isArray(pattern.expectedValues) || pattern.expectedValues.some((v) => !Number.isInteger(v))) {
      errors.push('ожидаемые значения приёмника (expectedValues) должны быть целыми числами');
    }
  }
  // Expected node rows are matched per delivery against `pattern.nodes`; a row
  // of the wrong length can never match and would make the receiver unusable.
  if (pattern.expectedNodeValues !== undefined) {
    if (!Array.isArray(pattern.expectedNodeValues)) {
      errors.push('ожидаемые полимеры приёмника (expectedNodeValues) должны быть массивом');
    } else {
      pattern.expectedNodeValues.forEach((row, idx) => {
        if (
          !Array.isArray(row) ||
          row.length !== pattern.nodes.length ||
          row.some((v) => !Number.isInteger(v))
        ) {
          errors.push(
            `ожидаемый полимер ${idx + 1} образца описывает ${Array.isArray(row) ? row.length : 0} звеньев вместо ${pattern.nodes.length}`,
          );
        }
      });
    }
  }

  if (pattern.mode === 'sum_shape' && !Number.isFinite(pattern.requiredSum as number)) {
    errors.push('образец режима «сохрани форму» не задаёт требуемую сумму');
  }
  if (pattern.mode === 'growth_ladder') {
    const step = pattern.ladderStep;
    if (!isRecord(step) || (step.op !== 'add' && step.op !== 'mul') || !Number.isFinite(step.value as number) || (step.op === 'mul' && (step.value as number) === 0)) {
      errors.push('образец режима «лестница» не задаёт корректный шаг роста (op: add|mul, value ≠ 0 для mul)');
    }
  }

  return errors;
}

const TARGET_MODES: ReadonlySet<unknown> = new Set<TargetPattern['mode']>([
  'exact',
  'sum_shape',
  'beam_balance',
  'growth_ladder',
]);

/**
 * The arrangement the world builder will actually create.
 *
 * - Locked fixtures are always kept.
 * - An unlocked preset is dropped when the player put a block on its centre
 *   (replacement) *or* on any cell of its footprint, because part of that
 *   footprint would otherwise be taken over by the player's machine.
 * - Player blocks are dropped when they land on a locked fixture, on a narrow
 *   chasm, off the platform, or on a cell already claimed earlier.
 *
 * Both `validateLevelPlacement` and `createWorldFromLevel` use this, so a
 * validated layout and the built world cannot disagree.
 */
export function resolveFinalPlacement(
  level: LevelDefinition,
  blocks: FootprintMachine[],
  platformHexes?: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey> = new Set(),
  /**
   * `dropConflicts` (default) keeps only what can actually be built, so the
   * result is the world's machine set. `false` keeps every declared machine so
   * the overlap validator can report the conflicts instead of hiding them.
   */
  options: { dropConflicts?: boolean } = {},
): FinalMachine[] {
  const playerMachines = blocks ?? [];
  const dropConflicts = options.dropConflicts !== false;

  const presets = (level.presetMachines ?? []).map<{ index: number; machine: FinalMachine }>(
    (preset, index) => ({
      index,
      machine: {
        origin: `preset:${index}`,
        type: preset.type,
        coord: { ...preset.coord },
        config: preset.config,
        locked: Boolean(preset.locked),
      },
    }),
  );

  // Replacement is one explicit rule: a player block on the *centre* of an
  // unlocked preset replaces it. A block on a receiver pad is a conflict, never
  // a silent removal — that is what the editor enforces interactively too.
  const replacedPresetByPlayer = new Map<number, number>();
  playerMachines.forEach((block, index) => {
    if (!block || !isValidCoord(block.coord)) return;
    const key = hexKey(block.coord);
    const target = presets.find(
      (candidate) =>
        !candidate.machine.locked &&
        isValidCoord(candidate.machine.coord) &&
        hexKey(candidate.machine.coord) === key,
    );
    if (target) replacedPresetByPlayer.set(index, target.index);
  });
  const replacedPresetIndices = new Set(replacedPresetByPlayer.values());

  const final: FinalMachine[] = [];
  const claimed = new Set<HexKey>();

  // Presets first so ids stay predictable (m_1, m_2, …).
  for (const { index, machine } of presets) {
    if (replacedPresetIndices.has(index)) continue;
    final.push(machine);
    if (dropConflicts) {
      for (const cell of getMachineOccupiedHexes(machine)) claimed.add(hexKey(cell));
    }
  }

  for (const [index, block] of playerMachines.entries()) {
    if (!block || !isValidCoord(block.coord)) continue;
    const key = hexKey(block.coord);
    if (dropConflicts && narrowGapHexes.has(key)) continue;
    if (dropConflicts && platformHexes && !platformHexes.has(key)) continue;
    const cells = getMachineOccupiedHexes(block);
    if (cells.length === 0) continue;
    if (getMachineConfig(block) === undefined) continue;

    const replacedPresetIndex = replacedPresetByPlayer.get(index);
    final.push({
      origin: `player:${index}`,
      type: block.type,
      coord: { ...block.coord },
      config: block.config,
      locked: false,
      ...(replacedPresetIndex === undefined ? {} : { replacesPresetIndex: replacedPresetIndex }),
    });
    if (dropConflicts) {
      for (const cell of cells) claimed.add(hexKey(cell));
    }
  }

  return final;
}

/**
 * Full-space overlap check over the definitive arrangement. Every occupied cell
 * of every object is claimed at most once, so a machine dropped on a side pad of
 * a multi-hex receiver is reported instead of silently replacing part of it.
 */
export function checkFootprintOverlapIssues(
  level: LevelDefinition,
  blocks: FootprintMachine[],
): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  const occupied = new Map<HexKey, { label: string; coord: AxialCoord; centre: AxialCoord }>();
  const final = resolveFinalPlacement(level, blocks, undefined, new Set(), { dropConflicts: false });
  const playerMachines = blocks ?? [];

  for (const [index, machine] of final.entries()) {
    const name = finalMachineLabel(machine);
    const machineIndex = machine.origin.startsWith('player:')
      ? Number(machine.origin.slice('player:'.length))
      : undefined;

    if (!isValidCoord(machine.coord)) {
      issues.push(issue('invalid-data', `Механизм #${index + 1}: неверные координаты`, [], machineIndex));
      continue;
    }
    if (!hasValidCells(machine)) {
      issues.push(
        issue(
          'invalid-data',
          `Механизм ${machineLabel(machine, index)}: неверные координаты площадки`,
          [machine.coord],
          machineIndex,
        ),
      );
      continue;
    }

    // Центр учитывается даже для многоклеточного приёмника.
    for (const coord of getMachineOccupiedHexes(machine)) {
      const key = hexKey(coord);
      const previous = occupied.get(key);

      if (previous && previous.label !== name) {
        // Name the contested cell and every centre it involves, so the UI can
        // highlight the actual pad instead of guessing from the sentence.
        const contested: AxialCoord[] = [coord, previous.coord];
        if (previous.centre) contested.push(previous.centre);
        issues.push(
          issue(
            'overlap',
            `Пересечение ${name} и ${previous.label} на ${key}`,
            contested,
            machineIndex,
          ),
        );
      } else {
        occupied.set(key, { label: name, coord: { ...coord }, centre: { ...machine.coord } });
      }
    }
  }

  // A dropped player block would otherwise vanish without an explanation.
  for (const [index, block] of playerMachines.entries()) {
    if (!block) {
      issues.push(issue('invalid-data', 'Некорректные данные механизма или координаты', [], index));
      continue;
    }
    if (!isValidCoord(block.coord)) {
      issues.push(issue('invalid-data', 'Механизм без корректных координат', [], index));
      continue;
    }
    if (getMachineConfig(block) === undefined) {
      issues.push(
        issue(
          'invalid-data',
          `Механизм ${block.type} на (${block.coord.q}, ${block.coord.r}) не содержит конфигурации`,
          [block.coord],
          index,
        ),
      );
    }
  }

  return issues;
}

export function checkFootprintOverlaps(
  level: LevelDefinition,
  blocks: FootprintMachine[],
): string[] {
  return issueMessages(checkFootprintOverlapIssues(level, blocks));
}

/**
 * Geometry check for every occupied cell of the definitive arrangement: the hex
 * must belong to the platform and must not be a narrow chasm. A player machine
 * centre keeps the legacy wording; extra pad cells and fixed fixtures are named
 * explicitly, and the reported coordinates are exactly the offending cells.
 */
export function checkFootprintPlacementIssues(
  machines: Array<PlacedMachine | FinalMachine>,
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  for (const [index, machine] of machines.entries()) {
    // Malformed entries are reported once, by the overlap check.
    if (!machine || !isValidCoord(machine.coord) || !hasValidCells(machine)) continue;

    const isFixed = Boolean(machine.locked);
    const machineIndex = 'origin' in machine && machine.origin.startsWith('player:')
      ? Number(machine.origin.slice('player:'.length))
      : undefined;

    for (const coord of getMachineOccupiedHexes(machine)) {
      const key = hexKey(coord);
      const isCentre = coord.q === machine.coord.q && coord.r === machine.coord.r;
      const legacyCentre = isCentre && !isFixed;
      const subject = legacyCentre
        ? `Механизм ${machine.type} на (${coord.q}, ${coord.r})`
        : `Клетка (${coord.q}, ${coord.r}) — ${machineLabel(machine, index)}`;

      if (!platformHexes.has(key)) {
        issues.push(
          issue(
            'outside-platform',
            legacyCentre ? `${subject} находится вне платформы` : `${subject}: вне платформы`,
            [coord],
            machineIndex,
          ),
        );
      } else if (narrowGapHexes.has(key)) {
        issues.push(
          issue(
            'narrow-chasm',
            legacyCentre
              ? `${subject} установлен над узким разломом`
              : `${subject}: над узким разломом, площадкой быть не может`,
            [coord],
            machineIndex,
          ),
        );
      }
    }
  }

  return issues;
}

export function checkFootprintPlacement(
  machines: Array<PlacedMachine | FinalMachine>,
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): string[] {
  return issueMessages(checkFootprintPlacementIssues(machines, platformHexes, narrowGapHexes));
}

/**
 * Combined footprint validation used by `validateLevelPlacement`: pad geometry
 * of every occupied cell plus overlap detection across the definitive
 * arrangement.
 */
export function validateLevelFootprintIssues(
  level: LevelDefinition,
  blocks: FootprintMachine[],
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): PlacementIssue[] {
  const finalPlacement = resolveFinalPlacement(level, blocks, platformHexes, narrowGapHexes);
  return [
    ...checkFootprintPlacementIssues(finalPlacement, platformHexes, narrowGapHexes),
    ...checkFootprintOverlapIssues(level, blocks),
  ];
}

export function validateLevelFootprints(
  level: LevelDefinition,
  blocks: FootprintMachine[],
  platformHexes: ReadonlySet<HexKey>,
  narrowGapHexes: ReadonlySet<HexKey>,
): string[] {
  return issueMessages(validateLevelFootprintIssues(level, blocks, platformHexes, narrowGapHexes));
}
