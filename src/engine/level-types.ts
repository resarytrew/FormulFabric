import type { AxialCoord, HexKey } from './coordinates';
import type { MachineConfig, MachineType } from './game-types';

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
