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
  /** 0-based domino index along a pusher-driven sphere train (0, 1, 2) */
  pushChainIndex?: number;
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

export interface TransportKinematics {
  tCurve: number;
  hop: number;
  stretchXZ: number;
  stretchY: number;
  tiltMag: number;
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
 * Evaluates source-specific physical travel curve, vertical arc/hop, squash-and-stretch,
 * and forward momentum tilt over normalized travel progress mT in [0, 1].
 */
export function evaluateTransportCurve(
  mT: number,
  src: TokenMoveSource = 'conveyor',
): TransportKinematics {
  const u = clamp01(mT);
  if (src === 'pusher') {
    const p = Math.min(1, u / 0.56);
    const ballistic = 1 - Math.pow(1 - p, 2.85);
    const recoil =
      u > 0.56
        ? Math.sin((u - 0.56) * Math.PI * 2.4) * Math.exp(-(u - 0.56) * 5.6) * 0.032
        : 0;
    const sq =
      u < 0.54
        ? Math.sin((u / 0.54) * Math.PI) * 0.13
        : -Math.sin(Math.min(1, (u - 0.54) / 0.46) * Math.PI) * 0.065;
    return {
      tCurve: ballistic + recoil,
      hop: Math.sin(Math.min(1, u / 0.72) * Math.PI) * 0.09,
      stretchXZ: 1 + sq * 0.65,
      stretchY: 1 - sq,
      tiltMag: 0.14,
    };
  }
  if (src === 'jump') {
    const tCurve = 1 - Math.pow(1 - u, 1.95);
    // Launch stretch on ascent, soft squash-and-recover on touchdown
    const launchStretch = u < 0.28 ? Math.sin((u / 0.28) * Math.PI) * 0.14 : 0;
    const landSquash = u > 0.82 ? Math.sin(((u - 0.82) / 0.18) * Math.PI) * 0.16 : 0;
    return {
      tCurve,
      hop: Math.sin(u * Math.PI) * 0.82,
      stretchXZ: 1 - launchStretch * 0.55 + landSquash * 0.72,
      stretchY: 1 + launchStretch - landSquash,
      tiltMag: 0.11,
    };
  }
  if (src === 'magnet') {
    const tCurve =
      u < 0.44
        ? 0.2 * Math.pow(u / 0.44, 2.15)
        : 0.2 + 0.8 * (1 - Math.pow(1 - (u - 0.44) / 0.56, 2.55));
    const snapSquash = u > 0.84 ? Math.sin(((u - 0.84) / 0.16) * Math.PI) * 0.08 : 0;
    return {
      tCurve,
      hop: Math.sin(u * Math.PI) * 0.21,
      stretchXZ: 1 + snapSquash * 0.5,
      stretchY: 1 - snapSquash * 0.6,
      tiltMag: 0.1,
    };
  }
  if (src === 'spawner') {
    return {
      tCurve: 1 - Math.pow(1 - u, 2.2),
      hop: Math.abs(Math.sin(u * Math.PI * 1.4)) * (1 - u) * 0.16,
      stretchXZ: 1,
      stretchY: 1,
      tiltMag: 0.07,
    };
  }
  if (src === 'split') {
    return {
      tCurve: u,
      hop: Math.sin(u * Math.PI) * 0.22,
      stretchXZ: 1,
      stretchY: 1,
      tiltMag: 0.08,
    };
  }
  // Conveyor steady belt traction with smooth engagement & docking ease
  const tCurve = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  return {
    tCurve,
    hop: Math.sin(u * Math.PI) * 0.022,
    stretchXZ: 1,
    stretchY: 1,
    tiltMag: 0.065,
  };
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
    if (a >= TOKEN_ARRIVAL_ALPHA) {
      moveT = 1;
    } else {
      const chainIdx = Math.max(0, Math.min(2, input.pushChainIndex ?? 0));
      const delay = input.moveSource === 'pusher' ? chainIdx * 0.055 : 0;
      const span = Math.max(0.08, TOKEN_ARRIVAL_ALPHA - delay);
      moveT = clamp01((a - delay) / span);
    }
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
 * and smoothly cushion back by 1.0 with slight damped settling.
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
  const baseReturn = Math.cos(returnT * (Math.PI / 2));
  const settle = Math.sin(returnT * Math.PI * 2.2) * Math.exp(-returnT * 4.5) * 0.06;
  // Remove the tiny residual of the damped sine smoothly over the final 10%.
  const tailT = Math.max(0, (returnT - 0.9) / 0.1);
  const tailBlend = tailT * tailT * (3 - 2 * tailT);
  const residual = Math.sin(Math.PI * 2.2) * Math.exp(-4.5) * 0.06;
  const stroke = Math.max(-0.08, baseReturn + settle - residual * tailBlend);
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
