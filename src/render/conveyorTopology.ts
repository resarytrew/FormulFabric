import {
  HEX_SIZE,
  hexKey,
  hexNeighbor,
  oppositeDir,
  rotateDir,
} from '../engine/hex-math';
import type { HexDir, HexKey, MachineInstance } from '../engine/types';

export const HEX_APOTHEM = (HEX_SIZE * Math.sqrt(3)) / 2; // ~0.90933
export const BELT_HALF_WIDTH = 0.34;
export const RAIL_INNER_OFFSET = 0.38;
export const RAIL_OUTER_OFFSET = 0.46;
export const OPEN_END_DIST = 0.58;

export interface Vec2 {
  x: number;
  z: number;
}

export type ConveyorShapeKind = 'straight' | 'turn60' | 'turn120' | 'merge';

export interface ConveyorTopology {
  outDir: HexDir;
  hasOutput: boolean;
  hasInput: boolean;
  inEdgeDirs: HexDir[];
  inRelSteps: number[];
  kind: ConveyorShapeKind;
  /** Relative step (1..5) of primary input edge when kind is straight/turn60/turn120 */
  primaryInRelStep: number;
  /** Side (+1 or -1) for drive motor & gears so they never intersect incoming/curved tracks */
  motorSideSign: 1 | -1;
}

export interface ConveyorGeometryData {
  beltOuter: Vec2[];
  beltInner: Vec2[];
  /** Polygon rings (each CCW-ready loop in XZ) for raised side rails */
  railPolygons: Vec2[][];
  /** Cubic Bezier control points in conveyor-local XZ for animated chevron cleats */
  curveP0: Vec2;
  curveC1: Vec2;
  curveC2: Vec2;
  curveP2: Vec2;
  /** Optional inner corner guide roller position (used on 120-degree U-turns) */
  innerRollerPos: Vec2 | null;
  /** Open (unconnected) end drum positions + yaw angles */
  openDrums: Array<{ x: number; z: number; yaw: number }>;
  /** Connected port relative steps (for merge hub belt arms) */
  mergeArms: Array<{ relStep: number; dist: number }>;
}

/**
 * Returns true if machine `src` physically feeds tokens outward along world direction `dir`.
 */
export function canMachineEmitToward(src: MachineInstance, dir: HexDir): boolean {
  switch (src.type) {
    case 'spawner':
    case 'conveyor':
    case 'add1':
    case 'sub1':
    case 'mul2':
    case 'div2':
    case 'sqrt':
    case 'neg':
    case 'adder':
      return src.config.dir === dir;
    case 'filter':
    case 'divmod':
    case 'dup':
    case 'splitter':
    case 'halver':
    case 'scales': {
      const altDir = src.config.altDir ?? rotateDir(src.config.dir, 1);
      return src.config.dir === dir || altDir === dir;
    }
    default:
      return false;
  }
}

/**
 * Returns true if machine `dst` accepts incoming belt flow across its `incomingEdgeDir` edge.
 */
export function canMachineAcceptFrom(
  dst: MachineInstance,
  incomingEdgeDir: HexDir,
): boolean {
  if (dst.type === 'spawner') return false;
  if (dst.type === 'sink' || dst.type === 'destroyer') return true;
  if (dst.type === 'conveyor') {
    // Conveyors accept from any edge except head-on backward out of their exit edge
    return dst.config.dir !== incomingEdgeDir;
  }
  if (
    dst.type === 'add1' ||
    dst.type === 'sub1' ||
    dst.type === 'mul2' ||
    dst.type === 'div2' ||
    dst.type === 'sqrt' ||
    dst.type === 'neg' ||
    dst.type === 'adder'
  ) {
    return dst.config.dir !== incomingEdgeDir;
  }
  if (
    dst.type === 'filter' ||
    dst.type === 'divmod' ||
    dst.type === 'dup' ||
    dst.type === 'splitter' ||
    dst.type === 'halver' ||
    dst.type === 'scales'
  ) {
    const altDir = dst.config.altDir ?? rotateDir(dst.config.dir, 1);
    return dst.config.dir !== incomingEdgeDir && altDir !== incomingEdgeDir;
  }
  if (dst.type === 'jumper') {
    return dst.config.dir !== incomingEdgeDir;
  }
  return false;
}

export function computeConveyorTopology(
  machine: MachineInstance,
  machines?: Map<HexKey, MachineInstance>,
): ConveyorTopology {
  const outDir = machine.config.dir;
  if (!machines) {
    return {
      outDir,
      hasOutput: false,
      hasInput: false,
      inEdgeDirs: [],
      inRelSteps: [],
      kind: 'straight',
      primaryInRelStep: 3,
      motorSideSign: 1,
    };
  }

  const outNeighbor = machines.get(hexKey(hexNeighbor(machine.coord, outDir)));
  const hasOutput = Boolean(
    outNeighbor && canMachineAcceptFrom(outNeighbor, oppositeDir(outDir)),
  );

  const inEdgeDirs: HexDir[] = [];
  const inRelSteps: number[] = [];
  for (let d = 0; d < 6; d++) {
    const edgeDir = d as HexDir;
    if (edgeDir === outDir) continue;
    const nb = machines.get(hexKey(hexNeighbor(machine.coord, edgeDir)));
    if (nb && canMachineEmitToward(nb, oppositeDir(edgeDir))) {
      inEdgeDirs.push(edgeDir);
      const rel = ((edgeDir - outDir) % 6 + 6) % 6;
      inRelSteps.push(rel);
    }
  }
  inRelSteps.sort((a, b) => a - b);

  const hasInput = inRelSteps.length > 0;

  if (inRelSteps.length >= 2) {
    // Pick a free side (+Z = steps 1,2 vs -Z = steps 4,5) for the drive motor
    const plusZBusy = inRelSteps.includes(1) || inRelSteps.includes(2);
    const minusZBusy = inRelSteps.includes(4) || inRelSteps.includes(5);
    const motorSideSign: 1 | -1 = plusZBusy && !minusZBusy ? -1 : 1;
    return {
      outDir,
      hasOutput,
      hasInput,
      inEdgeDirs,
      inRelSteps,
      kind: 'merge',
      primaryInRelStep: inRelSteps.includes(3) ? 3 : inRelSteps[0],
      motorSideSign,
    };
  }

  const primary = inRelSteps.length === 1 ? inRelSteps[0] : 3;
  let kind: ConveyorShapeKind = 'straight';
  if (primary === 2 || primary === 4) kind = 'turn60';
  else if (primary === 1 || primary === 5) kind = 'turn120';

  // Place drive motor on the outer side opposite the incoming side
  const motorSideSign: 1 | -1 = primary === 1 || primary === 2 ? -1 : 1;

  return {
    outDir,
    hasOutput,
    hasInput,
    inEdgeDirs,
    inRelSteps,
    kind,
    primaryInRelStep: primary,
    motorSideSign,
  };
}

export function evalCubic(p0: Vec2, c1: Vec2, c2: Vec2, p2: Vec2, t: number): Vec2 {
  const omt = 1 - t;
  const omt2 = omt * omt;
  const t2 = t * t;
  return {
    x: omt2 * omt * p0.x + 3 * omt2 * t * c1.x + 3 * omt * t2 * c2.x + t2 * t * p2.x,
    z: omt2 * omt * p0.z + 3 * omt2 * t * c1.z + 3 * omt * t2 * c2.z + t2 * t * p2.z,
  };
}

export function evalCubicTangent(p0: Vec2, c1: Vec2, c2: Vec2, p2: Vec2, t: number): Vec2 {
  const omt = 1 - t;
  const tx =
    3 * omt * omt * (c1.x - p0.x) +
    6 * omt * t * (c2.x - c1.x) +
    3 * t * t * (p2.x - c2.x);
  const tz =
    3 * omt * omt * (c1.z - p0.z) +
    6 * omt * t * (c2.z - c1.z) +
    3 * t * t * (p2.z - c2.z);
  const len = Math.hypot(tx, tz) || 1;
  return { x: tx / len, z: tz / len };
}

function perpRight(v: Vec2): Vec2 {
  // In XZ top-down (+X right, +Z down), right-hand perpendicular to (vx, vz) is (-vz, vx)
  return { x: -v.z, z: v.x };
}

function dirVec(relStep: number): Vec2 {
  const ang = relStep * (Math.PI / 3);
  return { x: Math.cos(ang), z: Math.sin(ang) };
}

/**
 * Generates exact 2D XZ belt & rail profiles for any straight, curved (60/120 deg),
 * or multi-input merging conveyor in local machine coordinates (+X = outDir).
 */
export function computeConveyorGeometryData(
  topo: ConveyorTopology,
  segments = 20,
): ConveyorGeometryData {
  const outDist = topo.hasOutput ? HEX_APOTHEM : OPEN_END_DIST;
  const inDist = topo.hasInput ? HEX_APOTHEM : OPEN_END_DIST;

  if (topo.kind === 'straight') {
    const p0: Vec2 = { x: -inDist, z: 0 };
    const p2: Vec2 = { x: outDist, z: 0 };
    const c1: Vec2 = { x: p0.x + (p2.x - p0.x) / 3, z: 0 };
    const c2: Vec2 = { x: p0.x + ((p2.x - p0.x) * 2) / 3, z: 0 };

    const beltOuter: Vec2[] = [
      { x: -inDist, z: -BELT_HALF_WIDTH },
      { x: outDist, z: -BELT_HALF_WIDTH },
    ];
    const beltInner: Vec2[] = [
      { x: -inDist, z: BELT_HALF_WIDTH },
      { x: outDist, z: BELT_HALF_WIDTH },
    ];

    const railExtendIn = topo.hasInput ? HEX_APOTHEM : OPEN_END_DIST + 0.08;
    const railExtendOut = topo.hasOutput ? HEX_APOTHEM : OPEN_END_DIST + 0.08;

    const railLeft: Vec2[] = [
      { x: -railExtendIn, z: -RAIL_OUTER_OFFSET },
      { x: railExtendOut, z: -RAIL_OUTER_OFFSET },
      { x: railExtendOut, z: -RAIL_INNER_OFFSET },
      { x: -railExtendIn, z: -RAIL_INNER_OFFSET },
    ];
    const railRight: Vec2[] = [
      { x: -railExtendIn, z: RAIL_INNER_OFFSET },
      { x: railExtendOut, z: RAIL_INNER_OFFSET },
      { x: railExtendOut, z: RAIL_OUTER_OFFSET },
      { x: -railExtendIn, z: RAIL_OUTER_OFFSET },
    ];

    const openDrums: Array<{ x: number; z: number; yaw: number }> = [];
    if (!topo.hasInput) openDrums.push({ x: -OPEN_END_DIST, z: 0, yaw: Math.PI });
    if (!topo.hasOutput) openDrums.push({ x: OPEN_END_DIST, z: 0, yaw: 0 });

    return {
      beltOuter,
      beltInner,
      railPolygons: [railLeft, railRight],
      curveP0: p0,
      curveC1: c1,
      curveC2: c2,
      curveP2: p2,
      innerRollerPos: null,
      openDrums,
      mergeArms: [],
    };
  }

  if (topo.kind === 'turn60') {
    const uIn = dirVec(topo.primaryInRelStep);
    const handle = HEX_APOTHEM * 0.58;
    const p0: Vec2 = { x: uIn.x * HEX_APOTHEM, z: uIn.z * HEX_APOTHEM };
    const c1: Vec2 = { x: p0.x - uIn.x * handle, z: p0.z - uIn.z * handle };
    const p2: Vec2 = { x: outDist, z: 0 };
    const c2: Vec2 = { x: p2.x - handle * (outDist / HEX_APOTHEM), z: 0 };

    const beltRight: Vec2[] = [];
    const beltLeft: Vec2[] = [];
    const railRightOuter: Vec2[] = [];
    const railRightInner: Vec2[] = [];
    const railLeftOuter: Vec2[] = [];
    const railLeftInner: Vec2[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const c = evalCubic(p0, c1, c2, p2, t);
      const tan = evalCubicTangent(p0, c1, c2, p2, t);
      const n = perpRight(tan);
      const rShift = !topo.hasOutput && t > 0.999 ? 0.04 : 0;

      beltRight.push({ x: c.x + n.x * BELT_HALF_WIDTH, z: c.z + n.z * BELT_HALF_WIDTH });
      beltLeft.push({ x: c.x - n.x * BELT_HALF_WIDTH, z: c.z - n.z * BELT_HALF_WIDTH });

      railRightOuter.push({
        x: c.x + tan.x * rShift + n.x * RAIL_OUTER_OFFSET,
        z: c.z + tan.z * rShift + n.z * RAIL_OUTER_OFFSET,
      });
      railRightInner.push({
        x: c.x + tan.x * rShift + n.x * RAIL_INNER_OFFSET,
        z: c.z + tan.z * rShift + n.z * RAIL_INNER_OFFSET,
      });
      railLeftOuter.push({
        x: c.x + tan.x * rShift - n.x * RAIL_OUTER_OFFSET,
        z: c.z + tan.z * rShift - n.z * RAIL_OUTER_OFFSET,
      });
      railLeftInner.push({
        x: c.x + tan.x * rShift - n.x * RAIL_INNER_OFFSET,
        z: c.z + tan.z * rShift - n.z * RAIL_INNER_OFFSET,
      });
    }

    const railRight = [...railRightOuter, ...railRightInner.slice().reverse()];
    const railLeft = [...railLeftInner, ...railLeftOuter.slice().reverse()];

    const openDrums: Array<{ x: number; z: number; yaw: number }> = [];
    if (!topo.hasOutput) openDrums.push({ x: OPEN_END_DIST, z: 0, yaw: 0 });

    return {
      beltOuter: beltLeft,
      beltInner: beltRight,
      railPolygons: [railRight, railLeft],
      curveP0: p0,
      curveC1: c1,
      curveC2: c2,
      curveP2: p2,
      innerRollerPos: null,
      openDrums,
      mergeArms: [],
    };
  }

  if (topo.kind === 'turn120') {
    const uIn = dirVec(topo.primaryInRelStep);
    const localOutDist = topo.hasOutput ? HEX_APOTHEM : 0.76;
    const handle = topo.hasOutput ? 0.404 : 0.36;
    const p0: Vec2 = { x: uIn.x * HEX_APOTHEM, z: uIn.z * HEX_APOTHEM };
    const c1: Vec2 = { x: p0.x - uIn.x * handle, z: p0.z - uIn.z * handle };
    const p2: Vec2 = { x: localOutDist, z: 0 };
    const c2: Vec2 = { x: p2.x - handle, z: 0 };

    const innerSign = topo.primaryInRelStep === 1 ? 1 : -1;
    const outerSign = -innerSign;

    const uOut: Vec2 = { x: 1, z: 0 };
    const bx = uIn.x + uOut.x;
    const bz = uIn.z + uOut.z;
    const bLen = Math.hypot(bx, bz) || 1;
    const bisector: Vec2 = { x: bx / bLen, z: bz / bLen };

    const outerBeltPts: Vec2[] = [];
    const innerBeltPts: Vec2[] = [];
    const outerRailOuterPts: Vec2[] = [];
    const outerRailInnerPts: Vec2[] = [];
    const innerRailInnerPts: Vec2[] = [];
    const innerRailOuterPts: Vec2[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const c = evalCubic(p0, c1, c2, p2, t);
      const tan = evalCubicTangent(p0, c1, c2, p2, t);
      const n = perpRight(tan);
      const rShift = !topo.hasOutput && t > 0.999 ? 0.04 : 0;

      outerBeltPts.push({
        x: c.x + outerSign * n.x * BELT_HALF_WIDTH,
        z: c.z + outerSign * n.z * BELT_HALF_WIDTH,
      });
      innerBeltPts.push({
        x: c.x + innerSign * n.x * BELT_HALF_WIDTH,
        z: c.z + innerSign * n.z * BELT_HALF_WIDTH,
      });

      outerRailOuterPts.push({
        x: c.x + tan.x * rShift + outerSign * n.x * RAIL_OUTER_OFFSET,
        z: c.z + tan.z * rShift + outerSign * n.z * RAIL_OUTER_OFFSET,
      });
      outerRailInnerPts.push({
        x: c.x + tan.x * rShift + outerSign * n.x * RAIL_INNER_OFFSET,
        z: c.z + tan.z * rShift + outerSign * n.z * RAIL_INNER_OFFSET,
      });

      innerRailInnerPts.push({
        x: c.x + tan.x * rShift + innerSign * n.x * RAIL_INNER_OFFSET,
        z: c.z + tan.z * rShift + innerSign * n.z * RAIL_INNER_OFFSET,
      });
      innerRailOuterPts.push({
        x: c.x + tan.x * rShift + innerSign * n.x * RAIL_OUTER_OFFSET,
        z: c.z + tan.z * rShift + innerSign * n.z * RAIL_OUTER_OFFSET,
      });
    }

    const outerRail = [...outerRailOuterPts, ...outerRailInnerPts.slice().reverse()];
    const innerRail = [...innerRailInnerPts, ...innerRailOuterPts.slice().reverse()];

    const openDrums: Array<{ x: number; z: number; yaw: number }> = [];
    if (!topo.hasOutput) openDrums.push({ x: localOutDist, z: 0, yaw: 0 });

    return {
      beltOuter: outerBeltPts,
      beltInner: innerBeltPts,
      railPolygons: [outerRail, innerRail],
      curveP0: p0,
      curveC1: c1,
      curveC2: c2,
      curveP2: p2,
      innerRollerPos: { x: bisector.x * 0.94, z: bisector.z * 0.94 },
      openDrums,
      mergeArms: [],
    };
  }

  // Merge junction (2+ inputs): central hub + flush arms for every connected port, guard rails only on unconnected hex edges
  const connected = new Set<number>([0, ...topo.inRelSteps]);
  const mergeArms: Array<{ relStep: number; dist: number }> = [
    { relStep: 0, dist: topo.hasOutput ? HEX_APOTHEM : OPEN_END_DIST },
    ...topo.inRelSteps.map((s) => ({ relStep: s, dist: HEX_APOTHEM })),
  ];

  const railPolygons: Vec2[][] = [];
  for (let edge = 0; edge < 6; edge++) {
    if (connected.has(edge)) continue;
    const u = dirVec(edge);
    const tangent = perpRight(u);
    const halfEdge = 0.43;
    const rIn = HEX_APOTHEM - 0.13;
    const rOut = HEX_APOTHEM - 0.045;
    railPolygons.push([
      { x: u.x * rOut - tangent.x * halfEdge, z: u.z * rOut - tangent.z * halfEdge },
      { x: u.x * rOut + tangent.x * halfEdge, z: u.z * rOut + tangent.z * halfEdge },
      { x: u.x * rIn + tangent.x * halfEdge, z: u.z * rIn + tangent.z * halfEdge },
      { x: u.x * rIn - tangent.x * halfEdge, z: u.z * rIn - tangent.z * halfEdge },
    ]);
  }

  const openDrums: Array<{ x: number; z: number; yaw: number }> = [];
  if (!topo.hasOutput) openDrums.push({ x: OPEN_END_DIST, z: 0, yaw: 0 });

  return {
    beltOuter: [],
    beltInner: [],
    railPolygons,
    curveP0: { x: -0.35, z: 0 },
    curveC1: { x: -0.1, z: 0 },
    curveC2: { x: 0.25, z: 0 },
    curveP2: { x: outDist, z: 0 },
    innerRollerPos: null,
    openDrums,
    mergeArms,
  };
}
