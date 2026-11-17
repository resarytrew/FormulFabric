import { getConnectedComponents, type ConnectedComponent } from './components';
import { sortedMachines } from './deterministic-order';
import { pushEvent, triggerError } from './events';
import { hexDistance, hexEqual, hexKey, hexNeighbor } from './hex-math';
import type { ConsumedTokenKind, HexKey, SimulationWorld, Token } from './types';

function addBondCanonical(world: SimulationWorld, idA: string, idB: string): boolean {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const exists = world.bonds.some((e) => e.a === a && e.b === b);
  if (exists) return false;
  world.bonds.push({ a, b });
  return true;
}

export function processAssembly(world: SimulationWorld, machineActionOccurredThisTick: boolean, recordConsumed: (token: Token, kind: ConsumedTokenKind) => void): boolean | null {
  // Process Welders & Steam Lasers
  const updatedHexMap = new Map<HexKey, Token>();
  for (const t of world.tokens.values()) {
    updatedHexMap.set(hexKey(t.coord), t);
  }

  // Сварка и резка обходят механизмы в каноническом порядке: события weld/cut
  // (и, значит, анимационные эффекты) не зависят от порядка хранения.
  for (const machine of sortedMachines(world)) {
    if (machine.type === 'welder') {
      const tA = updatedHexMap.get(hexKey(machine.coord));
      const neighbor = hexNeighbor(machine.coord, machine.config.dir);
      const tB = updatedHexMap.get(hexKey(neighbor));
      if (tA && tB && hexDistance(tA.coord, tB.coord) === 1) {
        if (addBondCanonical(world, tA.id, tB.id)) {
          machineActionOccurredThisTick = true;
          machine.state.activeFlashTicks = 1;
          pushEvent(world, {
            type: 'weld',
            coord: machine.coord,
            message: `Сварка: [${tA.value} ━━ ${tB.value}]`,
            severity: 'success',
            relatedCoords: [machine.coord, neighbor],
            badge: 'СВАРКА',
          });
        }
      }
    } else if (machine.type === 'laser') {
      const tA = updatedHexMap.get(hexKey(machine.coord));
      const neighbor = hexNeighbor(machine.coord, machine.config.dir);
      const tB = updatedHexMap.get(hexKey(neighbor));
      if (tA && tB) {
        const [a, b] = tA.id < tB.id ? [tA.id, tB.id] : [tB.id, tA.id];
        const idx = world.bonds.findIndex((e) => e.a === a && e.b === b);
        if (idx !== -1) {
          world.bonds.splice(idx, 1);
          machineActionOccurredThisTick = true;
          machine.state.activeFlashTicks = 1;
          pushEvent(world, {
            type: 'cut',
            coord: machine.coord,
            message: `Лазер разрезал связь [${tA.value} -/- ${tB.value}]`,
            severity: 'info',
            relatedCoords: [machine.coord, neighbor],
            badge: 'РАЗРЕЗ',
          });
        }
      }
    }
  }

  // Process Destroyers (recycles any token or bonded polymer touching the shredder hex)
  const postMoveComponents = getConnectedComponents(world);
  const compByTokenAfterMove = new Map<string, ConnectedComponent>();
  for (const c of postMoveComponents) {
    for (const id of c.tokenIds) compByTokenAfterMove.set(id, c);
  }
  const destroyedCompIds = new Set<string>();
  for (const machine of sortedMachines(world)) {
    if (machine.type !== 'destroyer') continue;
    const victim = Array.from(world.tokens.values()).find((t) => hexEqual(t.coord, machine.coord));
    if (!victim) continue;
    const comp = compByTokenAfterMove.get(victim.id);
    if (!comp || destroyedCompIds.has(comp.id)) continue;
    destroyedCompIds.add(comp.id);
    const compSet = new Set(comp.tokenIds);
    const vals = comp.tokenIds.map((id) => world.tokens.get(id)?.value ?? 0);
    for (const id of comp.tokenIds) {
      const deadTok = world.tokens.get(id);
      if (deadTok) recordConsumed(deadTok, 'destroy');
      world.tokens.delete(id);
    }
    for (const b of world.bonds) {
      if (compSet.has(b.a) || compSet.has(b.b)) {
        world.consumedBonds!.push({ ...b });
      }
    }
    world.bonds = world.bonds.filter((b) => !compSet.has(b.a) && !compSet.has(b.b));
    machineActionOccurredThisTick = true;
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;
    pushEvent(world, {
      type: 'destroy',
      coord: machine.coord,
      message: `Утилизатор × переработал: [${vals.join(' ━━ ')}]`,
      severity: 'warning',
      badge: '×',
    });
  }

  // Guard against cutting/spawning leaving an unsupported token over a narrow fissure
  if (world.narrowGapHexes.size > 0) {
    const gapComponents = getConnectedComponents(world);
    for (const comp of gapComponents) {
      const compToks = comp.tokenIds.map((id) => world.tokens.get(id)!);
      const overGap = compToks.filter((t) => world.narrowGapHexes.has(hexKey(t.coord)));
      if (overGap.length === 0) continue;
      const hasSolidAnchor =
        compToks.length >= 2 &&
        compToks.some((t) => {
          const k = hexKey(t.coord);
          return world.platformHexes.has(k) && !world.narrowGapHexes.has(k);
        });
      if (!hasSolidAnchor) {
        world.fallingTokens = overGap.map((t) => ({
          value: t.value,
          fromCoord: { ...t.prevCoord },
          toCoord: { ...t.coord },
        }));
        triggerError(
          world,
          'Сфера провалилась в узкий разлом: после разреза или спавна не осталось опоры на твёрдой плитке',
          overGap.map((t) => t.coord),
          'collision',
        );
        return null;
      }
    }
  }

  return machineActionOccurredThisTick;
}
