/**
 * Test-only helpers for the physics/discrete-logic audit (PR #4A).
 *
 * Nothing here is imported by the engine or the renderer: the module exists so
 * that movement-invariants / movement-determinism / movement-collisions /
 * rotation-geometry tests share one definition of "the physical state of the
 * world" and one definition of the rules the audit is checking.
 *
 * Two kinds of assertions live here:
 *
 *  - `assertMatchesRule(expected, actual)` — the invariant holds today and must
 *    keep holding.
 *  - `documentDivergence({...})` — the engine currently breaks the rule. The
 *    helper records the divergence in a registry and asserts that expected and
 *    actual really differ, so the test is green only while the defect exists.
 *    When a follow-up PR fixes the defect the test fails on purpose and must be
 *    flipped to `assertMatchesRule`. `AUDIT_STRICT=1` flips all of them at once.
 */
import assert from 'node:assert/strict';
import { hexDistance, hexKey } from './hex-math';
import { getConnectedComponents } from './components';
import type {
  AxialCoord,
  LevelDefinition,
  MachineConfig,
  MachineInstance,
  MachineType,
  SimulationWorld,
  Token,
} from './types';

export type Severity = 'P0' | 'P1' | 'P2';

export interface DocumentedViolation {
  id: string;
  severity: Severity;
  title: string;
  expected: string;
  actual: string;
  note: string;
}

const REGISTRY = new Map<string, DocumentedViolation>();

/** `AUDIT_STRICT=1 npm test` demands the fixes instead of documenting them. */
export const AUDIT_STRICT = process.env.AUDIT_STRICT === '1';

/** Invariant holds: assert equality of the rule-level expectation. */
export function assertMatchesRule<T>(expected: T, actual: T, message?: string): void {
  assert.deepEqual(actual, expected, message);
}

/**
 * Invariant is broken today. Records the divergence and asserts that the engine
 * really still produces the wrong value, so a silent behaviour change (or a
 * fix) is never mistaken for a green audit.
 */
export function documentDivergence(v: DocumentedViolation, expected: unknown, actual: unknown): void {
  const previous = REGISTRY.get(v.id);
  if (previous) {
    assert.equal(previous.severity, v.severity, `Severity changed for ${v.id}`);
  } else {
    REGISTRY.set(v.id, {
      ...v,
      expected: `${v.expected} :: ${describe(expected)}`,
      actual: `${v.actual} :: ${describe(actual)}`,
    });
  }
  if (AUDIT_STRICT) {
    assert.deepEqual(actual, expected, `[${v.severity}] ${v.title} — правило должно выполняться`);
  } else {
    assert.notDeepEqual(
      actual,
      expected,
      `${v.id}: ожидаемое и фактическое поведение совпали — перенесите тест в разряд выполняющихся инвариантов`,
    );
  }
}

export function documentedViolations(): DocumentedViolation[] {
  return [...REGISTRY.values()].sort((a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id));
}

export function formatViolationTable(): string {
  const rows = documentedViolations();
  if (rows.length === 0) return '(нет зафиксированных нарушений)';
  return rows
    .map((v) => `[${v.severity}] ${v.id} — ${v.title}\n    ожидалось: ${v.expected}\n    факт:      ${v.actual}`)
    .join('\n');
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Terminal states, expressed as functions to survive TS narrowing. */
export function isTerminal(world: SimulationWorld): boolean {
  return world.status === 'victory' || world.status === 'error';
}

export function isErrorWorld(world: SimulationWorld): boolean {
  return world.status === 'error';
}

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------

export interface PresetSpec {
  type: MachineType;
  coord: AxialCoord;
  config?: Partial<MachineConfig>;
  locked?: boolean;
}

export function preset(type: MachineType, q: number, r: number, config: Partial<MachineConfig> = {}, locked = true): PresetSpec {
  return { type, coord: { q, r }, config, locked };
}

export function auditLevel(overrides: Partial<LevelDefinition> & { id: string }): LevelDefinition {
  return {
    index: 999,
    title: overrides.id,
    subtitle: '',
    tier: 'Средний',
    radius: 4,
    availableTools: [],
    requiredDeliveries: 1,
    presetMachines: [],
    pedagogyNote: '',
    bonusGoalText: '',
    ...overrides,
    id: overrides.id,
  };
}

/** Level whose preset machines are the given specs, in the given storage order. */
export function levelWithPresets(id: string, presets: PresetSpec[], overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return auditLevel({
    id,
    presetMachines: presets.map((p) => ({
      type: p.type,
      coord: { ...p.coord },
      locked: p.locked ?? true,
      config: { dir: 0, ...p.config },
    })),
    ...overrides,
  });
}

export function makeToken(id: string, value: number, coord: AxialCoord, spawnOrder = 1): Token {
  return {
    id,
    value,
    prevValue: value,
    coord: { ...coord },
    prevCoord: { ...coord },
    spawnOrder,
  };
}

export function addToken(world: SimulationWorld, id: string, value: number, q: number, r: number, spawnOrder = 1): Token {
  const tok = makeToken(id, value, { q, r }, spawnOrder);
  world.tokens.set(id, tok);
  return tok;
}

export function bondTokens(world: SimulationWorld, a: string, b: string): void {
  world.bonds.push({ a, b });
}

// ---------------------------------------------------------------------------
// Invariant B / A assertions
// ---------------------------------------------------------------------------

/** Invariant A: every bond joins neighbouring hexes and both endpoints exist. */
export function assertBondGeometry(world: SimulationWorld, label = ''): void {
  for (const edge of world.bonds) {
    const a = world.tokens.get(edge.a);
    const b = world.tokens.get(edge.b);
    assert.ok(a, `${label}: отсутствует сфера ${edge.a} из связи ${edge.a}-${edge.b}`);
    assert.ok(b, `${label}: отсутствует сфера ${edge.b} из связи ${edge.a}-${edge.b}`);
    const d = hexDistance(a!.coord, b!.coord);
    assert.equal(d, 1, `${label}: связь ${edge.a}@${hexKey(a!.coord)}—${edge.b}@${hexKey(b!.coord)} растянулась до d=${d}`);
  }
}

/**
 * Stronger invariant A: if a bonded component has exactly the same member IDs
 * and bonds before and after a tick, EVERY pairwise distance must be preserved.
 * Checking only bond lengths misses a bent chain whose two adjacent bonds
 * both remain at distance 1.
 *
 * Components altered by welding, cutting, splitting or delivery are excluded:
 * their connectivity changed, so this invariant does not assert rigid motion
 * across those game-mechanic transformations.
 */
export function assertRigidComponentGeometry(
  before: SimulationWorld,
  after: SimulationWorld,
  label = '',
): void {
  const afterByToken = new Map<string, string>();
  for (const comp of getConnectedComponents(after)) {
    const signature = [...comp.tokenIds].sort().join(',');
    for (const id of comp.tokenIds) afterByToken.set(id, signature);
  }

  const bondSignature = (world: SimulationWorld, members: Set<string>) =>
    world.bonds
      .filter((bond) => members.has(bond.a) && members.has(bond.b))
      .map((bond) => [bond.a, bond.b].sort().join(':'))
      .sort()
      .join(',');

  for (const comp of getConnectedComponents(before)) {
    if (comp.tokenIds.length < 2) continue;
    const ids = [...comp.tokenIds].sort();
    const members = new Set(ids);
    const signature = ids.join(',');
    // Only compare intact components that have not gained/lost any members.
    if (ids.some((id) => afterByToken.get(id) !== signature)) continue;
    if (bondSignature(before, members) !== bondSignature(after, members)) continue;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const aBefore = before.tokens.get(ids[i])!;
        const bBefore = before.tokens.get(ids[j])!;
        const aAfter = after.tokens.get(ids[i])!;
        const bAfter = after.tokens.get(ids[j])!;
        assert.equal(
          hexDistance(aAfter.coord, bAfter.coord),
          hexDistance(aBefore.coord, bBefore.coord),
          `${label}: полимер изменил форму между сферами ${ids[i]} и ${ids[j]}`,
        );
      }
    }
  }
}

/** Invariant B: after a finished tick no two spheres share a hex. */
export function assertNoIllegalOverlaps(world: SimulationWorld, label = ''): void {
  const byHex = new Map<string, string>();
  for (const tok of world.tokens.values()) {
    const key = hexKey(tok.coord);
    const other = byHex.get(key);
    assert.equal(other, undefined, `${label}: две сферы на гексе ${key}: ${other} и ${tok.id}`);
    byHex.set(key, tok.id);
  }
}

export function assertTokensOnPlatform(world: SimulationWorld, label = ''): void {
  for (const tok of world.tokens.values()) {
    const key = hexKey(tok.coord);
    assert.ok(world.platformHexes.has(key), `${label}: сфера ${tok.id} вне платформы на ${key}`);
  }
}

/** Everything the audit expects to hold after every completed tick. */
export function assertMovementInvariants(world: SimulationWorld, label = ''): void {
  assertBondGeometry(world, label);
  assertNoIllegalOverlaps(world, label);
  assertTokensOnPlatform(world, label);
}

// ---------------------------------------------------------------------------
// Invariant D: storage-order independent snapshot
// ---------------------------------------------------------------------------

/**
 * Canonical, id-agnostic projection of the mathematical state.
 *
 * Sorted by coordinate/value, so Map iteration order can never leak in, while
 * coordinates. Values, bonds, mechanism state, deliveries and the level result
 * are all represented. Token ids are deliberately excluded: they are an
 * artefact of allocation order, not part of the physics (see the id-order
 * divergence documented in movement-determinism.test.ts). Waiting-side-port
 * and adder-tick flags ARE included because they may affect the next tick.
 */
export function snapshotPhysicalState(world: SimulationWorld): string {
  const tokens = [...world.tokens.values()]
    .map((t) => [
      `${t.value}@${hexKey(t.coord)}`,
      `waiting=${t.waitingSidePort ?? '-'}`,
      `adderTick=${t.producedByAdderAtTick ?? '-'}`,
    ].join('|'))
    .sort();

  const bonds = world.bonds
    .map((edge) => {
      const a = world.tokens.get(edge.a);
      const b = world.tokens.get(edge.b);
      if (!a || !b) return 'dangling-bond';
      const ends = [`${a.value}@${hexKey(a.coord)}`, `${b.value}@${hexKey(b.coord)}`].sort();
      return ends.join('--');
    })
    .sort();

  const machines = [...world.machines.values()]
    .map((m) => `${machineSignature(m)}`)
    .sort();

  const sinkDeliveries = Object.fromEntries(
    Object.entries(world.sinkDeliveries ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, deliveries]) => [id, deliveries]),
  );

  return JSON.stringify({
    tick: world.tick,
    status: world.status,
    errorReason: world.errorReason ?? null,
    tokens,
    bonds,
    machines,
    deliveredCount: world.deliveredCount,
    sinkDeliveries,
  });
}

function machineSignature(machine: MachineInstance): string {
  const s = machine.state;
  return [
    machine.type,
    hexKey(machine.coord),
    `spawnIndex=${s.spawnIndex}`,
    `cooldown=${s.cooldown}`,
    `memory=${s.memory}`,
    `flash=${s.activeFlashTicks}`,
    `lastAction=${s.lastActionTick}`,
    `waiting=${s.isWaitingSideExit ? 1 : 0}`,
    `waitTicks=${s.waitTicks ?? 0}`,
  ].join('|');
}

/** Token ids in coordinate order — order-sensitive, for the id-allocation check. */
export function snapshotTokenIdsByCoord(world: SimulationWorld): string {
  return [...world.tokens.values()]
    .map((t) => `${hexKey(t.coord)}=${t.id}`)
    .sort()
    .join(';');
}

/** Reverses Map insertion order only: identities, coordinates and configs stay put. */
export function reverseStorageOrder(world: SimulationWorld): SimulationWorld {
  world.machines = new Map([...world.machines].reverse());
  world.tokens = new Map([...world.tokens].reverse());
  return world;
}

// ---------------------------------------------------------------------------
// Deterministic RNG for reproducible fuzz cases
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coordinate list helper for compact test data. */
export function coord(q: number, r: number): AxialCoord {
  return { q, r };
}

export function tokensAt(world: SimulationWorld): string {
  return [...world.tokens.values()]
    .map((t) => `${t.value}@${hexKey(t.coord)}`)
    .sort()
    .join(' ');
}
