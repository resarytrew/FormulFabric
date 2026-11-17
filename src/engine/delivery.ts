import { checkVictory } from './victory';
import { getConnectedComponents } from './components';
import { pushEvent, triggerError } from './events';
import { hexEqual, hexKey, hexNeighbor, oppositeDir } from './hex-math';
import { matchComponentToPattern } from './patterns';
import { MAX_SIMULATION_TICKS } from './simulation-constants';
import type { ConsumedTokenKind, MachineType, SimulationWorld, Token } from './types';

export function finishSimulationTick(world: SimulationWorld, machineActionOccurredThisTick: boolean, recordConsumed: (token: Token, kind: ConsumedTokenKind) => void): SimulationWorld {
  // Phase 5: Delivery & Victory Check
  const DIRECT_DRIVE_MACHINE_TYPES: ReadonlySet<MachineType> = new Set([
    'conveyor',
    'add1',
    'sub1',
    'mul2',
    'div2',
    'sqrt',
    'neg',
    'dup',
    'adder',
    'filter',
    'splitter',
    'divmod',
    'halver',
    'scales',
    'jumper',
    'destroyer',
  ]);
  const hasNextTickDrive = (compToks: Token[]): boolean => {
    for (const tok of compToks) {
      const onMachine = world.machines.get(hexKey(tok.coord));
      if (onMachine && DIRECT_DRIVE_MACHINE_TYPES.has(onMachine.type)) {
        return true;
      }
    }
    for (const m of world.machines.values()) {
      if (m.type === 'pusher') {
        const target = hexNeighbor(m.coord, m.config.dir);
        if (compToks.some((t) => hexEqual(t.coord, target))) return true;
      } else if (m.type === 'magnet') {
        const d1 = hexNeighbor(m.coord, m.config.dir);
        const d2 = hexNeighbor(d1, m.config.dir);
        const d1Busy = Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, d1));
        if (!d1Busy && compToks.some((t) => hexEqual(t.coord, d2))) return true;
      } else if (m.type === 'rotator') {
        const grabHex = hexNeighbor(m.coord, m.config.dir);
        if (compToks.some((t) => hexEqual(t.coord, grabHex))) return true;
      } else if (m.type === 'swapper') {
        const a = hexNeighbor(m.coord, m.config.dir);
        const b = hexNeighbor(m.coord, oppositeDir(m.config.dir));
        if (compToks.some((t) => hexEqual(t.coord, a) || hexEqual(t.coord, b))) return true;
      }
    }
    return false;
  };
  const hasPendingWelderOrLaserInteraction = (compToks: Token[]): boolean => {
    let touchesEdgeTool = false;
    for (const m of world.machines.values()) {
      if (m.type !== 'welder' && m.type !== 'laser') continue;
      const other = hexNeighbor(m.coord, m.config.dir);
      if (compToks.some((t) => hexEqual(t.coord, m.coord) || hexEqual(t.coord, other))) {
        touchesEdgeTool = true;
        break;
      }
    }
    if (!touchesEdgeTool) return false;
    if (world.tokens.size > compToks.length) return true;
    for (const m of world.machines.values()) {
      if (m.type === 'spawner') {
        const seq = m.config.sequence ?? [];
        if (seq.length > 0 && (m.config.loopSequence || m.state.spawnIndex < seq.length)) {
          return true;
        }
      }
    }
    return false;
  };

  const postComponents = getConnectedComponents(world);
  for (const comp of postComponents) {
    for (const machine of world.machines.values()) {
      if (machine.type !== 'sink' || !machine.config.targetPattern) continue;
      const pattern = machine.config.targetPattern;
      const sinkId = machine.config.sinkId ?? machine.id;

      // Check if component overlaps this sink's footprint
      const sinkFootprint = pattern.nodes.map((n) => ({
        q: machine.coord.q + n.offset.q,
        r: machine.coord.r + n.offset.r,
      }));
      const compTokens = comp.tokenIds.map((id) => world.tokens.get(id)!);
      const anyOnSink = compTokens.some((t) =>
        sinkFootprint.some((f) => hexEqual(t.coord, f)),
      );
      if (!anyOnSink) continue;

      const hist = world.sinkDeliveries[sinkId] ?? [];
      const matchRes = matchComponentToPattern(comp, world, machine.coord, pattern, hist.length);
      if (matchRes.matched) {
        const deliveredVals = matchRes.matchedValues ?? compTokens.map((t) => t.value);

        // If sink has expectedValues sequence, verify expected item.
        // Скалярные ожидания допустимы только для односферных доставок
        // (линтер отклоняет expectedValues у многозвенных образцов),
        // поэтому сравнение значений здесь точно при deliveredVals.length === 1.
        if (pattern.expectedValues && pattern.expectedValues.length > 0) {
          const stepIdx = hist.length;
          if (stepIdx >= pattern.expectedValues.length) {
            triggerError(
              world,
              `Лишняя доставка в приёмник (${deliveredVals.join(', ')})`,
              [machine.coord],
              'error',
            );
            return world;
          }
          if (
            deliveredVals.length === 1 &&
            deliveredVals[0] !== pattern.expectedValues[stepIdx]
          ) {
            triggerError(
              world,
              `Приёмник ожидал ${pattern.expectedValues[stepIdx]}, получено ${deliveredVals[0]}`,
              [machine.coord],
              'error',
            );
            return world;
          }
        }
        if (pattern.expectedNodeValues && pattern.expectedNodeValues.length > 0) {
          if (hist.length >= pattern.expectedNodeValues.length) {
            triggerError(
              world,
              `Лишняя доставка полимера в приёмник ([${deliveredVals.join(' ━━ ')}])`,
              [machine.coord],
              'error',
            );
            return world;
          }
        }

        // Remove all tokens in the matched component & their bonds
        const compSet = new Set(comp.tokenIds);
        for (const id of comp.tokenIds) {
          const delTok = world.tokens.get(id);
          if (delTok) recordConsumed(delTok, 'deliver');
          world.tokens.delete(id);
        }
        for (const b of world.bonds) {
          if (compSet.has(b.a) || compSet.has(b.b)) {
            world.consumedBonds!.push({ ...b });
          }
        }
        world.bonds = world.bonds.filter((b) => !compSet.has(b.a) && !compSet.has(b.b));

        if (!world.sinkDeliveries[sinkId]) {
          world.sinkDeliveries[sinkId] = [];
        }
        world.sinkDeliveries[sinkId].push(deliveredVals);
        world.deliveredCount += 1;
        machine.state.activeFlashTicks = 2;

        pushEvent(world, {
          type: 'deliver',
          coord: machine.coord,
          message: `Доставлено: [${deliveredVals.join(' ━━ ')}] (${world.deliveredCount}/${world.infiniteMode ? '∞' : world.requiredDeliveries})`,
          severity: 'success',
          badge: `✓ ${deliveredVals.join('·')}`,
        });
        break;
      } else {
        const allFootprintCovered = sinkFootprint.every((f) =>
          compTokens.some((t) => hexEqual(t.coord, f)),
        );
        const isScalarSinkWrongVal =
          pattern.nodes.length === 1 &&
          compTokens.length === 1 &&
          hexEqual(compTokens[0].coord, machine.coord);
        const isStalledMismatch =
          !hasNextTickDrive(compTokens) && !hasPendingWelderOrLaserInteraction(compTokens);
        if (allFootprintCovered || isScalarSinkWrongVal || isStalledMismatch) {
          triggerError(
            world,
            `Приёмник отклонил структуру: ${matchRes.reason ?? 'неверный образец'}`,
            compTokens.map((t) => t.coord),
            'error',
          );
          return world;
        }
      }
    }
  }

  checkVictory(world);

  // Deadlock check for waiting side-port queues: if machines are holding tokens on blocked altDir
  // while zero tokens moved/transformed, no non-waiting component has drive, and no spawner can emit
  if (world.status === 'running' && !machineActionOccurredThisTick && world.tokens.size > 0) {
    const waitingMachines = Array.from(world.machines.values()).filter(
      (m) => m.state.isWaitingSideExit,
    );
    if (waitingMachines.length > 0) {
      const anyActiveSpawnerPending = Array.from(world.machines.values()).some((m) => {
        if (m.type !== 'spawner') return false;
        const seq = m.config.sequence ?? [];
        if (seq.length === 0) return false;
        const hasMore = m.config.loopSequence || m.state.spawnIndex < seq.length;
        if (!hasMore) return false;
        const out = hexNeighbor(m.coord, m.config.dir);
        const outFree = !Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, out));
        return outFree;
      });
      const anyNonWaitingDriven = postComponents.some((comp) => {
        const compToks = comp.tokenIds.map((id) => world.tokens.get(id)!);
        if (compToks.some((t) => t.waitingSidePort)) return false;
        return hasNextTickDrive(compToks);
      });
      if (!anyActiveSpawnerPending && !anyNonWaitingDriven) {
        triggerError(
          world,
          'Затор на боковом выходе станка: соседний гекс занят и поток остановился',
          waitingMachines.map((m) => m.coord),
          'blocked',
        );
        return world;
      }
    }
  }

  if (!world.infiniteMode && world.status === 'running' && world.tick >= MAX_SIMULATION_TICKS) {
    triggerError(
      world,
      `Цикл не завершился за отведённое время (${MAX_SIMULATION_TICKS} тактов) — проверьте условие выхода фильтра`,
      Array.from(world.tokens.values()).map((t) => t.coord),
      'error',
    );
    return world;
  }

  return world;
}
