import * as THREE from 'three';
import { hexKey } from '../engine/hex-math';
import type { AxialCoord, HexKey, SimulationWorld } from '../engine/types';
import type { Vec2 } from './conveyorTopology';
import { evaluateMachineActionCurves } from './tokenAnimationTimeline';

export function animateMachines(machineMeshes: Map<HexKey, THREE.Group>, machineDropAge: Map<HexKey, number>, wSnap: SimulationWorld, dragCoord: AxialCoord | null, alpha: number, moveNorm: number, moveEase: number, elapsed: number, dt: number): void {
      // Animate all 3D industrial mechanism sub-parts smoothly with accumulated phase velocity
      for (const [k, mGroup] of machineMeshes.entries()) {
        // Hide original machine while it is lifted & dragged across the board
        const isBeingDragged = Boolean(dragCoord && hexKey(dragCoord) === k);
        mGroup.visible = !isBeingDragged;
        if (isBeingDragged) continue;

        // Spring drop-in settle when machine is newly placed
        const dropAge = machineDropAge.get(k);
        if (dropAge !== undefined) {
          const nextAge = dropAge + dt * 4.2;
          if (nextAge >= 1) {
            machineDropAge.delete(k);
            mGroup.position.y = 0;
            mGroup.scale.setScalar(1);
          } else {
            machineDropAge.set(k, nextAge);
            const dropY = Math.pow(1 - nextAge, 2) * 0.42;
            const squash = 1 + Math.sin(nextAge * Math.PI) * 0.07;
            mGroup.position.y = dropY;
            mGroup.scale.set(squash, 2 - squash, squash);
          }
        }

        const mData = wSnap.machines.get(k);
        const isFlashing = (mData?.state.activeFlashTicks ?? 0) > 0;
        const isWaitingExit = Boolean(mData?.state.isWaitingSideExit);
        const beltSpeedMul = isWaitingExit ? 0.18 : 1.0;
        const { stroke, flashArc } = evaluateMachineActionCurves(alpha, isFlashing);

        mGroup.traverse((child) => {
          const anim = child.userData.animType;
          if (!anim) return;

          if (anim === 'conveyorRoller') {
            const ph = ((child.userData.phase as number) ?? 0) + dt * (5.2 + flashArc * 5.0) * beltSpeedMul;
            child.userData.phase = ph;
            child.rotation.z = -ph;
          } else if (anim === 'conveyorGear') {
            const sign = (child.userData.gearSign as number) ?? -1;
            const ph = ((child.userData.phase as number) ?? 0) + dt * (4.0 + flashArc * 4.0) * beltSpeedMul;
            child.userData.phase = ph;
            child.rotation.z = sign * ph;
          } else if (anim === 'conveyorTread') {
            const idx = (child.userData.treadIdx as number) ?? 0;
            const count = (child.userData.treadCount as number) ?? 6;
            const beltPhase = ((child.userData.beltPhase as number) ?? 0) + dt * (0.95 + flashArc * 0.65) * beltSpeedMul;
            child.userData.beltPhase = beltPhase;
            const phase = ((beltPhase + idx / count) % 1 + 1) % 1;

            const p0 = child.userData.curveP0 as Vec2 | undefined;
            const c1 = child.userData.curveC1 as Vec2 | undefined;
            const c2 = child.userData.curveC2 as Vec2 | undefined;
            const p2 = child.userData.curveP2 as Vec2 | undefined;
            if (p0 && c1 && c2 && p2) {
              const omt = 1 - phase;
              const omt2 = omt * omt;
              const t2 = phase * phase;
              const px = omt2 * omt * p0.x + 3 * omt2 * phase * c1.x + 3 * omt * t2 * c2.x + t2 * phase * p2.x;
              const pz = omt2 * omt * p0.z + 3 * omt2 * phase * c1.z + 3 * omt * t2 * c2.z + t2 * phase * p2.z;
              const tx =
                3 * omt2 * (c1.x - p0.x) +
                6 * omt * phase * (c2.x - c1.x) +
                3 * t2 * (p2.x - c2.x);
              const tz =
                3 * omt2 * (c1.z - p0.z) +
                6 * omt * phase * (c2.z - c1.z) +
                3 * t2 * (p2.z - c2.z);
              child.position.x = px;
              child.position.z = pz;
              child.rotation.order = 'YXZ';
              child.rotation.y = Math.atan2(-tz, tx);
            } else {
              child.position.x = -0.57 + phase * 1.14;
              child.position.z = 0;
              child.rotation.y = 0;
            }

            const isOpenIn = child.userData.isOpenIn !== false;
            const isOpenOut = child.userData.isOpenOut !== false;
            const cs = (child.userData.chevScale as number) ?? 1;
            if (phase < 0.13 && isOpenIn) {
              const t = phase / 0.13;
              child.position.y = 0.078 + t * 0.074;
              child.rotation.z = (1 - t) * 0.92;
              child.scale.set((0.35 + t * 0.65) * cs, 1, (0.72 + t * 0.28) * cs);
            } else if (phase < 0.1 && !isOpenIn) {
              const t = phase / 0.1;
              child.position.y = 0.152;
              child.rotation.z = 0;
              child.scale.set((0.3 + t * 0.7) * cs, 1, (0.75 + t * 0.25) * cs);
            } else if (phase > 0.87 && isOpenOut) {
              const t = (1 - phase) / 0.13;
              child.position.y = 0.078 + t * 0.074;
              child.rotation.z = -(1 - t) * 0.92;
              child.scale.set((0.35 + t * 0.65) * cs, 1, (0.72 + t * 0.28) * cs);
            } else if (phase > 0.9 && !isOpenOut) {
              const t = (1 - phase) / 0.1;
              child.position.y = 0.152;
              child.rotation.z = 0;
              child.scale.set((0.3 + t * 0.7) * cs, 1, (0.75 + t * 0.25) * cs);
            } else {
              child.position.y = 0.152;
              child.rotation.z = 0;
              child.scale.set(cs, 1, cs);
            }
          } else if (anim === 'flywheelZ') {
            const ph = ((child.userData.phase as number) ?? 0) + dt * (3.2 + flashArc * 4.5);
            child.userData.phase = ph;
            child.rotation.z = -ph;
          } else if (anim === 'spawnerCrankRod') {
            const ph = ((child.userData.phase as number) ?? 0) + dt * (3.2 + flashArc * 4.5);
            child.userData.phase = ph;
            child.position.y = 0.72 + Math.sin(ph) * 0.09;
            child.rotation.z = Math.cos(ph) * 0.16;
          } else if (anim === 'steamWheel') {
            const ph = ((child.userData.phase as number) ?? 0) + dt * (2.2 + flashArc * 3.8);
            child.userData.phase = ph;
            child.rotation.y = ph;
          } else if (anim === 'spawnerPiston') {
            child.position.y = 1.05 - stroke * 0.18;
          } else if (anim === 'spawnerGate') {
            // Top-hinged gate swings outward & upward smoothly
            child.rotation.z = flashArc * 1.05;
          } else if (anim === 'laserEmitter') {
            child.position.x = -stroke * 0.12;
          } else if (anim === 'laserCollimator') {
            const ph = ((child.userData.phase as number) ?? 0) + dt * (2.6 + flashArc * 7.5);
            child.userData.phase = ph;
            child.rotation.x = ph;
          } else if (anim === 'laserBeam') {
            const pulse = 1 + Math.sin(elapsed * 20) * 0.22 + flashArc * 1.1;
            child.scale.set(pulse, 1, pulse);
          } else if (anim === 'laserRing') {
            const rIdx = (child.userData.ringIdx as number) ?? 0;
            const slide = (elapsed * 1.65 + rIdx * 0.5) % 1;
            child.position.x = 0.64 + slide * 0.46;
            const rs = 0.72 + Math.sin(slide * Math.PI) * 0.5;
            child.scale.setScalar(rs);
            child.rotation.x = elapsed * 5.5 * (rIdx === 0 ? 1 : -1);
          } else if (anim === 'magnetPole') {
            child.position.x = 0.4 + flashArc * 0.035;
          } else if (anim === 'magnetArc') {
            const wIdx = (child.userData.waveIdx as number) ?? 0;
            const wavePhase = (elapsed * 1.45 + wIdx * 0.333) % 1;
            child.position.x = 1.25 - wavePhase * 0.72;
            const ws = Math.sin(wavePhase * Math.PI);
            child.scale.setScalar(0.55 + ws * 0.55);
          } else if (anim === 'rotatorGear') {
            const dirSign = child.userData.cw ? -1 : 1;
            const ph = ((child.userData.phase as number) ?? 0) + dt * (0.9 + flashArc * 2.2);
            child.userData.phase = ph;
            child.rotation.y = dirSign * ph;
          } else if (anim === 'rotatorArm') {
            if (isFlashing && moveNorm < 1) {
              const dirSign = child.userData.cw ? -1 : 1;
              child.rotation.y = dirSign * (Math.PI / 3) * (1 - moveEase);
              child.position.y = Math.sin(moveNorm * Math.PI) * 0.085;
              child.rotation.z = dirSign * Math.sin(moveNorm * Math.PI) * 0.07;
            } else {
              child.rotation.y = 0;
              child.position.y = 0;
              child.rotation.z = 0;
            }
          } else if (anim === 'rotatorBoom') {
            child.position.x = isFlashing ? stroke * 0.07 : 0;
          } else if (anim === 'rotatorClaw') {
            const side = (child.userData.side as number) ?? 1;
            const grip = isFlashing ? -0.18 : Math.sin(elapsed * 2.4) * 0.05;
            child.rotation.y = side * (-0.32 + grip);
          } else if (anim === 'pusher') {
            child.position.x = stroke * 0.58;
          } else if (anim === 'pusherCoil') {
            child.scale.x = 1 + stroke * 1.55;
          } else if (anim === 'pusherGauge') {
            child.rotation.z = 0.55 - stroke * 1.45 + Math.sin(elapsed * 7) * 0.04;
          } else if (anim === 'weldArm') {
            const side = (child.userData.side as number) ?? 1;
            const weave = isFlashing ? Math.sin(elapsed * 24) * 0.05 : 0;
            child.rotation.y = side * (flashArc * 0.16 + Math.sin(elapsed * 2.2) * 0.02) + weave;
          } else if (anim === 'weldElbow') {
            const side = (child.userData.side as number) ?? 1;
            child.rotation.y = side * (flashArc * 0.14);
            child.rotation.z = -flashArc * 0.12;
          } else if (anim === 'weldArc') {
            const ws = 0.85 + Math.sin(elapsed * 22) * 0.25 + flashArc * 1.3;
            child.scale.set(ws, 1, ws);
          } else if (anim === 'weldSpark') {
            const ws = 0.85 + Math.sin(elapsed * 22) * 0.3 + flashArc * 1.4;
            child.scale.setScalar(ws);
            child.rotation.y = elapsed * 6;
            child.rotation.x = elapsed * 4;
          } else if (anim === 'mathPost') {
            child.position.y = 0.2 - stroke * 0.05;
          } else if (anim === 'mathRing') {
            child.position.y = 0.155 + flashArc * 0.08;
            child.rotation.y = flashArc * (Math.PI / 6);
            const ms = 1 + flashArc * 0.05 + Math.sin(elapsed * 3) * 0.015;
            child.scale.set(ms, 1, ms);
          } else if (anim === 'memoryOrb') {
            if (child.userData.baseY === undefined) {
              child.userData.baseY = child.position.y;
            }
            const baseY = child.userData.baseY as number;
            child.position.y = baseY + Math.sin(elapsed * 4) * 0.055 + flashArc * 0.05;
            child.rotation.y = elapsed * 2.8 + flashArc * 1.6;
            child.rotation.z = elapsed * 1.5;
          } else if (anim === 'adderGyro') {
            child.position.y = 0.46 + Math.sin(elapsed * 4) * 0.055;
            child.rotation.x = elapsed * 2.6;
            child.rotation.y = elapsed * 1.9;
          } else if (anim === 'adderGyroOuter') {
            child.position.y = 0.46 + Math.sin(elapsed * 4) * 0.055;
            child.rotation.y = -elapsed * 2.1;
            child.rotation.z = elapsed * 2.9;
          } else if (anim === 'stepperHammer') {
            if (child.userData.baseY === undefined) {
              child.userData.baseY = child.position.y;
            }
            const baseY = child.userData.baseY as number;
            const dirSign = (child.userData.dirSign as number) ?? 1;
            child.position.y = baseY + dirSign * (stroke * 0.09 + Math.sin(elapsed * 3.2) * 0.014);
            child.rotation.y = elapsed * 1.4 * dirSign + stroke * 0.8 * dirSign;
          } else if (anim === 'counterGear') {
            const sign = (child.userData.gearSign as number) ?? 1;
            const ratio = (child.userData.gearRatio as number) ?? 1;
            const gearMul = isWaitingExit ? 0.15 : 1.0;
            const ph = ((child.userData.phase as number) ?? 0) + dt * (2.6 + flashArc * 5.2) * ratio * gearMul;
            child.userData.phase = ph;
            child.rotation.z = sign * ph;
          } else if (anim === 'filterBlade') {
            if (child.userData.baseRotY === undefined) {
              child.userData.baseRotY = child.rotation.y;
            }
            const baseRotY = child.userData.baseRotY as number;
            child.rotation.y = baseRotY + Math.sin(elapsed * 2.4) * 0.08 + stroke * 0.52;
          } else if (anim === 'sqrtPylonGem') {
            if (child.userData.baseY === undefined) {
              child.userData.baseY = child.position.y;
            }
            const baseY = child.userData.baseY as number;
            child.position.y = baseY + Math.sin(elapsed * 3.5) * 0.025 + flashArc * 0.06;
            child.rotation.y = elapsed * 2.8 + flashArc * 2.5;
            child.scale.setScalar(1 + flashArc * 0.28);
          } else if (anim === 'negVane') {
            const side = (child.userData.side as number) ?? 1;
            child.rotation.z = side * (Math.sin(elapsed * 3.4) * 0.14 + flashArc * 0.55);
            child.rotation.y = side * (Math.cos(elapsed * 2.2) * 0.12 + stroke * 0.4);
          } else if (anim === 'sinkHalo') {
            child.position.y = 0.14 + Math.sin(elapsed * 2.5) * 0.015 + flashArc * 0.08;
            child.rotation.z = elapsed * 0.65 + flashArc * 0.8;
            const hs = 1 + flashArc * 0.09;
            child.scale.set(hs, hs, 1);
          } else if (anim === 'sinkOuterHalo') {
            const pulse = 1 + Math.sin(elapsed * 3.2) * 0.03 + flashArc * 0.09;
            child.scale.set(pulse, pulse, 1);
          } else if (anim === 'shredderDrum') {
            const dSign = (child.userData.drumSign as number) ?? 1;
            const ph = ((child.userData.phase as number) ?? 0) + dt * (4.2 + flashArc * 8.5);
            child.userData.phase = ph;
            child.rotation.z = dSign * ph;
          } else if (anim === 'splitterFlap') {
            const baseRotY = (child.userData.baseRotY as number) ?? 0;
            child.rotation.y = baseRotY + Math.sin(elapsed * 2.2) * 0.04 + flashArc * 0.35;
          } else if (anim === 'sinkClamp') {
            const pIdx = (child.userData.pinIdx as number) ?? 0;
            child.rotation.z = isFlashing
              ? 0.28 * flashArc
              : Math.sin(elapsed * 3 + pIdx * 2.09) * 0.09;
          } else if (anim === 'halverWedge') {
            const holdLift = isWaitingExit ? 0.12 + Math.sin(elapsed * 5.2) * 0.025 : 0;
            child.position.y = 0.56 - stroke * 0.22 + holdLift + Math.sin(elapsed * 2.6) * 0.015;
          } else if (anim === 'swapperTurntable') {
            child.rotation.y =
              isFlashing && moveNorm < 1
                ? Math.PI * (1 - moveEase)
                : Math.sin(elapsed * 1.8) * 0.04;
          } else if (anim === 'jumperSpring') {
            child.scale.y = 1 + stroke * 0.52;
            child.position.y = 0.16 + stroke * 0.15;
          } else if (anim === 'scalesBeam') {
            const waitTilt = isWaitingExit ? 0.22 + Math.sin(elapsed * 4.6) * 0.035 : 0;
            child.rotation.x = Math.sin(elapsed * 2.4) * 0.08 + stroke * 0.28 + waitTilt;
          }

          if (
            anim === 'laserBeam' ||
            anim === 'weldArc' ||
            anim === 'weldSpark' ||
            anim === 'sqrtPylonGem' ||
            anim === 'adderGyro' ||
            anim === 'adderGyroOuter' ||
            anim === 'memoryOrb'
          ) {
            const mMesh = child as THREE.Mesh;
            const mat = mMesh.material as THREE.MeshToonMaterial | undefined;
            if (mMesh.isMesh && mat && typeof mat.emissiveIntensity === 'number') {
              if (child.userData.baseEmissive === undefined) {
                child.userData.baseEmissive = mat.emissiveIntensity;
              }
              const baseEm = child.userData.baseEmissive as number;
              mat.emissiveIntensity = baseEm + flashArc * 1.15;
            }
          }
        });
      }
}
