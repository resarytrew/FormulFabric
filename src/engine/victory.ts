import { pushEvent } from './events';
import type { SimulationWorld } from './types';

/**
 * Goals are satisfied only when every sink has received its own required
 * number of deliveries — a large total does not compensate for a starved
 * receiver. Sinks absent from `requiredBySink` place no per-sink constraint;
 * without it at all, the plain `deliveredCount >= requiredDeliveries` rule
 * applies (primary stream behaviour).
 */
export function hasCompletedGoals(
  world: SimulationWorld,
): boolean {
  if (world.infiniteMode) return false;

  if (world.deliveredCount < world.requiredDeliveries) {
    return false;
  }

  for (const [sinkId, required] of Object.entries(
    world.requiredBySink ?? {},
  )) {
    const delivered =
      world.sinkDeliveries[sinkId]?.length ?? 0;

    if (delivered < required) {
      return false;
    }
  }

  return true;
}

export function checkVictory(world: SimulationWorld): void {
  if (!world.infiniteMode && world.requiredDeliveries > 0 && hasCompletedGoals(world)) {
    world.status = 'victory';
    pushEvent(world, {
      type: 'deliver',
      coord: { q: 0, r: 0 },
      message: `Цель выполнена за ${world.tick} тактов!`,
      severity: 'success',
    });
  }

}
