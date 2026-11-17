import { useEffect, useRef, type RefObject } from 'react';
import type { SimEvent } from '../engine/types';
import { TOKEN_TRIGGER_ALPHA } from './tokenAnimationTimeline';

interface EventEffects {
  emitEventFx: (event: SimEvent) => void;
  queueEventFx: (event: SimEvent) => void;
  clearPendingEventFx: () => void;
}

/** Deliver simulation events once, respecting rewind and animation timing. */
export function useSceneEvents(events: SimEvent[], tick: number, playing: boolean, titleMode: boolean, progress: RefObject<number>, scene: RefObject<EventEffects | null>) {
  const lastEventId = useRef(0);
  useEffect(() => {
    if (tick === 0 || events.length === 0) {
      lastEventId.current = 0;
      scene.current?.clearPendingEventFx();
      return;
    }
    const maxId = events[events.length - 1].id;
    if (maxId < lastEventId.current) {
      lastEventId.current = maxId;
      scene.current?.clearPendingEventFx();
      return;
    }
    const newEvents = events.filter(event => event.id > lastEventId.current);
    lastEventId.current = maxId;
    const animated = (playing || titleMode) && progress.current < TOKEN_TRIGGER_ALPHA;
    for (const event of newEvents) {
      if (event.type === 'spawn' || event.type === 'collision' || event.type === 'error' || !animated) {
        scene.current?.emitEventFx(event);
      } else {
        scene.current?.queueEventFx(event);
      }
    }
  }, [events, tick, playing, titleMode, progress, scene]);
}
