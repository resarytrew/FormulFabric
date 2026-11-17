import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { hexEqual, hexKey } from '../engine/hex-math';
import type { AxialCoord, HexDir, HexKey, MachineInstance, MachineType, SimulationWorld } from '../engine/types';

interface DragPendingState {
  fromCoord: AxialCoord;
  machine: MachineInstance;
  downX: number;
  downY: number;
  timerId: number | null;
}

interface DragActiveState {
  fromCoord: AxialCoord;
  machine: MachineInstance;
  currentDir: HexDir;
  targetCoord: AxialCoord | null;
}

interface InputProps {
  world: SimulationWorld;
  isTitleMode: boolean;
  isSimPlaying: boolean;
  selectedTool: MachineType | 'erase' | 'select' | null;
  onHexClick: (coord: AxialCoord) => void;
  onHexRightClick?: (coord: AxialCoord) => void;
  onHexHover?: (coord: AxialCoord | null) => void;
  onMoveBlock?: (from: AxialCoord, to: AxialCoord, dir?: HexDir) => void;
}

export function createSceneInput(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, controls: OrbitControls, propsRef: { current: InputProps }, machineMeshes: Map<HexKey, THREE.Group>, getInteractableHexes: () => THREE.Mesh[], invalidateGhost: () => void) {
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let hoveredCoord: AxialCoord | null = null;
    let pointerDownPos = { x: 0, y: 0 };
    let dragPending: DragPendingState | null = null;
    let dragActive: DragActiveState | null = null;

    function updatePointerRay(e: PointerEvent): AxialCoord | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(getInteractableHexes(), false);
      if (hits.length > 0) {
        return hits[0].object.userData.coord as AxialCoord;
      }
      return null;
    }

    function cancelActiveDrag() {
      if (dragPending?.timerId !== null && dragPending?.timerId !== undefined) {
        window.clearTimeout(dragPending.timerId);
      }
      dragPending = null;
      if (dragActive) {
        const origMesh = machineMeshes.get(hexKey(dragActive.fromCoord));
        if (origMesh) origMesh.visible = true;
      }
      dragActive = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = '';
    }

    function onPointerMove(e: PointerEvent) {
      if (propsRef.current.isTitleMode) return;
      const coord = updatePointerRay(e);
      hoveredCoord = coord;
      propsRef.current.onHexHover?.(coord);

      if (dragPending) {
        const dist = Math.hypot(e.clientX - dragPending.downX, e.clientY - dragPending.downY);
        if (dragPending.timerId !== null) {
          if (dist > 6) {
            window.clearTimeout(dragPending.timerId);
            dragPending = null;
          }
        } else if (dist > 7) {
          dragActive = {
            fromCoord: dragPending.fromCoord,
            machine: dragPending.machine,
            currentDir: dragPending.machine.config.dir,
            targetCoord: coord ?? dragPending.fromCoord,
          };
          dragPending = null;
          controls.enabled = false;
          renderer.domElement.style.cursor = 'grabbing';
        }
      }

      if (dragActive) {
        dragActive.targetCoord = coord;
      }
    }

    function onPointerDown(e: PointerEvent) {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      if (propsRef.current.isTitleMode || propsRef.current.isSimPlaying || e.button !== 0) return;

      const coord = updatePointerRay(e);
      hoveredCoord = coord;
      if (!coord || !propsRef.current.onMoveBlock) return;
      const m = propsRef.current.world.machines.get(hexKey(coord));
      if (!m || m.locked) return;

      const immediate =
        propsRef.current.selectedTool === 'select' || e.altKey || e.shiftKey;
      if (immediate) {
        controls.enabled = false;
        dragPending = {
          fromCoord: { ...coord },
          machine: m,
          downX: e.clientX,
          downY: e.clientY,
          timerId: null,
        };
      } else {
        const capturedCoord = { ...coord };
        const capturedMachine = m;
        const timerId = window.setTimeout(() => {
          if (!dragPending || !hexEqual(dragPending.fromCoord, capturedCoord)) return;
          dragPending = null;
          dragActive = {
            fromCoord: capturedCoord,
            machine: capturedMachine,
            currentDir: capturedMachine.config.dir,
            targetCoord: hoveredCoord ?? capturedCoord,
          };
          controls.enabled = false;
          renderer.domElement.style.cursor = 'grabbing';
        }, 180);
        dragPending = {
          fromCoord: capturedCoord,
          machine: capturedMachine,
          downX: e.clientX,
          downY: e.clientY,
          timerId,
        };
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (dragPending?.timerId !== null && dragPending?.timerId !== undefined) {
        window.clearTimeout(dragPending.timerId);
      }

      if (dragActive) {
        const active = dragActive;
        const dropCoord = updatePointerRay(e) ?? active.targetCoord;
        cancelActiveDrag();

        if (!propsRef.current.isTitleMode && !propsRef.current.isSimPlaying && dropCoord) {
          const wSnap = propsRef.current.world;
          const dKey = hexKey(dropCoord);
          const destMachine = wSnap.machines.get(dKey);
          const isBlockedDrop =
            !wSnap.platformHexes.has(dKey) ||
            wSnap.narrowGapHexes.has(dKey) ||
            wSnap.sinkFootprintHexes.has(dKey) ||
            Boolean(destMachine?.locked);
          const validDrop =
            !isBlockedDrop &&
            (!hexEqual(dropCoord, active.fromCoord) ||
              active.currentDir !== active.machine.config.dir);
          if (validDrop || (isBlockedDrop && !hexEqual(dropCoord, active.fromCoord))) {
            propsRef.current.onMoveBlock?.(active.fromCoord, dropCoord, active.currentDir);
          }
        }
        return;
      }

      if (dragPending) {
        dragPending = null;
        controls.enabled = true;
      }

      if (propsRef.current.isTitleMode) return;
      const movedDist = Math.hypot(
        e.clientX - pointerDownPos.x,
        e.clientY - pointerDownPos.y,
      );
      if (movedDist > 7) return; // Was an orbit/pan drag, not a click
      const coord = updatePointerRay(e);
      if (!coord) return;
      if (e.button === 2) {
        propsRef.current.onHexRightClick?.(coord);
      } else if (e.button === 0) {
        propsRef.current.onHexClick(coord);
      }
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      if (dragActive) {
        cancelActiveDrag();
      }
    }

    // WASD / Arrow camera panning & drag-time R/Escape handling
    const keysDown = new Set<string>();
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (dragActive && e.code === 'KeyR') {
        e.preventDefault();
        e.stopPropagation();
        dragActive.currentDir = ((dragActive.currentDir + 1) % 6) as HexDir;
        invalidateGhost();
        return;
      }
      if (dragActive && e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelActiveDrag();
        return;
      }
      keysDown.add(e.code);
    }
    function onKeyUp(e: KeyboardEvent) {
      keysDown.delete(e.code);
    }
    function onWindowBlur() {
      keysDown.clear();
      cancelActiveDrag();
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', cancelActiveDrag);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);


    return {
      get hoveredCoord() { return hoveredCoord; },
      get dragActive() { return dragActive; },
      get dragPending() { return dragPending; },
      keysDown,
      dispose() {
        cancelActiveDrag();
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('pointercancel', cancelActiveDrag);
        renderer.domElement.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onWindowBlur);
      },
    };
}
