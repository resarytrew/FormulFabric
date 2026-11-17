import { pushEvent } from './events';
import type { SimulationWorld } from './types';

export function checkVictory(world: SimulationWorld): void {
  if (!world.infiniteMode && world.requiredDeliveries > 0 && world.deliveredCount >= world.requiredDeliveries) {
    world.status = 'victory';
    pushEvent(world, {
      type: 'deliver',
      coord: { q: 0, r: 0 },
      message: `Цель выполнена за ${world.tick} тактов!`,
      severity: 'success',
    });
  }

}
