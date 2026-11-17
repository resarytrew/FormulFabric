import { useEffect, useRef, type RefObject } from 'react';
import type { AxialCoord } from '../engine/types';

interface CameraActions {
  resetCamera: () => void;
  focusCoord: (coord: AxialCoord) => void;
}

export function useSceneCamera(scene: RefObject<CameraActions | null>, titleMode: boolean, resetTrigger: number, focusTrigger?: { coord: AxialCoord; seq: number } | null) {
  const previousTitleMode = useRef(titleMode);
  useEffect(() => {
    if (previousTitleMode.current && !titleMode) scene.current?.resetCamera();
    previousTitleMode.current = titleMode;
  }, [titleMode, scene]);
  useEffect(() => {
    if (resetTrigger > 0) scene.current?.resetCamera();
  }, [resetTrigger, scene]);
  useEffect(() => {
    if (focusTrigger) scene.current?.focusCoord(focusTrigger.coord);
  }, [focusTrigger, scene]);
}
