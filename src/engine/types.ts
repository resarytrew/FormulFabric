export type HexDir = 0 | 1 | 2 | 3 | 4 | 5;

export interface AxialCoord {
  q: number;
  r: number;
}

export type HexKey = string; // `${q},${r}`

export type MachineType =
  | 'spawner'
  | 'conveyor'
  | 'pusher'
  | 'magnet'
  | 'rotator'
  | 'welder'
  | 'laser'
  | 'add1'
  | 'sub1'
  | 'mul2'
  | 'div2'
  | 'sqrt'
  | 'neg'
  | 'dup'
  | 'adder'
  | 'divmod'
  | 'filter'
  | 'splitter'
  | 'halver'
  | 'swapper'
  | 'jumper'
  | 'scales'
  | 'destroyer'
  | 'sink';

export type FilterRule = 'even' | 'odd' | 'positive' | 'negative' | 'gt5';

export type RotatorMode = 'cw' | 'ccw';

/**
 * Static configuration of a placed machine (distinct from mutable runtime memory).
 */
export interface MachineConfig {
  dir: HexDir; // Primary facing / output direction
  rotMode?: RotatorMode; // For rotator: 'cw' or 'ccw'
  sequence?: number[]; // For spawner: finite or repeating stream
  loopSequence?: boolean; // Whether spawner loops sequence
  spawnInterval?: number; // Ticks between spawns (default 2)
  divisor?: number; // For divmod (b > 0)
  filterRule?: FilterRule; // For filter: routes matching tokens to dir, non-matching to altDir
  altDir?: HexDir; // Secondary output direction for filter, divmod remainder, or dup copy
  sinkId?: string; // Identifier for multi-sink levels (e.g. 'even', 'odd', 'main')
  targetPattern?: TargetPattern; // For sink: expected exact polymer or mathematical invariant
}

/**
 * Mutable runtime state of a machine (strictly separated from MachineConfig).
 */
export interface MachineState {
  spawnIndex: number;
  cooldown: number;
  memory: number | null; // For adder (first operand) or accumulator
  memoryTokenColor?: number;
  activeFlashTicks: number; // Visual feedback ticks
  lastActionTick: number;
  /** True while holding a processed token waiting for a temporarily occupied altDir hex */
  isWaitingSideExit?: boolean;
  waitTicks?: number;
}

export interface MachineInstance {
  id: string;
  type: MachineType;
  coord: AxialCoord;
  locked: boolean; // Fixed level fixture (cannot be deleted/moved by player)
  config: MachineConfig;
  state: MachineState;
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

export interface Token {
  id: string;
  value: number;
  /** Value at the start of the current tick (shown while traveling until machine trigger) */
  prevValue?: number;
  coord: AxialCoord;
  /** Visual interpolation start coordinate from previous tick */
  prevCoord: AxialCoord;
  /** Mechanical source that drove this token on the current tick (for 3D physics curves) */
  moveSource?: TokenMoveSource;
  /** 0-based index along a pusher-driven sphere chain (0, 1, 2) for cascading 3D impulse */
  pushChainIndex?: number;
  /** Machine ID holding this token until its blocked altDir port clears */
  waitingSidePort?: string;
  /** If moved via 60-deg rotation around a pivot */
  rotatedFrom?: {
    pivot: AxialCoord;
    angleDelta: number; // +PI/3 or -PI/3
  };
  /** Set on tick when produced by a 2-input adder so the adder does not re-absorb its own output */
  producedByAdderAtTick?: number;
  /** Track origin spawner / stream id if needed */
  spawnOrder: number;
}

export type ConsumedTokenKind = 'deliver' | 'store' | 'destroy' | 'merge';

export interface ConsumedTokenVisual {
  id: string;
  value: number;
  coord: AxialCoord;
  prevCoord: AxialCoord;
  moveSource?: TokenMoveSource;
  rotatedFrom?: Token['rotatedFrom'];
  kind: ConsumedTokenKind;
}

export interface BondEdge {
  a: string; // Token ID (canonical a < b)
  b: string; // Token ID
}

export type TargetMatchMode = 'exact' | 'sum_shape' | 'beam_balance' | 'growth_ladder';

export interface TargetNodeSpec {
  offset: AxialCoord; // Relative to sink coord (or first node if rotationInvariant)
  value?: number; // Required if exact
}

export interface TargetEdgeSpec {
  fromIdx: number;
  toIdx: number;
}

export interface TargetPattern {
  mode: TargetMatchMode;
  nodes: TargetNodeSpec[];
  edges: TargetEdgeSpec[];
  rotationInvariant: boolean;
  /** For 'sum_shape' mode (e.g. "Сохрани форму": sum === 10) */
  requiredSum?: number;
  /** For 'growth_ladder' mode (step along ordered pattern.nodes) */
  ladderStep?: { op: 'add' | 'mul'; value: number };
  /** For finite stream levels: exact sequence of scalar values expected at this sink */
  expectedValues?: number[];
  /** For multi-node polymer stream levels: per-delivery expected node values matching pattern.nodes */
  expectedNodeValues?: number[][];
  /** Display label for HUD */
  label: string;
}

export type SimEventType =
  | 'spawn'
  | 'transform'
  | 'store'
  | 'move'
  | 'rotate'
  | 'weld'
  | 'cut'
  | 'blocked'
  | 'deliver'
  | 'destroy'
  | 'collision'
  | 'error';

export interface SimEvent {
  id: number;
  tick: number;
  type: SimEventType;
  coord: AxialCoord;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  relatedCoords?: AxialCoord[];
  /** Concise operation label for floating 3D popups (+1, ×2, СВАРКА, etc.) */
  badge?: string;
}

export type SimStatus = 'idle' | 'running' | 'paused' | 'victory' | 'error';

export interface SimulationWorld {
  tick: number;
  status: SimStatus;
  platformHexes: Set<HexKey>;
  /** Narrow fissure tiles: single spheres fall through, >=2-node polymers bridge if >=1 node rests on solid ground */
  narrowGapHexes: Set<HexKey>;
  /** Every hex covered by any sink's targetPattern.nodes footprint mapped to sink machine ID */
  sinkFootprintHexes: Map<HexKey, string>;
  machines: Map<HexKey, MachineInstance>;
  tokens: Map<string, Token>;
  bonds: BondEdge[];
  events: SimEvent[];
  nextEventId: number;
  deliveredCount: number;
  requiredDeliveries: number;
  infiniteMode?: boolean;
  /** Per-sink delivery history for multi-sink and sequence verification */
  sinkDeliveries: Record<string, number[][]>;
  /** All hexes occupied by player blocks or traversed by tokens (for Area metric) */
  visitedHexes: Set<HexKey>;
  errorHighlightHexes: AxialCoord[];
  errorReason: string | null;
  fallingTokens?: Array<{ value: number; fromCoord: AxialCoord; toCoord: AxialCoord }>;
  /** Tokens consumed on this tick (delivered, stored, shredded, merged) so 3D view animates arrival -> pause -> absorb */
  consumedTokens?: ConsumedTokenVisual[];
  /** Bonds connecting consumed multi-node polymers so rods remain intact until trigger absorption */
  consumedBonds?: BondEdge[];
  nextTokenId: number;
  nextSpawnOrder: number;
  minValue: number;
  maxValue: number;
}

export interface LevelGoalCheck {
  passed: boolean;
  reason?: string;
}

export interface VerificationRunResult {
  name: string;
  passed: boolean;
  ticks: number;
  reason?: string;
}

export interface VerificationReport {
  passed: number;
  total: number;
  results: VerificationRunResult[];
}

export interface OnboardingStep {
  id: string;
  title: string;
  body: string;
  highlightTool?: MachineType;
  highlightCoord?: AxialCoord;
  actionHint: string;
}

export type DifficultyTier = 'Начальный' | 'Средний' | 'Продвинутый';
export type PuzzleChapter = 'campaign' | 'eureka' | 'impossible' | 'grade5';

export interface MathRevealStep {
  label: string;
  expression: string;
  caption: string;
}

export interface MathRevealSpec {
  headline: string;
  summary: string;
  steps: MathRevealStep[];
}

export interface OptimizationTargets {
  blocksGold: number;
  ticksGold: number;
  areaGold: number;
  /** Benchmark distribution reference buckets for histogram display */
  blocksCurve: number[];
  ticksCurve: number[];
  areaCurve: number[];
}

export interface LevelDefinition {
  id: string;
  index: number;
  chapter?: PuzzleChapter;
  title: string;
  subtitle: string;
  tier: DifficultyTier;
  radius: number;
  /** Optional custom hex subset instead of full disk (supports chasms/islands) */
  customHexes?: AxialCoord[];
  /** Narrow chasm fissures that can only be bridged by bonded polymers (>=2 nodes with >=1 on solid ground) */
  narrowGaps?: AxialCoord[];
  availableTools: MachineType[];
  /** Hard puzzle constraints: max total player blocks & per-tool quotas */
  maxTotalBlocks?: number;
  partLimits?: Partial<Record<MachineType, number>>;
  /** Optional fixed divisor b for all divmod blocks in this level (e.g. b = 2) */
  fixedDivisor?: number;
  maxBlocksBonus?: number;
  maxTicksBonus?: number;
  maxAreaBonus?: number;
  targets?: OptimizationTargets;
  requiredDeliveries: number;
  infiniteMode?: boolean;
  presetMachines: Array<{
    type: MachineType;
    coord: AxialCoord;
    locked: boolean;
    config: MachineConfig;
  }>;
  /** Optional pre-built reference solution (immediately available in demo mode) */
  demoSolution?: Array<{
    type: MachineType;
    coord: AxialCoord;
    config: MachineConfig;
  }>;
  /** Short label describing the primary reference solution (Эталон 1) */
  demoLabel?: string;
  /** Optional alternative optimal reference solutions (Эталон 2, Эталон 3, ...) */
  altDemoSolutions?: Array<{
    label: string;
    description?: string;
    blocks: Array<{
      type: MachineType;
      coord: AxialCoord;
      config: MachineConfig;
    }>;
  }>;
  /** Multi-schedule / hidden algorithm test cases */
  verificationRuns?: Array<{
    name: string;
    hidden?: boolean;
    spawnerOverrides: Record<HexKey, { sequence: number[]; spawnInterval?: number }>;
    expectedSinkValues?: Record<string, number[]>;
    expectedSinkPolymers?: Record<string, number[][]>;
  }>;
  /** 4-line kid-friendly structured briefing (Goal, Before->After, Catch, Mechanic Secret) */
  briefing?: {
    intro?: string;
    example: string;
    catch: string;
    secret: string;
  };
  /** 3-tier progressive hints (Idea -> Topology -> Key detail) */
  hints?: [string, string, string];
  onboarding?: OnboardingStep[];
  pedagogyNote: string;
  bonusGoalText: string;
  /** Post-victory animated mathematical explanation */
  mathReveal?: MathRevealSpec;
  explainQuestion?: {
    prompt: string;
    options: string[];
    correctIdx: number;
    explanation: string;
  };
}
