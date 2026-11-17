import { sortedTokens } from './deterministic-order';
import type { SimulationWorld } from './types';

export interface ConnectedComponent {
  id: string;
  tokenIds: string[];
  bondIndices: number[];
}

/**
 * Связные компоненты в каноническом порядке сфер (`spawnOrder`, координата,
 * `id`). Порядок компонентов виден снаружи: он задаёт порядок вспышек
 * механизмов, порядок доставок и выбор компонента для диагностики, поэтому он
 * не должен зависеть от порядка вставки в `world.tokens`.
 */
export function getConnectedComponents(world: SimulationWorld): ConnectedComponent[] {
  const orderedTokens = sortedTokens(world);
  const adj = new Map<string, string[]>();
  for (const tok of orderedTokens) {
    adj.set(tok.id, []);
  }
  for (const edge of world.bonds) {
    if (world.tokens.has(edge.a) && world.tokens.has(edge.b)) {
      adj.get(edge.a)!.push(edge.b);
      adj.get(edge.b)!.push(edge.a);
    }
  }

  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];

  for (const { id } of orderedTokens) {
    if (visited.has(id)) continue;
    const stack = [id];
    const tokenIds: string[] = [];
    visited.add(id);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      tokenIds.push(curr);
      for (const nb of adj.get(curr) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    tokenIds.sort();
    const tokenSet = new Set(tokenIds);
    const bondIndices: number[] = [];
    world.bonds.forEach((b, idx) => {
      if (tokenSet.has(b.a) && tokenSet.has(b.b)) {
        bondIndices.push(idx);
      }
    });
    components.push({
      id: tokenIds[0],
      tokenIds,
      bondIndices,
    });
  }

  return components;
}

