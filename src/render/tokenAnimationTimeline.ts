import type { TokenMoveSource } from '../engine/types';

/**
 * Normalized tick choreography phases over alpha in [0, 1]:
 *   1. [0.00 .. ARRIVAL_ALPHA]   : Token physically glides from prevCoord -> coord showing prevValue.
 *   2. [ARRIVAL_ALPHA .. TRIGGER_ALPHA] : Dwell / lock-on pause right on the mechanism (prevValue still shown).
 *   3. [TRIGGER_ALPHA .. 1.00]   : Mechanism triggers! Value flips prevValue -> value with hop/scale/glow accent;
 *                                  any secondary 'split' output token emerges from the machine across [0.56..0.96].
 */
export const TOKEN_ARRIVAL_ALPHA = 0.42;
export const TOKEN_TRIGGER_ALPHA = 0.56;
export const SPLIT_EXIT_END_ALPHA = 0.96;
export const CONSUMED_END_ALPHA = 0.92;

export interface TokenTimelineInput {
  alpha: number;
  isMoving: boolean;
  moveSource?: TokenMoveSource;
  /** True when value changed OR machine transformed/welded/cut/rotated this token on this tick */
  hasAccent: boolean;
}

export interface TokenTimelineState {
  /** Normalized [0..1] spatial travel progress along prevCoord -> coord */
  moveT: number;
  /** True once the mechanism has triggered (>= TOKEN_TRIGGER_ALPHA) and value should display tok.value */
  showTransformed: boolean;
  /** True when a secondary 'split' token should stay hidden inside the splitter before trigger */
  hiddenBeforeTrigger: boolean;
  /** True during the deliberate pause window [TOKEN_ARRIVAL_ALPHA .. TOKEN_TRIGGER_ALPHA) */
  isDwelling: boolean;
  /** [0..1] anticipation squash factor ramping up across dwell window right before trigger */
  dwellAnticipation: number;
  /** [0..1] progress through post-trigger visual accent window (0 before trigger or if !hasAccent) */
  transformAccentT: number;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Evaluates where a token should be positioned, whether it should still display its
 * pre-transform value, and how strongly the transformation accent should animate.
 */
export function evaluateTokenTickTimeline(input: TokenTimelineInput): TokenTimelineState {
  const a = clamp01(input.alpha);
  const showTransformed = a >= TOKEN_TRIGGER_ALPHA;

  if (input.moveSource === 'split') {
    if (!showTransformed) {
      return {
        moveT: 0,
        showTransformed: false,
        hiddenBeforeTrigger: true,
        isDwelling: false,
        dwellAnticipation: 0,
        transformAccentT: 0,
      };
    }
    const splitSpan = SPLIT_EXIT_END_ALPHA - TOKEN_TRIGGER_ALPHA;
    const rawSplitT = clamp01((a - TOKEN_TRIGGER_ALPHA) / splitSpan);
    const accentT = clamp01((a - TOKEN_TRIGGER_ALPHA) / (1 - TOKEN_TRIGGER_ALPHA));
    return {
      moveT: 1 - Math.pow(1 - rawSplitT, 2.3),
      showTransformed: true,
      hiddenBeforeTrigger: false,
      isDwelling: false,
      dwellAnticipation: 0,
      transformAccentT: input.hasAccent ? accentT : 0,
    };
  }

  let moveT = 1;
  if (input.isMoving) {
    moveT = a >= TOKEN_ARRIVAL_ALPHA ? 1 : clamp01(a / TOKEN_ARRIVAL_ALPHA);
  }

  const isDwelling = a >= TOKEN_ARRIVAL_ALPHA && a < TOKEN_TRIGGER_ALPHA;
  let dwellAnticipation = 0;
  if (isDwelling && input.hasAccent) {
    const dwellT = (a - TOKEN_ARRIVAL_ALPHA) / (TOKEN_TRIGGER_ALPHA - TOKEN_ARRIVAL_ALPHA);
    dwellAnticipation = smoothstep01(dwellT);
  }

  const transformAccentT =
    showTransformed && input.hasAccent
      ? clamp01((a - TOKEN_TRIGGER_ALPHA) / (1 - TOKEN_TRIGGER_ALPHA))
      : 0;

  return {
    moveT,
    showTransformed,
    hiddenBeforeTrigger: false,
    isDwelling,
    dwellAnticipation,
    transformAccentT,
  };
}

/**
 * Evaluates mechanical actuator power stroke [0..1] synchronized to TOKEN_TRIGGER_ALPHA:
 * machines stay poised while tokens travel [0..0.38], wind up sharply into impact at 0.56,
 * and smoothly cushion back by 1.0.
 */
export function evaluateMachineActionCurves(
  alpha: number,
  isFlashing: boolean,
): { stroke: number; flashArc: number } {
  if (!isFlashing) {
    return { stroke: 0, flashArc: 0 };
  }
  const a = clamp01(alpha);
  const windupStart = 0.36;
  if (a < windupStart) {
    return { stroke: 0, flashArc: 0 };
  }
  if (a <= TOKEN_TRIGGER_ALPHA) {
    const t = (a - windupStart) / (TOKEN_TRIGGER_ALPHA - windupStart);
    const eased = Math.sin(t * (Math.PI / 2));
    return { stroke: eased, flashArc: eased };
  }
  const returnT = (a - TOKEN_TRIGGER_ALPHA) / (1 - TOKEN_TRIGGER_ALPHA);
  const stroke = Math.cos(returnT * (Math.PI / 2));
  const flashArc = Math.pow(Math.max(0, 1 - returnT), 0.75);
  return { stroke, flashArc };
}

/**
 * Evaluates consumed tokens (delivered into sink, stored into adder/scales memory,
 * or shredded by destroyer): travel [0..0.42], pause [0.42..0.56], pop & absorb [0.56..0.92].
 */
export function evaluateConsumedTokenTimeline(alpha: number): {
  moveT: number;
  visible: boolean;
  absorbT: number;
  isDwelling: boolean;
} {
  const a = clamp01(alpha);
  if (a >= CONSUMED_END_ALPHA) {
    return { moveT: 1, visible: false, absorbT: 1, isDwelling: false };
  }
  const moveT = a >= TOKEN_ARRIVAL_ALPHA ? 1 : clamp01(a / TOKEN_ARRIVAL_ALPHA);
  const isDwelling = a >= TOKEN_ARRIVAL_ALPHA && a < TOKEN_TRIGGER_ALPHA;
  const absorbT =
    a >= TOKEN_TRIGGER_ALPHA
      ? clamp01((a - TOKEN_TRIGGER_ALPHA) / (CONSUMED_END_ALPHA - TOKEN_TRIGGER_ALPHA))
      : 0;
  return {
    moveT,
    visible: true,
    absorbT,
    isDwelling,
  };
}
