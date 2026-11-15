import assert from 'node:assert/strict';
import test from 'node:test';
import { hexKey } from '../engine/hex-math';
import type { AxialCoord, HexDir, HexKey, MachineInstance, MachineType } from '../engine/types';
import {
  BELT_HALF_WIDTH,
  HEX_APOTHEM,
  RAIL_INNER_OFFSET,
  computeConveyorGeometryData,
  computeConveyorTopology,
} from './conveyorTopology';

function mkMachine(
  id: string,
  type: MachineType,
  coord: AxialCoord,
  dir: HexDir,
): MachineInstance {
  return {
    id,
    type,
    coord,
    locked: false,
    config: { dir },
    state: {
      spawnIndex: 0,
      cooldown: 0,
      memory: null,
      activeFlashTicks: 0,
      lastActionTick: -1,
    },
  };
}

function addMachines(list: MachineInstance[]): Map<HexKey, MachineInstance> {
  const m = new Map<HexKey, MachineInstance>();
  for (const item of list) m.set(hexKey(item.coord), item);
  return m;
}

function pointToSegmentDist(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  const t = lenSq > 1e-9 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

test('spawner -> 60deg turn conveyor -> 60deg turn conveyor -> sink creates connected curved track', () => {
  // Spawner at (-2,0) facing East (0) -> Conveyor1 at (-1,0) facing SE (1) -> Conveyor2 at (-1,1) facing East (0) -> Sink at (0,1)
  const spawner = mkMachine('s1', 'spawner', { q: -2, r: 0 }, 0);
  const conv1 = mkMachine('c1', 'conveyor', { q: -1, r: 0 }, 1);
  const conv2 = mkMachine('c2', 'conveyor', { q: -1, r: 1 }, 0);
  const sink = mkMachine('k1', 'sink', { q: 0, r: 1 }, 3);
  const map = addMachines([spawner, conv1, conv2, sink]);

  const t1 = computeConveyorTopology(conv1, map);
  assert.equal(t1.kind, 'turn60');
  assert.equal(t1.hasInput, true);
  assert.equal(t1.hasOutput, true);
  assert.equal(t1.primaryInRelStep, 2);
  // Input enters from step 2 (+Z side), so motor moves to -Z (-1)
  assert.equal(t1.motorSideSign, -1);

  const g1 = computeConveyorGeometryData(t1);
  // Entry point meets West edge (step 2 = 120deg in local frame of dir=1) flush at HEX_APOTHEM
  assert.ok(Math.abs(Math.hypot(g1.curveP0.x, g1.curveP0.z) - HEX_APOTHEM) < 1e-4);
  assert.ok(Math.abs(g1.curveP2.x - HEX_APOTHEM) < 1e-4);
  assert.equal(g1.openDrums.length, 0);

  const t2 = computeConveyorTopology(conv2, map);
  assert.equal(t2.kind, 'turn60');
  assert.equal(t2.hasInput, true);
  assert.equal(t2.hasOutput, true);
  assert.equal(t2.primaryInRelStep, 4);
  // Input enters from step 4 (-Z side), so motor stays on +Z (+1)
  assert.equal(t2.motorSideSign, 1);
});

test('120-degree U-turn conveyor keeps all rails outside the curved belt centerline and free of folding', () => {
  // Spawner at (0,1) facing NW (4) -> Conveyor at (0,0) facing E (0)
  // From (0,0), neighbor (0,1) is in direction 1 (SE) -> relStep = 1 (120-degree turn!)
  for (const relStep of [1, 5] as const) {
    const inDir = relStep as HexDir;
    const feederDir = ((inDir + 3) % 6) as HexDir;
    const nbCoord =
      relStep === 1 ? { q: 0, r: 1 } : { q: 1, r: -1 };
    const feeder = mkMachine('f1', 'conveyor', nbCoord, feederDir);
    const conv = mkMachine('c1', 'conveyor', { q: 0, r: 0 }, 0);
    const out = mkMachine('o1', 'conveyor', { q: 1, r: 0 }, 0);
    const map = addMachines([feeder, conv, out]);

    const topo = computeConveyorTopology(conv, map);
    assert.equal(topo.kind, 'turn120');
    assert.equal(topo.primaryInRelStep, relStep);

    const geo = computeConveyorGeometryData(topo);
    assert.ok(geo.innerRollerPos !== null);
    assert.equal(geo.railPolygons.length, 2);

    // Sample curved centerline points to verify no rail ever intrudes onto the curved track
    const curvePts: Array<{ x: number; z: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const omt = 1 - t;
      curvePts.push({
        x:
          omt * omt * omt * geo.curveP0.x +
          3 * omt * omt * t * geo.curveC1.x +
          3 * omt * t * t * geo.curveC2.x +
          t * t * t * geo.curveP2.x,
        z:
          omt * omt * omt * geo.curveP0.z +
          3 * omt * omt * t * geo.curveC1.z +
          3 * omt * t * t * geo.curveC2.z +
          t * t * t * geo.curveP2.z,
      });
    }

    // Every rail vertex must stay clear of boundary mouths [0.78..HEX_APOTHEM] AND the curved belt centerline
    for (const poly of geo.railPolygons) {
      for (const v of poly) {
        const distToExitMouth = pointToSegmentDist(v.x, v.z, 0.78, 0, HEX_APOTHEM, 0);
        const ux = Math.cos((relStep * Math.PI) / 3);
        const uz = Math.sin((relStep * Math.PI) / 3);
        const distToEntryMouth = pointToSegmentDist(
          v.x,
          v.z,
          ux * 0.78,
          uz * 0.78,
          ux * HEX_APOTHEM,
          uz * HEX_APOTHEM,
        );
        assert.ok(
          distToExitMouth >= BELT_HALF_WIDTH + 0.02,
          `rail vertex (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) too close to exit mouth: ${distToExitMouth.toFixed(3)}`,
        );
        assert.ok(
          distToEntryMouth >= BELT_HALF_WIDTH + 0.02,
          `rail vertex (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) too close to entry mouth: ${distToEntryMouth.toFixed(3)}`,
        );

        let minCurveDist = Infinity;
        for (let i = 0; i < curvePts.length - 1; i++) {
          const d = pointToSegmentDist(
            v.x,
            v.z,
            curvePts[i].x,
            curvePts[i].z,
            curvePts[i + 1].x,
            curvePts[i + 1].z,
          );
          if (d < minCurveDist) minCurveDist = d;
        }
        assert.ok(
          minCurveDist >= BELT_HALF_WIDTH + 0.02,
          `rail vertex (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) intrudes onto curved centerline: ${minCurveDist.toFixed(3)}`,
        );
      }
    }
  }
});

test('multi-input merge conveyor opens all connected incoming and outgoing edges', () => {
  // Conveyor at (0,0) facing East (0), fed from West (-1,0)->0 and SE (0,1)->4 and NE (1,-1)->2
  const cLeft = mkMachine('cL', 'conveyor', { q: -1, r: 0 }, 0);
  const cSE = mkMachine('cSE', 'conveyor', { q: 0, r: 1 }, 4);
  const cMid = mkMachine('cM', 'conveyor', { q: 0, r: 0 }, 0);
  const cOut = mkMachine('cO', 'conveyor', { q: 1, r: 0 }, 0);
  const map = addMachines([cLeft, cSE, cMid, cOut]);

  const topo = computeConveyorTopology(cMid, map);
  assert.equal(topo.kind, 'merge');
  assert.deepEqual(topo.inRelSteps, [1, 3]);
  assert.equal(topo.hasOutput, true);

  const geo = computeConveyorGeometryData(topo);
  // 6 hex edges - 3 connected (0, 1, 3) = 3 unconnected edge guard rails
  assert.equal(geo.railPolygons.length, 3);
  assert.equal(geo.mergeArms.length, 3);

  // None of the guard rails may come within RAIL_INNER_OFFSET of the 3 connected edge midpoints
  for (const connectedStep of [0, 1, 3]) {
    const px = Math.cos((connectedStep * Math.PI) / 3) * HEX_APOTHEM;
    const pz = Math.sin((connectedStep * Math.PI) / 3) * HEX_APOTHEM;
    for (const poly of geo.railPolygons) {
      for (const v of poly) {
        const d = Math.hypot(v.x - px, v.z - pz);
        assert.ok(d > RAIL_INNER_OFFSET + 0.05);
      }
    }
  }
});
