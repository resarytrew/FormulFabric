import type { ConnectedComponent } from './components';
import { triggerError } from './events';
import { hexKey, hexNeighbor, oppositeDir, rotateDir } from './hex-math';
import { evaluateFilterRule } from './operations';
import type { ComponentIntent } from './movement-types';
import type { HexKey, MachineInstance, SimulationWorld, Token } from './types';

export function computeMovementIntents(world: SimulationWorld, components: ConnectedComponent[], tokenToComponent: Map<string, ConnectedComponent>, tokenAtHex: Map<HexKey, Token>): Map<string, ComponentIntent[]> | null {
  // Phase 2: Compute Intents symmetrically with Tier hierarchy (Actuator Tier 2 > Belt Tier 1)
  const intentsByComp = new Map<string, ComponentIntent[]>();
  for (const c of components) {
    intentsByComp.set(c.id, []);
  }

  const addIntent = (compId: string, intent: ComponentIntent) => {
    intentsByComp.get(compId)!.push(intent);
  };

  const activePushers: Array<{ machine: MachineInstance; rootComp: ConnectedComponent }> = [];

  for (const machine of world.machines.values()) {
    const mKey = hexKey(machine.coord);

    if (
      machine.type === 'conveyor' ||
      machine.type === 'add1' ||
      machine.type === 'sub1' ||
      machine.type === 'mul2' ||
      machine.type === 'div2' ||
      machine.type === 'sqrt' ||
      machine.type === 'neg' ||
      machine.type === 'dup'
    ) {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        if (tok.waitingSidePort === machine.id) {
          machine.state.isWaitingSideExit = true;
          continue;
        }
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 1,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'adder') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 1,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'filter') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        const pass = evaluateFilterRule(tok.value, machine.config.filterRule ?? 'even');
        const outDir = pass
          ? machine.config.dir
          : (machine.config.altDir ?? rotateDir(machine.config.dir, 1));
        addIntent(comp.id, {
          kind: 'move',
          dir: outDir,
          tier: 1,
          signature: `move:${outDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'splitter') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        const useAlt = machine.state.memory === 1;
        const outDir = useAlt
          ? (machine.config.altDir ?? rotateDir(machine.config.dir, 1))
          : machine.config.dir;
        addIntent(comp.id, {
          kind: 'move',
          dir: outDir,
          tier: 1,
          signature: `move:${outDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (
      machine.type === 'divmod' ||
      machine.type === 'halver' ||
      machine.type === 'scales'
    ) {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        if (tok.waitingSidePort === machine.id) {
          machine.state.isWaitingSideExit = true;
          continue;
        }
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 1,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'jumper') {
      const tok = tokenAtHex.get(mKey);
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        if (comp.tokenIds.length > 1) {
          triggerError(
            world,
            'Пружина трамплина перегружена: полимер нельзя перебросить целиком',
            [machine.coord],
            'error',
          );
          return null;
        }
        addIntent(comp.id, {
          kind: 'jump',
          dir: machine.config.dir,
          tier: 2,
          signature: `jump:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'pusher') {
      const targetHex = hexNeighbor(machine.coord, machine.config.dir);
      const tok = tokenAtHex.get(hexKey(targetHex));
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        addIntent(comp.id, {
          kind: 'move',
          dir: machine.config.dir,
          tier: 2,
          signature: `move:${machine.config.dir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
          pushChainIndex: 0,
        });
        activePushers.push({ machine, rootComp: comp });
      }
    } else if (machine.type === 'magnet') {
      const d1 = hexNeighbor(machine.coord, machine.config.dir);
      const d2 = hexNeighbor(d1, machine.config.dir);
      const tok1 = tokenAtHex.get(hexKey(d1));
      const tok2 = tokenAtHex.get(hexKey(d2));
      if (!tok1 && tok2) {
        const comp = tokenToComponent.get(tok2.id)!;
        const pullDir = oppositeDir(machine.config.dir);
        addIntent(comp.id, {
          kind: 'move',
          dir: pullDir,
          tier: 2,
          signature: `move:${pullDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'rotator') {
      const grabHex = hexNeighbor(machine.coord, machine.config.dir);
      const tok = tokenAtHex.get(hexKey(grabHex));
      if (tok) {
        const comp = tokenToComponent.get(tok.id)!;
        const cwSteps = machine.config.rotMode === 'ccw' ? -1 : 1;
        addIntent(comp.id, {
          kind: 'rotate',
          pivot: { ...machine.coord },
          cwSteps,
          tier: 2,
          signature: `rot:${machine.coord.q},${machine.coord.r}:${cwSteps}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    } else if (machine.type === 'swapper') {
      const hexA = hexNeighbor(machine.coord, machine.config.dir);
      const hexB = hexNeighbor(machine.coord, oppositeDir(machine.config.dir));
      const tokA = tokenAtHex.get(hexKey(hexA));
      const tokB = tokenAtHex.get(hexKey(hexB));
      const touchedComps = new Set<string>();
      for (const tok of [tokA, tokB]) {
        if (!tok) continue;
        const comp = tokenToComponent.get(tok.id)!;
        if (touchedComps.has(comp.id)) continue;
        touchedComps.add(comp.id);
        addIntent(comp.id, {
          kind: 'swap',
          pivot: { ...machine.coord },
          tier: 2,
          signature: `swap:${machine.coord.q},${machine.coord.r}`,
          sourceCoord: machine.coord,
          sourceMachineType: machine.type,
        });
      }
    }
  }

  // Phase 2B: Propagate Pusher chain impulses along push axis (up to 3 spheres / depth 3)
  const MAX_PUSHER_CHAIN_SPHERES = 3;
  for (const { machine, rootComp } of activePushers) {
    const pushDir = machine.config.dir;
    const visitedComps = new Set<string>([rootComp.id]);
    let totalPushedSpheres = rootComp.tokenIds.length;
    const queue: Array<{ comp: ConnectedComponent; chainIdx: number }> = [
      { comp: rootComp, chainIdx: 0 },
    ];

    while (queue.length > 0) {
      const { comp, chainIdx } = queue.shift()!;
      for (const id of comp.tokenIds) {
        const tok = world.tokens.get(id)!;
        const aheadCoord = hexNeighbor(tok.coord, pushDir);
        const aheadTok = tokenAtHex.get(hexKey(aheadCoord));
        if (!aheadTok) continue;
        const aheadComp = tokenToComponent.get(aheadTok.id)!;
        if (visitedComps.has(aheadComp.id)) continue;

        const existingIntents = intentsByComp.get(aheadComp.id)!;
        const hasTier2 = existingIntents.some((i) => i.tier === 2);
        const tier1OpposesOrStalls =
          existingIntents.length === 0 ||
          existingIntents.some(
            (i) => i.tier === 1 && i.kind === 'move' && i.dir === oppositeDir(pushDir),
          );

        if (!hasTier2 && !tier1OpposesOrStalls) {
          // aheadComp moves away cleanly on its own belt this tick without blocking the pushed line
          continue;
        }

        const nextChainIdx = chainIdx + 1;
        totalPushedSpheres += aheadComp.tokenIds.length;
        if (nextChainIdx >= MAX_PUSHER_CHAIN_SPHERES || totalPushedSpheres > MAX_PUSHER_CHAIN_SPHERES) {
          triggerError(
            world,
            `Перегрузка толкателя: невозможно сдвинуть цепочку тяжелее ${MAX_PUSHER_CHAIN_SPHERES} сфер`,
            [machine.coord, tok.coord, aheadCoord],
            'collision',
          );
          return null;
        }

        visitedComps.add(aheadComp.id);
        addIntent(aheadComp.id, {
          kind: 'move',
          dir: pushDir,
          tier: 2,
          signature: `move:${pushDir}`,
          sourceCoord: machine.coord,
          sourceMachineType: 'pusher',
          pushChainIndex: nextChainIdx,
        });
        queue.push({ comp: aheadComp, chainIdx: nextChainIdx });
      }
    }
  }

  return intentsByComp;
}
