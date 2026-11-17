import type { AxialCoord, SimEvent, SimulationWorld } from './types';

export function pushEvent(world: SimulationWorld, ev: Omit<SimEvent, 'tick' | 'id'>) {
  world.events.push({ id: world.nextEventId++, tick: world.tick, ...ev });
  if (world.events.length > 160) {
    world.events.shift();
  }
}

export function triggerError(
  world: SimulationWorld,
  reason: string,
  highlightHexes: AxialCoord[],
  type: SimEvent['type'] = 'collision',
) {
  world.status = 'error';
  world.errorReason = reason;
  world.errorHighlightHexes = highlightHexes.map((h) => ({ ...h }));
  pushEvent(world, {
    type,
    coord: highlightHexes[0] ?? { q: 0, r: 0 },
    message: reason,
    severity: 'error',
    relatedCoords: highlightHexes,
    badge: '!',
  });
}

