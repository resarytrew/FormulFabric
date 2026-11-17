import type { ConnectedComponent } from './components';
import { pushEvent } from './events';
import { hexEqual, hexKey } from './hex-math';
import type { ComponentIntent } from './movement-types';
import type { AxialCoord, SimulationWorld, TokenMoveSource } from './types';

export function applyMovement(world: SimulationWorld, components: ConnectedComponent[], tokenToComponent: Map<string, ConnectedComponent>, resolvedIntentByComp: Map<string, ComponentIntent | null>, proposedCoordByToken: Map<string, AxialCoord>, rotationInfoByToken: Map<string, { pivot: AxialCoord; angleDelta: number } | undefined>): Set<string> {
  // Phase 4: Simultaneous Apply (Moves, Spawners, Arithmetic, Welds, Laser Cuts)
  const movedTokenIds = new Set<string>();
  for (const [id, coord] of proposedCoordByToken.entries()) {
    const tok = world.tokens.get(id)!;
    if (!hexEqual(tok.coord, coord)) {
      movedTokenIds.add(id);
      if (tok.waitingSidePort) {
        const prevMach = world.machines.get(hexKey(tok.coord));
        if (prevMach && prevMach.id === tok.waitingSidePort) {
          prevMach.state.waitTicks = 0;
          prevMach.state.isWaitingSideExit = false;
        }
        tok.waitingSidePort = undefined;
      }
      tok.coord = { ...coord };
      tok.rotatedFrom = rotationInfoByToken.get(id);
      const comp = tokenToComponent.get(id);
      const intent = comp ? resolvedIntentByComp.get(comp.id) : null;
      let moveSource: TokenMoveSource = 'conveyor';
      if (intent?.kind === 'rotate') {
        moveSource = 'rotator';
      } else if (intent?.kind === 'jump') {
        moveSource = 'jump';
      } else if (intent?.kind === 'swap') {
        moveSource = 'swap';
      } else if (intent?.sourceMachineType === 'pusher') {
        moveSource = 'pusher';
        tok.pushChainIndex = intent.pushChainIndex;
      } else if (intent?.sourceMachineType === 'magnet') {
        moveSource = 'magnet';
      }
      tok.moveSource = moveSource;
    }
  }

  // Flash active actuators that moved components
  const toggledSplitters = new Set<string>();
  const loggedSwappers = new Set<string>();
  for (const comp of components) {
    const intent = resolvedIntentByComp.get(comp.id);
    if (intent) {
      const m = world.machines.get(hexKey(intent.sourceCoord));
      if (m) {
        m.state.activeFlashTicks = 1;
        m.state.lastActionTick = world.tick;
        if (m.type === 'splitter' && !toggledSplitters.has(m.id)) {
          toggledSplitters.add(m.id);
          const wasAlt = m.state.memory === 1;
          m.state.memory = wasAlt ? 0 : 1;
          pushEvent(world, {
            type: 'move',
            coord: m.coord,
            message: `Разделитель ⇄: порт ${wasAlt ? 'B → A' : 'A → B'}`,
            severity: 'info',
            badge: '⇄',
          });
        } else if (m.type === 'swapper' && !loggedSwappers.has(m.id)) {
          loggedSwappers.add(m.id);
          pushEvent(world, {
            type: 'rotate',
            coord: m.coord,
            message: 'Качели-менялка ⇄: разворот на 180°',
            severity: 'info',
            badge: '180°⇄',
          });
        } else if (m.type === 'jumper') {
          pushEvent(world, {
            type: 'move',
            coord: m.coord,
            message: 'Трамплин ↷ перебросил сферу через гекс',
            severity: 'info',
            badge: '↷',
          });
        }
      }
      if (intent.kind === 'rotate') {
        pushEvent(world, {
          type: 'rotate',
          coord: intent.pivot,
          message: `Поворот полимера на 60° ${intent.cwSteps === 1 ? '↻' : '↺'}`,
          severity: 'info',
          badge: intent.cwSteps === 1 ? '60°↻' : '60°↺',
        });
      }
    }
  }

  return movedTokenIds;
}
