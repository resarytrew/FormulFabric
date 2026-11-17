import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSUMED_END_ALPHA,
  evaluateConsumedTokenTimeline,
  evaluateMachineActionCurves,
  evaluateTokenTickTimeline,
  TOKEN_ARRIVAL_ALPHA,
  TOKEN_TRIGGER_ALPHA,
} from './tokenAnimationTimeline';

test('token never transforms before reaching machine or during dwell pause', () => {
  // Mid-travel
  const mid = evaluateTokenTickTimeline({
    alpha: 0.21,
    isMoving: true,
    moveSource: 'conveyor',
    hasAccent: true,
  });
  assert.equal(mid.showTransformed, false);
  assert.ok(mid.moveT > 0 && mid.moveT < 1);
  assert.equal(mid.isDwelling, false);
  assert.equal(mid.transformAccentT, 0);

  // Just arrived at machine (start of dwell pause)
  const arrived = evaluateTokenTickTimeline({
    alpha: TOKEN_ARRIVAL_ALPHA,
    isMoving: true,
    moveSource: 'conveyor',
    hasAccent: true,
  });
  assert.equal(arrived.moveT, 1);
  assert.equal(arrived.isDwelling, true);
  assert.equal(arrived.showTransformed, false);
  assert.equal(arrived.transformAccentT, 0);

  // Still stopped on machine right before trigger
  const preTrigger = evaluateTokenTickTimeline({
    alpha: TOKEN_TRIGGER_ALPHA - 0.01,
    isMoving: true,
    moveSource: 'conveyor',
    hasAccent: true,
  });
  assert.equal(preTrigger.moveT, 1);
  assert.equal(preTrigger.isDwelling, true);
  assert.equal(preTrigger.showTransformed, false);
  assert.ok(preTrigger.dwellAnticipation > 0.8);
});

test('token transforms right at trigger alpha with active highlight accent', () => {
  const atTrigger = evaluateTokenTickTimeline({
    alpha: TOKEN_TRIGGER_ALPHA,
    isMoving: true,
    moveSource: 'conveyor',
    hasAccent: true,
  });
  assert.equal(atTrigger.moveT, 1);
  assert.equal(atTrigger.isDwelling, false);
  assert.equal(atTrigger.showTransformed, true);
  assert.equal(atTrigger.transformAccentT, 0);

  const postTrigger = evaluateTokenTickTimeline({
    alpha: 0.78,
    isMoving: true,
    moveSource: 'conveyor',
    hasAccent: true,
  });
  assert.equal(postTrigger.showTransformed, true);
  assert.ok(postTrigger.transformAccentT > 0.45 && postTrigger.transformAccentT < 0.55);

  const settled = evaluateTokenTickTimeline({
    alpha: 1,
    isMoving: true,
    moveSource: 'conveyor',
    hasAccent: true,
  });
  assert.equal(settled.moveT, 1);
  assert.equal(settled.showTransformed, true);
  assert.equal(settled.transformAccentT, 1);
});

test('split output tokens stay hidden inside mechanism until trigger alpha', () => {
  const before = evaluateTokenTickTimeline({
    alpha: 0.48,
    isMoving: true,
    moveSource: 'split',
    hasAccent: true,
  });
  assert.equal(before.hiddenBeforeTrigger, true);
  assert.equal(before.moveT, 0);
  assert.equal(before.showTransformed, false);

  const after = evaluateTokenTickTimeline({
    alpha: 0.76,
    isMoving: true,
    moveSource: 'split',
    hasAccent: true,
  });
  assert.equal(after.hiddenBeforeTrigger, false);
  assert.equal(after.showTransformed, true);
  assert.ok(after.moveT > 0.5 && after.moveT < 1);
});

test('machine actuator stroke stays poised during travel and peaks at trigger alpha', () => {
  const idleTravel = evaluateMachineActionCurves(0.25, true);
  assert.equal(idleTravel.stroke, 0);
  assert.equal(idleTravel.flashArc, 0);

  const impact = evaluateMachineActionCurves(TOKEN_TRIGGER_ALPHA, true);
  assert.ok(Math.abs(impact.stroke - 1) < 1e-6);
  assert.ok(Math.abs(impact.flashArc - 1) < 1e-6);

  const end = evaluateMachineActionCurves(1, true);
  assert.ok(Math.abs(end.stroke) < 1e-6);
  assert.ok(Math.abs(end.flashArc) < 1e-6);
});

test('machine actuator return is continuous at the tail and its endpoint', () => {
  const tailStart = TOKEN_TRIGGER_ALPHA + (1 - TOKEN_TRIGGER_ALPHA) * 0.9;
  const epsilon = 1e-7;
  for (const point of [tailStart, 1]) {
    const before = evaluateMachineActionCurves(point - epsilon, true).stroke;
    const at = evaluateMachineActionCurves(point, true).stroke;
    const after = evaluateMachineActionCurves(point + epsilon, true).stroke;
    assert.ok(Math.abs(before - at) < 1e-5);
    assert.ok(Math.abs(after - at) < 1e-5);
  }
  assert.ok(Math.abs(evaluateMachineActionCurves(1 - epsilon, true).stroke) < 1e-5);
});

test('consumed tokens travel, pause on target machine, then absorb cleanly', () => {
  const dwell = evaluateConsumedTokenTimeline(0.49);
  assert.equal(dwell.visible, true);
  assert.equal(dwell.moveT, 1);
  assert.equal(dwell.isDwelling, true);
  assert.equal(dwell.absorbT, 0);

  const absorbing = evaluateConsumedTokenTimeline(0.74);
  assert.equal(absorbing.visible, true);
  assert.ok(absorbing.absorbT > 0.4 && absorbing.absorbT < 0.6);

  const done = evaluateConsumedTokenTimeline(CONSUMED_END_ALPHA);
  assert.equal(done.visible, false);
});
