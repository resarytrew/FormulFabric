import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HEX_SIZE } from '../engine/hex-math';
import {
  createCelMaterial,
  createRiverWaterMaterial,
  getSoftContactShadowTexture,
  type ThemePalette,
} from './celMaterials';

const _composeMat = new THREE.Matrix4();
const _composePos = new THREE.Vector3();
const _composeQuat = new THREE.Quaternion();
const _composeEuler = new THREE.Euler();
const _composeScale = new THREE.Vector3();

function hash2d(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Normalizes and bakes a transform into a BufferGeometry so it can be merged cleanly
 * without material or attribute mismatches.
 */
function bakePart(
  source: THREE.BufferGeometry,
  transform?: {
    x?: number;
    y?: number;
    z?: number;
    rx?: number;
    ry?: number;
    rz?: number;
    sx?: number;
    sy?: number;
    sz?: number;
  },
  keepColor = false,
): THREE.BufferGeometry {
  const nonIndexed = source.index ? source.toNonIndexed() : source.clone();
  if (transform) {
    _composePos.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
    _composeEuler.set(transform.rx ?? 0, transform.ry ?? 0, transform.rz ?? 0);
    _composeQuat.setFromEuler(_composeEuler);
    _composeScale.set(transform.sx ?? 1, transform.sy ?? 1, transform.sz ?? 1);
    _composeMat.compose(_composePos, _composeQuat, _composeScale);
    nonIndexed.applyMatrix4(_composeMat);
  }
  nonIndexed.deleteAttribute('uv');
  nonIndexed.deleteAttribute('uv1');
  nonIndexed.deleteAttribute('tangent');
  if (!keepColor) {
    nonIndexed.deleteAttribute('color');
  }
  if (!nonIndexed.getAttribute('normal')) {
    nonIndexed.computeVertexNormals();
  }
  return nonIndexed;
}

function mergeBakedParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) {
    return new THREE.BufferGeometry();
  }
  if (parts.length === 1) {
    parts[0].computeBoundingSphere();
    return parts[0];
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) {
    return new THREE.BufferGeometry();
  }
  merged.computeBoundingSphere();
  return merged;
}

function createOctagonShape(radius: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function createHexShape(radius: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

/**
 * Organic faceted boulder geometry with flattened bottom seat and asymmetric rock planes.
 */
function createBoulderGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(radius, 1);
  const geo = base.index ? base.toNonIndexed() : base.clone();
  base.dispose();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n = hash2d(Math.round(vx * 100), Math.round(vz * 100 + vy * 37), seed);
    const radialScale = 0.78 + n * 0.42;
    const nx = vx * radialScale * 1.15;
    const nz = vz * radialScale * 0.96;
    let ny = vy * (0.72 + n * 0.25);
    if (ny < -radius * 0.28) ny = -radius * 0.28;
    pos.setXYZ(i, nx, ny + radius * 0.24, nz);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Multi-tier scalloped alpine pine foliage built via LatheGeometry so evergreen trees
 * read as layered bough clusters instead of smooth primitive cones.
 */
function createLayeredPineCrownGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.01, 0.46),
    new THREE.Vector2(0.58, 0.48),
    new THREE.Vector2(0.28, 0.88),
    new THREE.Vector2(0.48, 0.92),
    new THREE.Vector2(0.22, 1.32),
    new THREE.Vector2(0.36, 1.35),
    new THREE.Vector2(0.01, 1.88),
  ];
  const lathe = new THREE.LatheGeometry(pts, 10);
  const geo = lathe.index ? lathe.toNonIndexed() : lathe.clone();
  lathe.dispose();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.08) {
      const ang = Math.atan2(z, x);
      const lobe = 1 + Math.sin(ang * 5 + y * 2.1) * 0.12;
      pos.setX(i, x * lobe);
      pos.setZ(i, z * lobe);
    }
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Broadleaf valley oak trunk with forked main limbs.
 */
function createOakTrunkGeometry(): THREE.BufferGeometry {
  const main = new THREE.CylinderGeometry(0.07, 0.14, 0.72, 7);
  const limbA = new THREE.CylinderGeometry(0.04, 0.068, 0.42, 6);
  const limbB = new THREE.CylinderGeometry(0.036, 0.06, 0.38, 6);
  const rootFlair = new THREE.CylinderGeometry(0.12, 0.2, 0.16, 7);

  const merged = mergeBakedParts([
    bakePart(rootFlair, { y: 0.08 }),
    bakePart(main, { y: 0.38 }),
    bakePart(limbA, { x: 0.13, y: 0.74, rz: -0.58 }),
    bakePart(limbB, { x: -0.12, y: 0.7, z: 0.06, rz: 0.52, rx: 0.24 }),
  ]);
  main.dispose();
  limbA.dispose();
  limbB.dispose();
  rootFlair.dispose();
  return merged;
}

/**
 * Broadleaf valley oak multi-lobe organic crown cluster.
 */
function createOakCrownGeometry(): THREE.BufferGeometry {
  const lobes: Array<[number, number, number, number, number, number]> = [
    [0, 1.05, 0, 0.44, 0.86, 1.08],
    [0.24, 0.96, 0.08, 0.34, 0.82, 1.04],
    [-0.22, 0.94, 0.12, 0.32, 0.84, 1.02],
    [0.02, 1.24, -0.1, 0.3, 0.82, 1.0],
  ];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < lobes.length; i++) {
    const [lx, ly, lz, r, sy, sx] = lobes[i];
    const puff = new THREE.IcosahedronGeometry(r, 1);
    parts.push(bakePart(puff, { x: lx, y: ly, z: lz, sx, sy, sz: sx }));
    puff.dispose();
  }
  const merged = mergeBakedParts(parts);
  merged.computeVertexNormals();
  return merged;
}

/**
 * Sculpted stratified canyon cliff plateau with stepped rock strata and vertex color shading.
 */
function createMesaRockGeometry(
  rx: number,
  rz: number,
  height: number,
  rot: number,
  seed: number,
  topCol: THREE.Color,
  sideCol: THREE.Color,
  baseCol: THREE.Color,
): THREE.BufferGeometry {
  const segTheta = 16;
  const rings = [
    { y: 0, rMult: 1.14, col: baseCol },
    { y: height * 0.32, rMult: 1.02, col: sideCol },
    { y: height * 0.68, rMult: 0.95, col: sideCol },
    { y: height, rMult: 0.88, col: topCol },
  ];

  const positions: number[] = [];
  const colors: number[] = [];
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const ringVerts: Array<Array<{ x: number; y: number; z: number; c: THREE.Color }>> = [];

  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    const row: Array<{ x: number; y: number; z: number; c: THREE.Color }> = [];
    for (let ti = 0; ti < segTheta; ti++) {
      const a = (ti / segTheta) * Math.PI * 2;
      const n1 = hash2d(ti, seed, 11);
      const n2 = hash2d(ti, ri, seed + 5);
      const crag = 0.86 + n1 * 0.24 + (ri === 1 ? 0.05 : 0) - (n2 > 0.72 ? 0.08 : 0);
      const lx = Math.cos(a) * rx * ring.rMult * crag;
      const lz = Math.sin(a) * rz * ring.rMult * crag;
      const wx = lx * cosR + lz * sinR;
      const wz = -lx * sinR + lz * cosR;
      const wy = ring.y + (ri > 0 && ri < rings.length - 1 ? (n2 - 0.5) * 0.26 : 0);
      const shade = 0.9 + n2 * 0.16;
      row.push({
        x: wx,
        y: wy,
        z: wz,
        c: ring.col.clone().multiplyScalar(shade),
      });
    }
    ringVerts.push(row);
  }

  const pushTri = (
    p0: { x: number; y: number; z: number; c: THREE.Color },
    p1: { x: number; y: number; z: number; c: THREE.Color },
    p2: { x: number; y: number; z: number; c: THREE.Color },
  ) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    colors.push(
      p0.c.r,
      p0.c.g,
      p0.c.b,
      p1.c.r,
      p1.c.g,
      p1.c.b,
      p2.c.r,
      p2.c.g,
      p2.c.b,
    );
  };

  for (let ri = 0; ri < ringVerts.length - 1; ri++) {
    const rA = ringVerts[ri];
    const rB = ringVerts[ri + 1];
    for (let ti = 0; ti < segTheta; ti++) {
      const next = (ti + 1) % segTheta;
      pushTri(rA[ti], rB[ti], rA[next]);
      pushTri(rA[next], rB[ti], rB[next]);
    }
  }

  // Cap plateau top in case no grass turf sits on it
  const topRing = ringVerts[ringVerts.length - 1];
  const center = { x: 0, y: height, z: 0, c: topCol.clone() };
  for (let ti = 0; ti < segTheta; ti++) {
    const next = (ti + 1) % segTheta;
    pushTri(center, topRing[next], topRing[ti]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Cushioned, beveled meadow cap matching the sculpted cliff footprint.
 */
function createMesaTurfGeometry(
  rx: number,
  rz: number,
  yBase: number,
  rot: number,
  seed: number,
  grassCol: THREE.Color,
): THREE.BufferGeometry {
  const segTheta = 16;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const positions: number[] = [];
  const colors: number[] = [];

  const bottomRing: Array<{ x: number; y: number; z: number; c: THREE.Color }> = [];
  const topRing: Array<{ x: number; y: number; z: number; c: THREE.Color }> = [];

  for (let ti = 0; ti < segTheta; ti++) {
    const a = (ti / segTheta) * Math.PI * 2;
    const n1 = hash2d(ti, seed, 11);
    const n2 = hash2d(ti, seed, 29);
    const crag = 0.86 + n1 * 0.24 - (n2 > 0.72 ? 0.08 : 0);
    const bx = Math.cos(a) * rx * 0.9 * crag;
    const bz = Math.sin(a) * rz * 0.9 * crag;
    const tx = Math.cos(a) * rx * 0.83 * crag;
    const tz = Math.sin(a) * rz * 0.83 * crag;

    bottomRing.push({
      x: bx * cosR + bz * sinR,
      y: yBase - 0.04,
      z: -bx * sinR + bz * cosR,
      c: grassCol.clone().multiplyScalar(0.84),
    });
    topRing.push({
      x: tx * cosR + tz * sinR,
      y: yBase + 0.3 + n2 * 0.08,
      z: -tx * sinR + tz * cosR,
      c: grassCol.clone().multiplyScalar(0.96 + n2 * 0.14),
    });
  }

  const center = {
    x: 0,
    y: yBase + 0.44,
    z: 0,
    c: grassCol.clone().multiplyScalar(1.12),
  };

  const pushTri = (
    p0: { x: number; y: number; z: number; c: THREE.Color },
    p1: { x: number; y: number; z: number; c: THREE.Color },
    p2: { x: number; y: number; z: number; c: THREE.Color },
  ) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    colors.push(
      p0.c.r,
      p0.c.g,
      p0.c.b,
      p1.c.r,
      p1.c.g,
      p1.c.b,
      p2.c.r,
      p2.c.g,
      p2.c.b,
    );
  };

  for (let ti = 0; ti < segTheta; ti++) {
    const next = (ti + 1) % segTheta;
    pushTri(bottomRing[ti], topRing[ti], bottomRing[next]);
    pushTri(bottomRing[next], topRing[ti], topRing[next]);
    pushTri(center, topRing[next], topRing[ti]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-ridge chiseled alpine mountain massif with sunlit summit vertex coloring
 * (replaces primitive horizon ConeGeometry pyramids).
 */
function createAlpineRidgeGeometry(
  rx: number,
  height: number,
  rot: number,
  seed: number,
  baseColor: THREE.Color,
  midColor: THREE.Color,
  crestColor: THREE.Color,
): THREE.BufferGeometry {
  const segTheta = 16;
  const segRing = 5;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const rz = rx * 0.78;

  const grid: Array<Array<{ x: number; y: number; z: number; c: THREE.Color }>> = [];

  for (let ri = 1; ri <= segRing; ri++) {
    const t = ri / segRing; // 0 near peak, 1 at skirt
    const ring: Array<{ x: number; y: number; z: number; c: THREE.Color }> = [];
    for (let ti = 0; ti < segTheta; ti++) {
      const a = (ti / segTheta) * Math.PI * 2;
      const ridgeWave =
        0.5 +
        0.5 * Math.cos(a * 3 + seed * 1.7) * 0.65 +
        0.25 * Math.sin(a * 5 - seed * 0.9);
      const n = hash2d(ti, ri, seed);
      const radialSpread = t * (0.82 + (1 - ridgeWave) * 0.36 + n * 0.12);
      const lx = Math.cos(a) * rx * radialSpread + Math.sin(seed) * (1 - t) * rx * 0.08;
      const lz = Math.sin(a) * rz * radialSpread;

      // Secondary shoulder bump along ridge line
      const shoulder = t > 0.25 && t < 0.72 ? Math.max(0, Math.cos(a * 2 + seed)) * height * 0.14 : 0;
      const yProfile = Math.pow(1 - t, 1.18) * height + ridgeWave * (1 - t) * height * 0.12 + shoulder;
      const vy = yProfile + (n - 0.5) * height * 0.06 * t;

      const heightNorm = THREE.MathUtils.clamp(vy / height, 0, 1);
      const col = new THREE.Color();
      if (heightNorm < 0.45) {
        col.copy(baseColor).lerp(midColor, heightNorm / 0.45);
      } else {
        col.copy(midColor).lerp(crestColor, (heightNorm - 0.45) / 0.55);
      }
      col.multiplyScalar(0.92 + n * 0.14);

      ring.push({
        x: lx * cosR + lz * sinR,
        y: vy,
        z: -lx * sinR + lz * cosR,
        c: col,
      });
    }
    grid.push(ring);
  }

  const apexCol = crestColor.clone().multiplyScalar(1.08);
  const apex = {
    x: Math.sin(seed) * rx * 0.08 * cosR,
    y: height * 1.02,
    z: -Math.sin(seed) * rx * 0.08 * sinR,
    c: apexCol,
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (
    p0: { x: number; y: number; z: number; c: THREE.Color },
    p1: { x: number; y: number; z: number; c: THREE.Color },
    p2: { x: number; y: number; z: number; c: THREE.Color },
  ) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    colors.push(
      p0.c.r,
      p0.c.g,
      p0.c.b,
      p1.c.r,
      p1.c.g,
      p1.c.b,
      p2.c.r,
      p2.c.g,
      p2.c.b,
    );
  };

  const firstRing = grid[0];
  for (let ti = 0; ti < segTheta; ti++) {
    const next = (ti + 1) % segTheta;
    pushTri(apex, firstRing[next], firstRing[ti]);
  }
  for (let ri = 0; ri < grid.length - 1; ri++) {
    const rA = grid[ri];
    const rB = grid[ri + 1];
    for (let ti = 0; ti < segTheta; ti++) {
      const next = (ti + 1) % segTheta;
      pushTri(rA[ti], rA[next], rB[ti]);
      pushTri(rA[next], rB[next], rB[ti]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted craggy rock keel geometry for floating islands & mini-islands
 * (replaces inverted 6-sided ConeGeometry).
 */
function createFloatingCragKeelGeometry(
  topRadius: number,
  depth: number,
  segments: number,
  seed: number,
  topCol: THREE.Color,
  midCol: THREE.Color,
  deepCol: THREE.Color,
): THREE.BufferGeometry {
  const tiers = [
    { y: 0, r: topRadius, col: topCol },
    { y: -depth * 0.24, r: topRadius * 0.91, col: topCol },
    { y: -depth * 0.56, r: topRadius * 0.64, col: midCol },
    { y: -depth * 0.84, r: topRadius * 0.32, col: deepCol },
  ];

  const rings: Array<Array<{ x: number; y: number; z: number; c: THREE.Color }>> = [];
  for (let ri = 0; ri < tiers.length; ri++) {
    const tier = tiers[ri];
    const row: Array<{ x: number; y: number; z: number; c: THREE.Color }> = [];
    for (let si = 0; si < segments; si++) {
      const a = (si / segments) * Math.PI * 2 + (ri % 2) * 0.08;
      const n = hash2d(si, ri, seed);
      const ridge = 0.84 + n * 0.28 + (si % 2 === 0 ? 0.06 : -0.04);
      row.push({
        x: Math.cos(a) * tier.r * ridge,
        y: tier.y + (ri > 0 ? (n - 0.5) * depth * 0.08 : 0),
        z: Math.sin(a) * tier.r * ridge,
        c: tier.col.clone().multiplyScalar(0.9 + n * 0.16),
      });
    }
    rings.push(row);
  }

  const tip = {
    x: (hash2d(1, 2, seed) - 0.5) * topRadius * 0.14,
    y: -depth,
    z: (hash2d(3, 4, seed) - 0.5) * topRadius * 0.14,
    c: deepCol.clone().multiplyScalar(0.84),
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (
    p0: { x: number; y: number; z: number; c: THREE.Color },
    p1: { x: number; y: number; z: number; c: THREE.Color },
    p2: { x: number; y: number; z: number; c: THREE.Color },
  ) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    colors.push(
      p0.c.r,
      p0.c.g,
      p0.c.b,
      p1.c.r,
      p1.c.g,
      p1.c.b,
      p2.c.r,
      p2.c.g,
      p2.c.b,
    );
  };

  for (let ri = 0; ri < rings.length - 1; ri++) {
    const rA = rings[ri];
    const rB = rings[ri + 1];
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments;
      pushTri(rA[si], rA[next], rB[si]);
      pushTri(rA[next], rB[next], rB[si]);
    }
  }
  const lastRing = rings[rings.length - 1];
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    pushTri(lastRing[si], lastRing[next], tip);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-tiered sculpted floating island foundation with craggy bedrock spurs,
 * steel girder suspension truss, spinning magnetic stabilizer core, and hanging cables.
 */
export function buildIslandUnderbellyAndCables(
  maxRadius: number,
  palette: ThemePalette,
  hasChasm = false,
): THREE.Group {
  const group = new THREE.Group();

  const rockMat = createCelMaterial(0xffffff, { roughness: 0.88, metalness: 0.04 });
  rockMat.vertexColors = true;
  const steelMat = createCelMaterial(palette.machineBase, { roughness: 0.48, metalness: 0.45 });
  const trimSteelMat = createCelMaterial(palette.machineTop, { roughness: 0.38, metalness: 0.55 });
  const cableMat = createCelMaterial(palette.ink, { roughness: 0.52, metalness: 0.35 });
  const amberGlowMat = createCelMaterial(palette.accent, {
    emissive: palette.accent,
    emissiveIntensity: 0.55,
    roughness: 0.28,
  });
  const cyanGlowMat = createCelMaterial(palette.accentSecondary, {
    emissive: palette.accentSecondary,
    emissiveIntensity: 0.82,
    roughness: 0.22,
  });

  const mainRadius = Math.max(3.8, (maxRadius + 1.05) * HEX_SIZE * 1.5);
  const topCol = new THREE.Color(palette.cliffTop);
  const midCol = new THREE.Color(palette.cliffSide);
  const deepCol = new THREE.Color(palette.machineBase);

  const rockParts: THREE.BufferGeometry[] = [];

  if (!hasChasm) {
    // Upper sculpted rock shelf hugging the hex deck
    const upperShelf = createFloatingCragKeelGeometry(
      mainRadius * 0.94,
      1.95,
      12,
      7,
      topCol,
      midCol,
      midCol,
    );
    upperShelf.translate(0, -0.34, 0);
    rockParts.push(bakePart(upperShelf, undefined, true));
    upperShelf.dispose();
  }

  // Deep central crag keel
  const keelDepth = hasChasm ? 4.3 : 4.75;
  const keel = createFloatingCragKeelGeometry(
    mainRadius * (hasChasm ? 0.58 : 0.72),
    keelDepth,
    12,
    23,
    hasChasm ? midCol : topCol,
    midCol,
    deepCol,
  );
  keel.translate(0, hasChasm ? -1.45 : -0.82, 0);
  rockParts.push(bakePart(keel, undefined, true));
  keel.dispose();

  // 5 sculpted jagged hanging rock spurs around the underbelly
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 + 0.38;
    const dist = mainRadius * (0.48 + (i % 2) * 0.12);
    const spurDepth = 2.1 + (i % 3) * 0.75;
    const spur = createFloatingCragKeelGeometry(
      0.78 + (i % 2) * 0.22,
      spurDepth,
      8,
      40 + i,
      midCol,
      midCol,
      deepCol,
    );
    rockParts.push(
      bakePart(
        spur,
        {
          x: Math.cos(a) * dist,
          y: hasChasm ? -1.3 : -0.78,
          z: Math.sin(a) * dist,
          ry: a,
        },
        true,
      ),
    );
    spur.dispose();
  }

  const rockMesh = new THREE.Mesh(mergeBakedParts(rockParts), rockMat);
  group.add(rockMesh);

  // Under-deck steel girder ring + diagonal suspension bracing struts
  const steelParts: THREE.BufferGeometry[] = [];
  const ringR = mainRadius * (hasChasm ? 0.62 : 0.72);
  const ringY = hasChasm ? -1.4 : -0.92;
  const girderRing = new THREE.TorusGeometry(ringR, 0.08, 6, 18);
  steelParts.push(bakePart(girderRing, { y: ringY, rx: Math.PI / 2 }));
  girderRing.dispose();

  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const strutCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR),
      new THREE.Vector3(Math.cos(a) * ringR * 0.45, ringY - 0.95, Math.sin(a) * ringR * 0.45),
      new THREE.Vector3(0, ringY - 1.65, 0),
    ]);
    const strutGeo = new THREE.TubeGeometry(strutCurve, 8, 0.055, 6, false);
    steelParts.push(bakePart(strutGeo));
    strutGeo.dispose();
  }
  const trussMesh = new THREE.Mesh(mergeBakedParts(steelParts), steelMat);
  group.add(trussMesh);

  // Central magnetic stabilizer gimbal & spinning luminous core beneath the keel
  const coreY = hasChasm ? -3.05 : -2.55;
  const gimbal = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 8, 18), trimSteelMat);
  gimbal.position.y = coreY;
  gimbal.rotation.x = 0.45;
  group.add(gimbal);

  const coreGroup = new THREE.Group();
  coreGroup.position.y = coreY;
  coreGroup.userData.sceneryAnim = 'spinY';
  coreGroup.userData.spinSpeed = 1.25;
  const coreOct = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), cyanGlowMat);
  coreOct.scale.set(0.85, 1.35, 0.85);
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.038, 6, 16), trimSteelMat);
  coreRing.rotation.x = Math.PI / 2;
  coreGroup.add(coreOct, coreRing);
  group.add(coreGroup);

  // 4 hanging catenary cables & glowing survey weights
  const cableParts: THREE.BufferGeometry[] = [];
  const weightParts: THREE.BufferGeometry[] = [];
  const weightCapParts: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 4; c++) {
    const a0 = c * 1.57 + 0.45;
    const a1 = a0 + 0.56;
    const r = mainRadius * 0.84;
    const p0 = new THREE.Vector3(Math.cos(a0) * r, -0.72, Math.sin(a0) * r);
    const pMid = new THREE.Vector3(
      Math.cos((a0 + a1) * 0.5) * (r + 0.42),
      -2.35 - (c % 2) * 0.55,
      Math.sin((a0 + a1) * 0.5) * (r + 0.42),
    );
    const p1 = new THREE.Vector3(Math.cos(a1) * (r * 0.68), -1.75, Math.sin(a1) * (r * 0.68));
    const curve = new THREE.CatmullRomCurve3([p0, pMid, p1]);
    const cableGeo = new THREE.TubeGeometry(curve, 12, 0.036, 6, false);
    cableParts.push(bakePart(cableGeo));
    cableGeo.dispose();

    const lanternGlass = new THREE.CylinderGeometry(0.072, 0.072, 0.14, 8);
    weightParts.push(bakePart(lanternGlass, { x: pMid.x, y: pMid.y - 0.05, z: pMid.z }));
    lanternGlass.dispose();

    const lanternHood = new THREE.CylinderGeometry(0.04, 0.11, 0.09, 8);
    weightCapParts.push(bakePart(lanternHood, { x: pMid.x, y: pMid.y + 0.06, z: pMid.z }));
    lanternHood.dispose();
  }
  group.add(new THREE.Mesh(mergeBakedParts(cableParts), cableMat));
  group.add(new THREE.Mesh(mergeBakedParts(weightParts), amberGlowMat));
  group.add(new THREE.Mesh(mergeBakedParts(weightCapParts), trimSteelMat));

  return group;
}

/**
 * Sculpted miniature Tunic-inspired bonsai in a beveled stone planter seated flush at y = 0.
 */
export function buildBonsaiTreeGroup(palette: ThemePalette, seed = 0): THREE.Group {
  const tree = new THREE.Group();
  const trunkMat = createCelMaterial(0x734d34, { roughness: 0.84, metalness: 0.02 });
  const planterColor = new THREE.Color(palette.cliffTop)
    .lerp(new THREE.Color(palette.machineTop), 0.38)
    .getHex();
  const stoneMat = createCelMaterial(planterColor, { roughness: 0.78, metalness: 0.08 });
  const turfMat = createCelMaterial(0x4ead70, { roughness: 0.82 });
  const rockMat = createCelMaterial(palette.cliffSide, { roughness: 0.88 });
  const leafColors =
    palette.id === 'emerald'
      ? [0x3eb87a, 0x2f9963, 0x5bd492]
      : palette.id === 'mono'
        ? [0x42ad6b, 0x359158, 0x5cc784]
        : [0x45b877, 0x349c63, 0x62cf8e];

  // Grounding soft contact shadow disc (shared texture, never disposed prematurely)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: getSoftContactShadowTexture(),
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.05, 1, 1.05);
  shadow.position.y = 0.008;
  tree.add(shadow);

  // Beveled hexagonal stone planter rim
  const planterShape = createHexShape(0.36);
  const planterGeo = new THREE.ExtrudeGeometry(planterShape, {
    depth: 0.09,
    bevelEnabled: true,
    bevelThickness: 0.022,
    bevelSize: 0.022,
    bevelSegments: 1,
  });
  planterGeo.rotateX(-Math.PI / 2);
  const planter = new THREE.Mesh(planterGeo, stoneMat);
  planter.position.y = 0.015;
  planter.receiveShadow = true;
  planter.castShadow = true;
  tree.add(planter);

  // Moss cushion & miniature garden stone inside planter
  const moss = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.07, 10), turfMat);
  moss.position.y = 0.11;
  moss.receiveShadow = true;
  tree.add(moss);

  const gardenRock = new THREE.Mesh(createBoulderGeometry(0.085, seed + 3), rockMat);
  gardenRock.position.set(seed % 2 === 0 ? -0.14 : 0.14, 0.12, 0.11);
  tree.add(gardenRock);

  // Curved gnarled trunk + forked branch via TubeGeometry
  const sway = seed % 2 === 0 ? 1 : -1;
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.11, 0),
    new THREE.Vector3(sway * 0.06, 0.3, 0.02),
    new THREE.Vector3(sway * 0.02, 0.52, -0.02),
    new THREE.Vector3(-sway * 0.03, 0.68, 0),
  ]);
  const branchCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(sway * 0.04, 0.38, 0.01),
    new THREE.Vector3(sway * 0.15, 0.49, 0.06),
    new THREE.Vector3(sway * 0.23, 0.56, 0.08),
  ]);
  const trunkGeo = new THREE.TubeGeometry(trunkCurve, 8, 0.058, 7, false);
  const branchGeo = new THREE.TubeGeometry(branchCurve, 6, 0.034, 6, false);
  const woodMesh = new THREE.Mesh(
    mergeBakedParts([bakePart(trunkGeo), bakePart(branchGeo)]),
    trunkMat,
  );
  trunkGeo.dispose();
  branchGeo.dispose();
  woodMesh.castShadow = true;
  tree.add(woodMesh);

  // Organic foliage clouds (merged by color shade for low draw calls)
  const puffs: Array<[number, number, number, number]> = [
    [-sway * 0.02, 0.72, 0, 0.29],
    [sway * 0.23, 0.58, 0.08, 0.21],
    [-sway * 0.19, 0.62, -0.09, 0.2],
    [0.04, 0.83, -0.08, 0.18],
  ];
  const crownMat = createCelMaterial(0xffffff, { roughness: 0.78, metalness: 0 });
  crownMat.vertexColors = true;
  const puffParts: THREE.BufferGeometry[] = [];
  puffs.forEach(([px, py, pz, r], idx) => {
    const col = new THREE.Color(leafColors[idx % leafColors.length]);
    const puff = new THREE.IcosahedronGeometry(r, 1);
    const nonIdx = puff.index ? puff.toNonIndexed() : puff.clone();
    puff.dispose();
    const pos = nonIdx.getAttribute('position') as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      const n = hash2d(Math.round(vx * 50), Math.round(vz * 50), seed + idx);
      pos.setXYZ(v, vx * (1.06 + n * 0.18), vy * 0.76, vz * (1.06 + n * 0.18));
      const shade = 0.88 + (vy > 0 ? 0.14 : 0) + n * 0.08;
      cols[v * 3] = col.r * shade;
      cols[v * 3 + 1] = col.g * shade;
      cols[v * 3 + 2] = col.b * shade;
    }
    nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    nonIdx.computeVertexNormals();
    puffParts.push(bakePart(nonIdx, { x: px, y: py, z: pz }, true));
    nonIdx.dispose();
  });
  const canopyMesh = new THREE.Mesh(mergeBakedParts(puffParts), crownMat);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  tree.add(canopyMesh);

  return tree;
}

/**
 * Distant Monument Valley floating terrace island with sculpted craggy rock base,
 * cushioned turf cap, stone shrine gate, boulder, and bonsai tree.
 */
export function buildFloatingMiniIsland(palette: ThemePalette, seed = 0): THREE.Group {
  const island = new THREE.Group();
  const rockMat = createCelMaterial(0xffffff, { roughness: 0.86, metalness: 0.04 });
  rockMat.vertexColors = true;
  const turfMat = createCelMaterial(0xffffff, { roughness: 0.82, metalness: 0.02 });
  turfMat.vertexColors = true;
  const shrineColor = new THREE.Color(palette.valleyCliffTop)
    .lerp(new THREE.Color(palette.machineTop), 0.42)
    .getHex();
  const shrineMat = createCelMaterial(shrineColor, { roughness: 0.76, metalness: 0.1 });

  const cragGeo = createFloatingCragKeelGeometry(
    1.28,
    1.85,
    10,
    seed + 31,
    new THREE.Color(palette.cliffTop),
    new THREE.Color(palette.cliffSide),
    new THREE.Color(palette.machineBase),
  );
  cragGeo.translate(0, 0.12, 0);
  island.add(new THREE.Mesh(cragGeo, rockMat));

  const turfGeo = createMesaTurfGeometry(
    1.2,
    1.12,
    0.1,
    seed * 0.7,
    seed + 41,
    new THREE.Color(palette.valleyGrass),
  );
  island.add(new THREE.Mesh(turfGeo, turfMat));

  // Miniature Torii-style stone survey arch + side boulder
  const pillarL = new THREE.CylinderGeometry(0.055, 0.072, 0.52, 6);
  const pillarR = new THREE.CylinderGeometry(0.055, 0.072, 0.52, 6);
  const lintel = new THREE.BoxGeometry(0.56, 0.08, 0.12);
  const cap = new THREE.BoxGeometry(0.68, 0.06, 0.15);
  const shrineGeo = mergeBakedParts([
    bakePart(pillarL, { x: -0.42, y: 0.54, z: 0.22 }),
    bakePart(pillarR, { x: -0.06, y: 0.54, z: 0.22 }),
    bakePart(lintel, { x: -0.24, y: 0.78, z: 0.22 }),
    bakePart(cap, { x: -0.24, y: 0.85, z: 0.22 }),
  ]);
  pillarL.dispose();
  pillarR.dispose();
  lintel.dispose();
  cap.dispose();
  island.add(new THREE.Mesh(shrineGeo, shrineMat));

  const sideBoulder = new THREE.Mesh(
    createBoulderGeometry(0.22, seed + 51),
    createCelMaterial(palette.cliffSide, { roughness: 0.88 }),
  );
  sideBoulder.position.set(-0.56, 0.34, -0.26);
  island.add(sideBoulder);

  const bonsai = buildBonsaiTreeGroup(palette, seed);
  bonsai.position.set(0.28, 0.42, -0.1);
  bonsai.scale.setScalar(0.88);
  island.add(bonsai);

  return island;
}

/**
 * Volumetric matte cumulus cloud cluster with flat shaded undersides & rounded sunlit crowns
 * batched into just 2 meshes.
 */
export function buildStylizedCloudGroup(palette: ThemePalette, seed = 0): THREE.Group {
  const cloud = new THREE.Group();
  const topMat = createCelMaterial(palette.cloudTop, {
    roughness: 0.94,
    metalness: 0,
    emissive: palette.cloudTop,
    emissiveIntensity: 0.14,
  });
  const baseMat = createCelMaterial(palette.cloudBottom, {
    roughness: 0.96,
    metalness: 0,
    emissive: palette.cloudBottom,
    emissiveIntensity: 0.08,
  });

  const puffs: Array<[number, number, number, number, boolean]> = [
    [0, 0.18, 0, 0.92, true],
    [0.32, 0.32, 0.18, 0.58, true],
    [-0.34, 0.24, -0.16, 0.54, true],
    [0.64, 0.08, 0.06, 0.48, true],
    [-0.82, -0.06, 0.08, 0.66, false],
    [0.82, -0.08, -0.08, 0.68, false],
    [0, -0.14, 0.04, 0.78, false],
    [-0.4, -0.12, 0.24, 0.52, false],
  ];
  const mirror = seed % 2 === 0 ? 1 : -1;
  const topParts: THREE.BufferGeometry[] = [];
  const baseParts: THREE.BufferGeometry[] = [];

  for (const [x, y, z, r, isTop] of puffs) {
    const sphere = new THREE.IcosahedronGeometry(r, 2);
    const part = bakePart(sphere, {
      x: x * mirror,
      y: isTop ? y : y * 0.65,
      z,
      sx: 1.32,
      sy: isTop ? 0.64 : 0.44,
      sz: 1.05,
    });
    sphere.dispose();
    if (isTop) topParts.push(part);
    else baseParts.push(part);
  }

  cloud.add(new THREE.Mesh(mergeBakedParts(topParts), topMat));
  cloud.add(new THREE.Mesh(mergeBakedParts(baseParts), baseMat));
  return cloud;
}

/**
 * Architectural perimeter survey lantern bollard with stepped plinth, ribbed post,
 * 4-strut protective steel lantern cage framing a glowing glass core, and storm hood.
 */
export function buildPlatformBeaconPost(palette: ThemePalette): THREE.Group {
  const group = new THREE.Group();
  const baseMat = createCelMaterial(palette.machineBase, { roughness: 0.68, metalness: 0.25 });
  const trimMat = createCelMaterial(palette.machineTop, { roughness: 0.4, metalness: 0.42 });
  const glowMat = createCelMaterial(palette.accentSecondary, {
    emissive: palette.accentSecondary,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  const baseParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];

  const plinthLower = new THREE.CylinderGeometry(0.18, 0.22, 0.1, 6);
  const plinthUpper = new THREE.CylinderGeometry(0.12, 0.16, 0.08, 6);
  const collar = new THREE.CylinderGeometry(0.12, 0.1, 0.07, 8);
  const stormHood = new THREE.CylinderGeometry(0.03, 0.145, 0.1, 8);
  baseParts.push(
    bakePart(plinthLower, { y: 0.05 }),
    bakePart(plinthUpper, { y: 0.14 }),
    bakePart(collar, { y: 0.55 }),
    bakePart(stormHood, { y: 0.85 }),
  );
  plinthLower.dispose();
  plinthUpper.dispose();
  collar.dispose();
  stormHood.dispose();

  const shaft = new THREE.CylinderGeometry(0.048, 0.068, 0.36, 8);
  const neckRing = new THREE.TorusGeometry(0.072, 0.014, 6, 12);
  const hoodRing = new THREE.TorusGeometry(0.105, 0.015, 6, 12);
  const finial = new THREE.CylinderGeometry(0.01, 0.025, 0.08, 6);
  trimParts.push(
    bakePart(shaft, { y: 0.35 }),
    bakePart(neckRing, { y: 0.59, rx: Math.PI / 2 }),
    bakePart(hoodRing, { y: 0.8, rx: Math.PI / 2 }),
    bakePart(finial, { y: 0.93 }),
  );
  shaft.dispose();
  neckRing.dispose();
  hoodRing.dispose();
  finial.dispose();

  // 4 lantern cage struts around glowing glass cylinder
  const strutGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    trimParts.push(
      bakePart(strutGeo, {
        x: Math.cos(a) * 0.095,
        y: 0.695,
        z: Math.sin(a) * 0.095,
      }),
    );
  }
  strutGeo.dispose();

  const lanternGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.062, 0.19, 10),
    glowMat,
  );
  lanternGlass.position.y = 0.695;

  group.add(
    new THREE.Mesh(mergeBakedParts(baseParts), baseMat),
    new THREE.Mesh(mergeBakedParts(trimParts), trimMat),
    lanternGlass,
  );

  return group;
}

/**
 * Helper to create a smooth ribbon BufferGeometry along a 3D curve with UVs for river water shader.
 */
function createRiverRibbonGeometry(
  curve: THREE.CatmullRomCurve3,
  segments: number,
  halfWidth: number,
): THREE.BufferGeometry {
  const pts = curve.getSpacedPoints(segments);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];

  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getTangent(t, tangent);
    side.set(-tangent.z, 0, tangent.x).normalize();

    const widthScale = 1 + Math.sin(t * Math.PI * 3.0) * 0.18;
    const hw = halfWidth * widthScale;

    const p = pts[i];
    const vIdx = i * 2;
    positions[vIdx * 3] = p.x - side.x * hw;
    positions[vIdx * 3 + 1] = p.y;
    positions[vIdx * 3 + 2] = p.z - side.z * hw;

    positions[(vIdx + 1) * 3] = p.x + side.x * hw;
    positions[(vIdx + 1) * 3 + 1] = p.y;
    positions[(vIdx + 1) * 3 + 2] = p.z + side.z * hw;

    uvs[vIdx * 2] = t;
    uvs[vIdx * 2 + 1] = 0;
    uvs[(vIdx + 1) * 2] = t;
    uvs[(vIdx + 1) * 2 + 1] = 1;

    if (i < segments) {
      const a = vIdx;
      const b = vIdx + 1;
      const c = vIdx + 2;
      const d = vIdx + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Dual-arch masonry & steel viaduct bridge spanning the lower-left canyon river bend.
 * Uses real ExtrudeGeometry arch spandrels, cutwater river piers, steel balustrades, and gooseneck lamps.
 */
function buildValleyArchBridge(
  stoneDarkMat: THREE.MeshStandardMaterial,
  stoneTrimMat: THREE.MeshStandardMaterial,
  deckMat: THREE.MeshStandardMaterial,
  steelMat: THREE.MeshStandardMaterial,
  amberGlowMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const bridge = new THREE.Group();

  const darkParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const deckParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];

  // Extruded masonry spandrel side walls with 2 semicircular arch openings
  const spandrelShape = new THREE.Shape();
  spandrelShape.moveTo(-4.5, 0.25);
  spandrelShape.lineTo(-3.45, 0.25);
  spandrelShape.absarc(-1.95, 0.25, 1.5, Math.PI, 0, true);
  spandrelShape.lineTo(0.45, 0.25);
  spandrelShape.absarc(1.95, 0.25, 1.5, Math.PI, 0, true);
  spandrelShape.lineTo(4.5, 0.25);
  spandrelShape.lineTo(4.5, 2.08);
  spandrelShape.lineTo(-4.5, 2.08);
  spandrelShape.closePath();

  const spandrelGeo = new THREE.ExtrudeGeometry(spandrelShape, {
    depth: 0.28,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: 14,
  });
  spandrelGeo.translate(0, 0, -0.14);
  trimParts.push(bakePart(spandrelGeo, { z: -0.74 }));
  trimParts.push(bakePart(spandrelGeo, { z: 0.74 }));
  spandrelGeo.dispose();

  // Arched stone soffit rings lining the underside of the viaduct
  const archVaultGeo = new THREE.CylinderGeometry(1.5, 1.5, 1.5, 16, 1, true, 0, Math.PI);
  for (const ax of [-1.95, 1.95]) {
    darkParts.push(
      bakePart(archVaultGeo, { x: ax, y: 0.25, rx: Math.PI / 2, rz: Math.PI / 2 }),
    );
  }
  archVaultGeo.dispose();

  // Three tapered stone river piers with triangular cutwater noses
  const pierBodyGeo = new THREE.BoxGeometry(1.05, 2.35, 1.95);
  const pierFootingGeo = new THREE.BoxGeometry(1.3, 0.55, 2.25);
  const cutwaterGeo = new THREE.CylinderGeometry(0.42, 0.58, 2.2, 3);
  for (const px of [-3.95, 0, 3.95]) {
    darkParts.push(bakePart(pierBodyGeo, { x: px, y: 0.9 }));
    darkParts.push(bakePart(pierFootingGeo, { x: px, y: -0.15 }));
    trimParts.push(bakePart(cutwaterGeo, { x: px, y: 0.85, z: 0.98 }));
    trimParts.push(bakePart(cutwaterGeo, { x: px, y: 0.85, z: -0.98, ry: Math.PI }));
  }
  pierBodyGeo.dispose();
  pierFootingGeo.dispose();
  cutwaterGeo.dispose();

  // Roadway slab, raised side curbs, stone parapet bollards & horizontal steel handrails
  const deckSlab = new THREE.BoxGeometry(9.2, 0.24, 1.92);
  const roadTop = new THREE.BoxGeometry(9.2, 0.08, 1.32);
  const curbGeo = new THREE.BoxGeometry(9.2, 0.16, 0.22);
  trimParts.push(bakePart(deckSlab, { y: 2.02 }));
  deckParts.push(bakePart(roadTop, { y: 2.15 }));
  trimParts.push(bakePart(curbGeo, { y: 2.2, z: -0.82 }));
  trimParts.push(bakePart(curbGeo, { y: 2.2, z: 0.82 }));
  deckSlab.dispose();
  roadTop.dispose();
  curbGeo.dispose();

  const postGeo = new THREE.BoxGeometry(0.18, 0.36, 0.18);
  const railGeo = new THREE.BoxGeometry(9.1, 0.06, 0.06);
  for (const zSide of [-0.82, 0.82]) {
    steelParts.push(bakePart(railGeo, { y: 2.48, z: zSide }));
    for (const xp of [-4.2, -2.1, 0, 2.1, 4.2]) {
      trimParts.push(bakePart(postGeo, { x: xp, y: 2.38, z: zSide }));
    }
  }
  postGeo.dispose();
  railGeo.dispose();

  // 4 curved gooseneck bridge streetlamps
  const lampHoodGeo = new THREE.CylinderGeometry(0.04, 0.14, 0.1, 8);
  const lampBulbGeo = new THREE.SphereGeometry(0.07, 8, 6);
  for (const [lx, lz] of [
    [-2.8, 0.82],
    [2.8, 0.82],
    [-2.8, -0.82],
    [2.8, -0.82],
  ]) {
    const inward = lz > 0 ? -0.26 : 0.26;
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(lx, 2.52, lz),
      new THREE.Vector3(lx, 3.08, lz),
      new THREE.Vector3(lx, 3.16, lz + inward),
      new THREE.Vector3(lx, 3.04, lz + inward * 1.15),
    ]);
    const armGeo = new THREE.TubeGeometry(armCurve, 8, 0.032, 6, false);
    steelParts.push(bakePart(armGeo));
    armGeo.dispose();
    steelParts.push(bakePart(lampHoodGeo, { x: lx, y: 3.01, z: lz + inward * 1.15 }));
    glowParts.push(bakePart(lampBulbGeo, { x: lx, y: 2.94, z: lz + inward * 1.15 }));
  }
  lampHoodGeo.dispose();
  lampBulbGeo.dispose();

  bridge.add(
    new THREE.Mesh(mergeBakedParts(darkParts), stoneDarkMat),
    new THREE.Mesh(mergeBakedParts(trimParts), stoneTrimMat),
    new THREE.Mesh(mergeBakedParts(deckParts), deckMat),
    new THREE.Mesh(mergeBakedParts(steelParts), steelMat),
    new THREE.Mesh(mergeBakedParts(glowParts), amberGlowMat),
  );

  return bridge;
}

/**
 * Hydroelectric Pump & Control Outpost replacing the old 2-box placeholder:
 * chamfered octagonal hull, corner pilasters, glowing cyan viewport windows, blast door,
 * curved river intake pipes, radio mast, and spinning rooftop turbine vent fan.
 */
function buildValleyOutpostStation(
  hullMat: THREE.MeshStandardMaterial,
  darkMat: THREE.MeshStandardMaterial,
  trimMat: THREE.MeshStandardMaterial,
  steelMat: THREE.MeshStandardMaterial,
  cyanGlowMat: THREE.MeshStandardMaterial,
  amberGlowMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const station = new THREE.Group();

  const hullParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const cyanParts: THREE.BufferGeometry[] = [];
  const amberParts: THREE.BufferGeometry[] = [];

  // Stepped masonry plinth
  const plinthShape = createOctagonShape(2.05);
  const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 1,
  });
  plinthGeo.rotateX(-Math.PI / 2);
  darkParts.push(bakePart(plinthGeo, { y: 0 }));
  plinthGeo.dispose();

  // Chamfered octagonal main station hull
  const bodyShape = createOctagonShape(1.68);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 2.1,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.07,
    bevelSegments: 1,
  });
  bodyGeo.rotateX(-Math.PI / 2);
  hullParts.push(bakePart(bodyGeo, { y: 0.46 }));
  bodyGeo.dispose();

  // 4 corner structural pilasters
  const pilasterGeo = new THREE.BoxGeometry(0.36, 2.25, 0.36);
  for (const [px, pz] of [
    [-1.24, -1.24],
    [1.24, -1.24],
    [-1.24, 1.24],
    [1.24, 1.24],
  ]) {
    darkParts.push(bakePart(pilasterGeo, { x: px, y: 1.54, z: pz, ry: Math.PI / 4 }));
  }
  pilasterGeo.dispose();

  // Roof deck cornice rim & rooftop turbine shroud
  const roofRimGeo = new THREE.ExtrudeGeometry(createOctagonShape(1.82), {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
  });
  roofRimGeo.rotateX(-Math.PI / 2);
  trimParts.push(bakePart(roofRimGeo, { y: 2.64 }));
  roofRimGeo.dispose();

  const shroudGeo = new THREE.CylinderGeometry(0.74, 0.84, 0.32, 14, 1, true);
  const shroudRingGeo = new THREE.TorusGeometry(0.76, 0.08, 6, 16);
  steelParts.push(bakePart(shroudGeo, { x: -0.2, y: 3.06, z: 0.1 }));
  trimParts.push(bakePart(shroudRingGeo, { x: -0.2, y: 3.2, z: 0.1, rx: Math.PI / 2 }));
  shroudGeo.dispose();
  shroudRingGeo.dispose();

  // Recessed armored blast door + amber lintel beacon (+Z face)
  const doorFrame = new THREE.BoxGeometry(0.86, 1.18, 0.16);
  const doorLeaf = new THREE.BoxGeometry(0.66, 1.0, 0.18);
  const doorLintel = new THREE.BoxGeometry(0.76, 0.1, 0.18);
  darkParts.push(bakePart(doorFrame, { y: 1.02, z: 1.56 }));
  steelParts.push(bakePart(doorLeaf, { y: 0.98, z: 1.58 }));
  amberParts.push(bakePart(doorLintel, { y: 1.66, z: 1.58 }));
  doorFrame.dispose();
  doorLeaf.dispose();
  doorLintel.dispose();

  // Recessed glowing cyan viewport windows along front & flanks
  const winFrame = new THREE.BoxGeometry(0.74, 0.42, 0.16);
  const winGlass = new THREE.BoxGeometry(0.58, 0.28, 0.18);
  for (const [wx, wy, wz, ry] of [
    [0, 2.1, 1.56, 0],
    [1.56, 1.75, 0, Math.PI / 2],
    [-1.56, 1.75, 0, Math.PI / 2],
  ]) {
    darkParts.push(bakePart(winFrame, { x: wx, y: wy, z: wz, ry }));
    cyanParts.push(bakePart(winGlass, { x: wx, y: wy, z: wz, ry }));
  }
  winFrame.dispose();
  winGlass.dispose();

  // Dual curved flanged intake pipes descending down cliff edge toward river
  const flangeGeo = new THREE.TorusGeometry(0.18, 0.045, 6, 12);
  for (const pz of [-0.36, 0.36]) {
    const pipeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.45, 1.45, pz),
      new THREE.Vector3(-2.15, 1.4, pz),
      new THREE.Vector3(-2.35, 0.35, pz),
      new THREE.Vector3(-2.35, -1.9, pz),
    ]);
    const pipeGeo = new THREE.TubeGeometry(pipeCurve, 12, 0.14, 8, false);
    steelParts.push(bakePart(pipeGeo));
    pipeGeo.dispose();
    trimParts.push(bakePart(flangeGeo, { x: -1.75, y: 1.44, z: pz, ry: Math.PI / 2 }));
    trimParts.push(bakePart(flangeGeo, { x: -2.35, y: 0.25, z: pz, rx: Math.PI / 2 }));
  }
  flangeGeo.dispose();

  // Telemetry radio mast + cross-arm on roof corner
  const mastGeo = new THREE.CylinderGeometry(0.04, 0.065, 1.65, 8);
  const crossArm = new THREE.BoxGeometry(0.72, 0.05, 0.05);
  const tipBeacon = new THREE.SphereGeometry(0.08, 8, 6);
  steelParts.push(bakePart(mastGeo, { x: 0.92, y: 3.7, z: -0.68 }));
  trimParts.push(bakePart(crossArm, { x: 0.92, y: 4.25, z: -0.68, ry: 0.4 }));
  amberParts.push(bakePart(tipBeacon, { x: 0.92, y: 4.55, z: -0.68 }));
  mastGeo.dispose();
  crossArm.dispose();
  tipBeacon.dispose();

  station.add(
    new THREE.Mesh(mergeBakedParts(hullParts), hullMat),
    new THREE.Mesh(mergeBakedParts(darkParts), darkMat),
    new THREE.Mesh(mergeBakedParts(trimParts), trimMat),
    new THREE.Mesh(mergeBakedParts(steelParts), steelMat),
    new THREE.Mesh(mergeBakedParts(cyanParts), cyanGlowMat),
    new THREE.Mesh(mergeBakedParts(amberParts), amberGlowMat),
  );

  // Animated 5-blade rooftop turbine vent rotor
  const fanGroup = new THREE.Group();
  fanGroup.position.set(-0.2, 3.1, 0.1);
  fanGroup.userData.sceneryAnim = 'spinY';
  fanGroup.userData.spinSpeed = 2.6;

  const fanParts: THREE.BufferGeometry[] = [];
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.18, 10);
  fanParts.push(bakePart(hubGeo));
  hubGeo.dispose();

  const bladeGeo = new THREE.BoxGeometry(0.56, 0.04, 0.16);
  for (let b = 0; b < 5; b++) {
    const a = (b * Math.PI * 2) / 5;
    fanParts.push(
      bakePart(bladeGeo, {
        x: Math.cos(a) * 0.34,
        y: 0.01,
        z: Math.sin(a) * 0.34,
        rx: 0.35,
        ry: -a,
      }),
    );
  }
  bladeGeo.dispose();
  fanGroup.add(new THREE.Mesh(mergeBakedParts(fanParts), trimMat));
  station.add(fanGroup);

  return station;
}

/**
 * Buttressed Radar & Beacon Watchtower with octagonal stone footing, conduit shaft,
 * cantilevered observation deck, framed lantern glass chamber, and sweeping radar dish.
 */
function buildValleyRelayTower(
  darkMat: THREE.MeshStandardMaterial,
  hullMat: THREE.MeshStandardMaterial,
  trimMat: THREE.MeshStandardMaterial,
  steelMat: THREE.MeshStandardMaterial,
  cyanGlowMat: THREE.MeshStandardMaterial,
  amberGlowMat: THREE.MeshStandardMaterial,
  scaleY = 1,
  phase = 0,
): THREE.Group {
  const tower = new THREE.Group();

  const darkParts: THREE.BufferGeometry[] = [];
  const hullParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const cyanParts: THREE.BufferGeometry[] = [];
  const amberParts: THREE.BufferGeometry[] = [];

  // Stepped octagonal masonry footing + 4 radial buttress fins
  const plinthGeo = new THREE.CylinderGeometry(1.02, 1.42, 2.0, 8);
  darkParts.push(bakePart(plinthGeo, { y: 1.0 }));
  plinthGeo.dispose();

  const buttressGeo = new THREE.BoxGeometry(0.32, 2.1, 0.85);
  for (let b = 0; b < 4; b++) {
    const a = (b * Math.PI) / 2 + Math.PI / 4;
    darkParts.push(
      bakePart(buttressGeo, {
        x: Math.cos(a) * 0.98,
        y: 1.05,
        z: Math.sin(a) * 0.98,
        ry: -a + Math.PI / 2,
      }),
    );
  }
  buttressGeo.dispose();

  // Tapered structural shaft + mid-collar + 2 external vertical conduit pipes
  const shaftH = 5.0 * scaleY;
  const shaftGeo = new THREE.CylinderGeometry(0.56, 0.9, shaftH, 8);
  hullParts.push(bakePart(shaftGeo, { y: 2.0 + shaftH * 0.5 }));
  shaftGeo.dispose();

  const collarGeo = new THREE.CylinderGeometry(0.86, 0.86, 0.34, 8);
  trimParts.push(bakePart(collarGeo, { y: 2.0 + shaftH * 0.52 }));
  collarGeo.dispose();

  const conduitGeo = new THREE.CylinderGeometry(0.065, 0.065, shaftH + 0.3, 6);
  for (const ca of [0.4, Math.PI + 0.4]) {
    steelParts.push(
      bakePart(conduitGeo, {
        x: Math.cos(ca) * 0.78,
        y: 2.0 + shaftH * 0.5,
        z: Math.sin(ca) * 0.78,
      }),
    );
  }
  conduitGeo.dispose();

  // Cantilevered observation gallery deck + perimeter handrail & 8 stanchions
  const topY = 2.0 + shaftH;
  const deckGeo = new THREE.CylinderGeometry(1.38, 0.72, 0.62, 8);
  trimParts.push(bakePart(deckGeo, { y: topY + 0.31 }));
  deckGeo.dispose();

  const railRingGeo = new THREE.TorusGeometry(1.26, 0.045, 6, 16);
  steelParts.push(bakePart(railRingGeo, { y: topY + 0.92, rx: Math.PI / 2 }));
  railRingGeo.dispose();

  const stanchionGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.34, 5);
  for (let s = 0; s < 8; s++) {
    const a = (s * Math.PI) / 4;
    steelParts.push(
      bakePart(stanchionGeo, {
        x: Math.cos(a) * 1.24,
        y: topY + 0.76,
        z: Math.sin(a) * 1.24,
      }),
    );
  }
  stanchionGeo.dispose();

  // Framed glass lantern chamber + stepped dome roof + aviation spire
  const lanternGlassGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.85, 12);
  cyanParts.push(bakePart(lanternGlassGeo, { y: topY + 1.05 }));
  lanternGlassGeo.dispose();

  const mullionGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.92, 6);
  for (let m = 0; m < 6; m++) {
    const a = (m * Math.PI) / 3;
    steelParts.push(
      bakePart(mullionGeo, {
        x: Math.cos(a) * 0.72,
        y: topY + 1.06,
        z: Math.sin(a) * 0.72,
      }),
    );
  }
  mullionGeo.dispose();

  const domeBase = new THREE.CylinderGeometry(0.86, 0.94, 0.2, 8);
  const domeCupola = new THREE.SphereGeometry(0.68, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const spireGeo = new THREE.CylinderGeometry(0.04, 0.12, 1.35, 6);
  const beaconTipGeo = new THREE.SphereGeometry(0.16, 8, 6);
  trimParts.push(bakePart(domeBase, { y: topY + 1.56 }));
  hullParts.push(bakePart(domeCupola, { y: topY + 1.64 }));
  steelParts.push(bakePart(spireGeo, { y: topY + 2.55 }));
  amberParts.push(bakePart(beaconTipGeo, { y: topY + 3.28 }));
  domeBase.dispose();
  domeCupola.dispose();
  spireGeo.dispose();
  beaconTipGeo.dispose();

  tower.add(
    new THREE.Mesh(mergeBakedParts(darkParts), darkMat),
    new THREE.Mesh(mergeBakedParts(hullParts), hullMat),
    new THREE.Mesh(mergeBakedParts(trimParts), trimMat),
    new THREE.Mesh(mergeBakedParts(steelParts), steelMat),
    new THREE.Mesh(mergeBakedParts(cyanParts), cyanGlowMat),
    new THREE.Mesh(mergeBakedParts(amberParts), amberGlowMat),
  );

  // Sweeping parabolic radar dish assembly on roof pedestal
  const radarPivot = new THREE.Group();
  radarPivot.position.set(0.75, topY + 1.85, 0.45);
  radarPivot.userData.sceneryAnim = 'radarSweep';
  radarPivot.userData.phase = phase;

  const dishPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.28, 0.06),
    new THREE.Vector2(0.46, 0.2),
  ];
  const dishGeo = new THREE.LatheGeometry(dishPts, 12);
  const feedGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.34, 6);
  const dishMesh = new THREE.Mesh(
    mergeBakedParts([
      bakePart(dishGeo, { rx: Math.PI / 2 - 0.32 }),
      bakePart(feedGeo, { y: 0.1, z: 0.22, rx: Math.PI / 2 - 0.32 }),
    ]),
    trimMat,
  );
  dishGeo.dispose();
  feedGeo.dispose();
  radarPivot.add(dishMesh);
  tower.add(radarPivot);

  return tower;
}

/**
 * Rich stylized 3D canyon valley vista beneath and surrounding the floating hex citadel:
 * winding river, sculpted stratified cliffs, two forest archetypes + boulders (InstancedMesh),
 * masonry viaduct bridge, hydroelectric pump outpost, radar watchtowers, and sculpted alpine mountains.
 */
export function buildScenicValleyEnvironment(palette: ThemePalette): {
  group: THREE.Group;
  waterMaterial: THREE.ShaderMaterial;
} {
  const group = new THREE.Group();

  // Pooled palette materials (reused across merged scenery meshes for minimal shader overhead)
  const canyonFloorMat = createCelMaterial(palette.valleyCliff, {
    roughness: 0.94,
    metalness: 0.04,
  });
  const cliffVertexMat = createCelMaterial(0xffffff, {
    roughness: 0.87,
    metalness: 0.05,
  });
  cliffVertexMat.vertexColors = true;

  const grassVertexMat = createCelMaterial(0xffffff, {
    roughness: 0.86,
    metalness: 0.02,
  });
  grassVertexMat.vertexColors = true;

  const mountainMat = createCelMaterial(0xffffff, {
    roughness: 0.92,
    metalness: 0.04,
  });
  mountainMat.vertexColors = true;

  const masonryDarkMat = createCelMaterial(palette.valleyCliff, {
    roughness: 0.84,
    metalness: 0.1,
  });
  const masonryTrimMat = createCelMaterial(palette.valleyCliffTop, {
    roughness: 0.72,
    metalness: 0.16,
  });
  const deckMat = createCelMaterial(palette.machineTop, {
    roughness: 0.52,
    metalness: 0.2,
  });
  const steelMat = createCelMaterial(palette.machineBase, {
    roughness: 0.44,
    metalness: 0.48,
  });
  const cyanGlowMat = createCelMaterial(palette.accentSecondary, {
    emissive: palette.accentSecondary,
    emissiveIntensity: 0.85,
    roughness: 0.22,
  });
  const amberGlowMat = createCelMaterial(palette.accent, {
    emissive: palette.accent,
    emissiveIntensity: 0.85,
    roughness: 0.22,
  });
  const waterMaterial = createRiverWaterMaterial(palette.valleyRiver, palette.valleyRiverHighlight);

  // Broad canyon riverbed floor seated deep below the floating island keel
  const FLOOR_Y = -15.6;
  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(170, 150), canyonFloorMat);
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.set(0, FLOOR_Y, -14);
  group.add(floorPlane);

  // Main winding river sweeping from lower-left under the bridge around rear-right
  const mainRiverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-36, FLOOR_Y + 0.14, 11),
    new THREE.Vector3(-20, FLOOR_Y + 0.14, 3.5),
    new THREE.Vector3(-12.2, FLOOR_Y + 0.14, -2.2),
    new THREE.Vector3(-3, FLOOR_Y + 0.14, -9.5),
    new THREE.Vector3(9, FLOOR_Y + 0.14, -15.5),
    new THREE.Vector3(22, FLOOR_Y + 0.14, -21.5),
    new THREE.Vector3(38, FLOOR_Y + 0.14, -28),
  ]);
  group.add(
    new THREE.Mesh(createRiverRibbonGeometry(mainRiverCurve, 52, 3.25), waterMaterial),
  );

  // Secondary right-flank river bend visible at lower-right viewport corner
  const eastRiverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(8, FLOOR_Y + 0.13, 10),
    new THREE.Vector3(14, FLOOR_Y + 0.13, 2.5),
    new THREE.Vector3(21, FLOOR_Y + 0.13, -5),
    new THREE.Vector3(32, FLOOR_Y + 0.13, -13),
  ]);
  group.add(
    new THREE.Mesh(createRiverRibbonGeometry(eastRiverCurve, 26, 2.5), waterMaterial),
  );

  // Sculpted stratified canyon cliff plateaus & undulating grassy meadows (batched into 2 draw calls!)
  interface TerraceSpec {
    x: number;
    z: number;
    rx: number;
    rz: number;
    h: number;
    rot: number;
    hasGrass: boolean;
  }
  const terraces: TerraceSpec[] = [
    { x: -23, z: -4, rx: 8.2, rz: 7.2, h: 3.4, rot: 0.3, hasGrass: true },
    { x: -26, z: 8, rx: 7.5, rz: 6.5, h: 2.8, rot: -0.2, hasGrass: true },
    { x: -15, z: 7.2, rx: 5.8, rz: 4.8, h: 2.3, rot: 0.4, hasGrass: true },
    { x: -18, z: -15.5, rx: 8.8, rz: 7.8, h: 4.5, rot: 0.15, hasGrass: true },
    { x: -8, z: -22, rx: 8.2, rz: 7.0, h: 3.8, rot: -0.35, hasGrass: true },
    { x: -28, z: -24, rx: 10.5, rz: 9.5, h: 5.8, rot: 0.5, hasGrass: true },
    { x: 4, z: -25, rx: 9.2, rz: 7.2, h: 4.2, rot: 0.2, hasGrass: true },
    { x: 17, z: -14.5, rx: 8.0, rz: 6.6, h: 3.8, rot: -0.25, hasGrass: true },
    { x: 26, z: -18, rx: 9.5, rz: 8.0, h: 5.0, rot: 0.4, hasGrass: true },
    { x: 14.5, z: -4.2, rx: 5.2, rz: 4.6, h: 2.6, rot: 0.1, hasGrass: true },
    { x: 25, z: 4, rx: 7.5, rz: 7.0, h: 3.4, rot: -0.3, hasGrass: true },
    { x: 10.5, z: 7.5, rx: 4.6, rz: 4.0, h: 2.1, rot: 0.45, hasGrass: true },
    { x: -12, z: -8, rx: 4.8, rz: 4.0, h: 1.6, rot: 0.2, hasGrass: false },
    { x: 8.5, z: -9.5, rx: 4.6, rz: 3.8, h: 1.5, rot: -0.4, hasGrass: false },
  ];

  const cliffTopCol = new THREE.Color(palette.valleyCliffTop);
  const cliffSideCol = new THREE.Color(palette.valleyCliff);
  const cliffBaseCol = new THREE.Color(palette.cliffSide);
  const grassCol = new THREE.Color(palette.valleyGrass);

  const rockTerraceParts: THREE.BufferGeometry[] = [];
  const turfTerraceParts: THREE.BufferGeometry[] = [];
  const pineSpots: Array<{ x: number; y: number; z: number; scale: number }> = [];
  const oakSpots: Array<{ x: number; y: number; z: number; scale: number }> = [];
  const boulderSpots: Array<{ x: number; y: number; z: number; scale: number; rot: number }> = [];

  terraces.forEach((t, idx) => {
    const rockGeo = createMesaRockGeometry(
      t.rx,
      t.rz,
      t.h,
      t.rot,
      idx + 1,
      cliffTopCol,
      idx % 2 === 0 ? cliffSideCol : cliffTopCol.clone().multiplyScalar(0.86),
      cliffBaseCol,
    );
    rockTerraceParts.push(bakePart(rockGeo, { x: t.x, y: FLOOR_Y, z: t.z }, true));
    rockGeo.dispose();

    if (t.hasGrass) {
      const turfGeo = createMesaTurfGeometry(
        t.rx,
        t.rz,
        t.h - 0.04,
        t.rot,
        idx + 1,
        grassCol,
      );
      turfTerraceParts.push(bakePart(turfGeo, { x: t.x, y: FLOOR_Y, z: t.z }, true));
      turfGeo.dispose();

      // Seed both layered alpine pines & broadleaf valley oaks across green meadows
      const treeCount = 4 + (idx % 2);
      for (let k = 0; k < treeCount; k++) {
        const ang = idx * 1.37 + k * 1.65;
        const rad = 0.22 + ((k * 0.21 + idx * 0.13) % 0.46);
        const tx = t.x + Math.cos(ang) * t.rx * rad;
        const tz = t.z + Math.sin(ang) * t.rz * rad;
        const ty = FLOOR_Y + t.h + 0.34;
        const sc = 0.78 + ((idx + k) % 4) * 0.15;
        if ((idx + k) % 3 === 0) {
          oakSpots.push({ x: tx, y: ty, z: tz, scale: sc });
        } else {
          pineSpots.push({ x: tx, y: ty, z: tz, scale: sc });
        }
      }

      // 1-2 sculpted boulders per plateau rim
      for (let b = 0; b < 2; b++) {
        const ba = idx * 2.1 + b * 2.8;
        boulderSpots.push({
          x: t.x + Math.cos(ba) * t.rx * 0.62,
          y: FLOOR_Y + t.h + 0.24,
          z: t.z + Math.sin(ba) * t.rz * 0.62,
          scale: 0.7 + ((idx + b) % 3) * 0.32,
          rot: ba,
        });
      }
    }
  });

  // Extra riverbank boulders near bridge & canyon bends
  const bankBoulders: Array<[number, number, number, number]> = [
    [-16.4, FLOOR_Y + 0.08, -0.6, 1.3],
    [-15.2, FLOOR_Y + 0.08, -4.4, 1.1],
    [-8.6, FLOOR_Y + 0.08, -4.8, 1.25],
    [10.2, FLOOR_Y + 0.08, 4.1, 1.15],
    [12.8, FLOOR_Y + 0.08, -0.8, 1.0],
  ];
  for (let i = 0; i < bankBoulders.length; i++) {
    const [bx, by, bz, sc] = bankBoulders[i];
    boulderSpots.push({ x: bx, y: by, z: bz, scale: sc, rot: i * 1.1 });
  }

  group.add(new THREE.Mesh(mergeBakedParts(rockTerraceParts), cliffVertexMat));
  group.add(new THREE.Mesh(mergeBakedParts(turfTerraceParts), grassVertexMat));

  const dummy = new THREE.Object3D();
  const baseLeaf = new THREE.Color(palette.valleyGrass);
  const tintCol = new THREE.Color();
  const woodMat = createCelMaterial(0x543c2c, { roughness: 0.88 });
  const leafInstMat = createCelMaterial(0xffffff, { roughness: 0.8, metalness: 0.02 });

  // 1. Layered Scalloped Alpine Pines (InstancedMesh)
  if (pineSpots.length > 0) {
    const pineTrunkGeo = new THREE.CylinderGeometry(0.08, 0.15, 0.56, 7);
    pineTrunkGeo.translate(0, 0.28, 0);
    const pineCrownGeo = createLayeredPineCrownGeometry();

    const pineTrunkInst = new THREE.InstancedMesh(pineTrunkGeo, woodMat, pineSpots.length);
    const pineCrownInst = new THREE.InstancedMesh(pineCrownGeo, leafInstMat, pineSpots.length);

    pineSpots.forEach((sp, i) => {
      dummy.position.set(sp.x, sp.y, sp.z);
      dummy.rotation.set(0, (i * 1.15) % (Math.PI * 2), 0);
      dummy.scale.setScalar(sp.scale);
      dummy.updateMatrix();
      pineTrunkInst.setMatrixAt(i, dummy.matrix);
      pineCrownInst.setMatrixAt(i, dummy.matrix);

      tintCol.copy(baseLeaf).multiplyScalar(0.84 + (i % 5) * 0.085);
      pineCrownInst.setColorAt(i, tintCol);
    });
    if (pineCrownInst.instanceColor) pineCrownInst.instanceColor.needsUpdate = true;
    pineTrunkInst.computeBoundingSphere();
    pineCrownInst.computeBoundingSphere();
    group.add(pineTrunkInst, pineCrownInst);
  }

  // 2. Broadleaf Valley Oaks (InstancedMesh)
  if (oakSpots.length > 0) {
    const oakTrunkGeo = createOakTrunkGeometry();
    const oakCrownGeo = createOakCrownGeometry();

    const oakTrunkInst = new THREE.InstancedMesh(oakTrunkGeo, woodMat, oakSpots.length);
    const oakCrownInst = new THREE.InstancedMesh(oakCrownGeo, leafInstMat, oakSpots.length);

    oakSpots.forEach((sp, i) => {
      dummy.position.set(sp.x, sp.y, sp.z);
      dummy.rotation.set(0, (i * 2.1) % (Math.PI * 2), 0);
      dummy.scale.setScalar(sp.scale * 0.96);
      dummy.updateMatrix();
      oakTrunkInst.setMatrixAt(i, dummy.matrix);
      oakCrownInst.setMatrixAt(i, dummy.matrix);

      tintCol.copy(baseLeaf).multiplyScalar(0.95 + (i % 4) * 0.09);
      oakCrownInst.setColorAt(i, tintCol);
    });
    if (oakCrownInst.instanceColor) oakCrownInst.instanceColor.needsUpdate = true;
    oakTrunkInst.computeBoundingSphere();
    oakCrownInst.computeBoundingSphere();
    group.add(oakTrunkInst, oakCrownInst);
  }

  // 3. Sculpted Riverbank & Plateau Boulders (InstancedMesh)
  if (boulderSpots.length > 0) {
    const boulderGeo = createBoulderGeometry(0.46, 91);
    const boulderMat = createCelMaterial(0xffffff, { roughness: 0.88, metalness: 0.04 });
    const boulderInst = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderSpots.length);
    const baseStone = new THREE.Color(palette.valleyCliffTop);
    boulderSpots.forEach((sp, i) => {
      dummy.position.set(sp.x, sp.y, sp.z);
      dummy.rotation.set(0, sp.rot, 0);
      dummy.scale.setScalar(sp.scale);
      dummy.updateMatrix();
      boulderInst.setMatrixAt(i, dummy.matrix);

      tintCol.copy(baseStone).multiplyScalar(0.84 + (i % 4) * 0.1);
      boulderInst.setColorAt(i, tintCol);
    });
    if (boulderInst.instanceColor) boulderInst.instanceColor.needsUpdate = true;
    boulderInst.computeBoundingSphere();
    group.add(boulderInst);
  }

  // Dual-Arch Masonry & Steel Viaduct Bridge crossing the mid-left river bend
  const bridge = buildValleyArchBridge(
    masonryDarkMat,
    masonryTrimMat,
    deckMat,
    steelMat,
    amberGlowMat,
  );
  bridge.position.set(-12.2, FLOOR_Y + 0.1, -2.2);
  bridge.rotation.y = -0.62;
  group.add(bridge);

  // Foreground-left Hydroelectric Pump & Control Outpost
  const outpost = buildValleyOutpostStation(
    masonryTrimMat,
    masonryDarkMat,
    deckMat,
    steelMat,
    cyanGlowMat,
    amberGlowMat,
  );
  outpost.position.set(-14.2, FLOOR_Y + 2.25, 4.6);
  outpost.rotation.y = 0.34;
  group.add(outpost);

  // Buttressed Radar & Beacon Watchtowers flanking the valley
  const leftTower = buildValleyRelayTower(
    masonryDarkMat,
    masonryTrimMat,
    deckMat,
    steelMat,
    cyanGlowMat,
    amberGlowMat,
    1.18,
    0.4,
  );
  leftTower.position.set(-15.5, FLOOR_Y + 4.4, -14.8);
  group.add(leftTower);

  const rightTower = buildValleyRelayTower(
    masonryDarkMat,
    masonryTrimMat,
    deckMat,
    steelMat,
    cyanGlowMat,
    amberGlowMat,
    1.38,
    2.1,
  );
  rightTower.position.set(16.8, FLOOR_Y + 3.8, -14.2);
  group.add(rightTower);

  const nearRightPylon = buildValleyRelayTower(
    masonryDarkMat,
    masonryTrimMat,
    deckMat,
    steelMat,
    cyanGlowMat,
    amberGlowMat,
    0.72,
    4.0,
  );
  nearRightPylon.position.set(14.0, FLOOR_Y + 2.5, -3.5);
  nearRightPylon.scale.setScalar(0.85);
  group.add(nearRightPylon);

  // Sculpted Horizon Alpine Mountain Massifs (batched into 1 single vertex-colored mesh)
  const mtnBaseCol = new THREE.Color(palette.valleyCliff);
  const mtnMidCol = new THREE.Color(palette.valleyMountain);
  const mtnCrestCol = new THREE.Color(palette.cloudTop).lerp(mtnMidCol, 0.42);

  const mountainSpecs: Array<[number, number, number, number, number]> = [
    [-40, -34, 13.5, 22, 0.2],
    [-25, -38, 15.5, 26, 0.7],
    [-11, -40, 12.5, 20, 1.1],
    [4, -42, 16.5, 25, 0.4],
    [19, -38, 14.5, 27, 0.9],
    [33, -35, 15.5, 25, 0.3],
    [44, -30, 13.5, 20, 1.2],
    [-42, -18, 12.0, 17, 0.6],
    [42, -16, 12.0, 18, 0.8],
  ];
  const mtnParts: THREE.BufferGeometry[] = [];
  mountainSpecs.forEach(([mx, mz, mr, mh, rot], idx) => {
    const ridge = createAlpineRidgeGeometry(
      mr,
      mh,
      rot,
      idx + 17,
      mtnBaseCol,
      mtnMidCol,
      mtnCrestCol,
    );
    mtnParts.push(bakePart(ridge, { x: mx, y: FLOOR_Y - 0.5, z: mz }, true));
    ridge.dispose();
  });
  group.add(new THREE.Mesh(mergeBakedParts(mtnParts), mountainMat));

  return { group, waterMaterial };
}
