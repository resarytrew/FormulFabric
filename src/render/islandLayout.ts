import {
  HEX_DIRS,
  HEX_SIZE,
  hexDistance,
  hexKey,
  hexToWorld,
  parseHexKey,
} from '../engine/hex-math';
import type { AxialCoord, HexKey } from '../engine/types';

export type TerraceKind = 'masonry' | 'turf' | 'crystal';

export interface TerraceHex {
  coord: AxialCoord;
  ring: 1 | 2 | 3;
  x: number;
  z: number;
  y: number;
  depthScale: number;
  kind: TerraceKind;
  angle: number;
  hasTrimRail: boolean;
  hasParapet: boolean;
}

export type LandmarkKind =
  | 'observatory'
  | 'waterfall'
  | 'pergola'
  | 'windvane'
  | 'pylon'
  | 'bonsai'
  | 'blossom'
  | 'beacon'
  | 'boulder'
  | 'crystalCluster';

export interface IslandLandmarkSpot {
  kind: LandmarkKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  seed: number;
}

export interface OrbitShardSpec {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  phase: number;
  hasShrine: boolean;
  tetherStart: { x: number; y: number; z: number };
  tetherEnd: { x: number; y: number; z: number };
}

export interface IslandTerrainLayout {
  maxR: number;
  hasChasm: boolean;
  centerX: number;
  centerZ: number;
  outerWorldR: number;
  edgePlayableKeys: Set<HexKey>;
  terraces: TerraceHex[];
  landmarks: IslandLandmarkSpot[];
  orbitShards: OrbitShardSpec[];
  waterfallAngle: number;
}

function hashCoord(q: number, r: number, salt = 0): number {
  const s = Math.sin(q * 127.1 + r * 311.7 + salt * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Checks if a candidate non-playable hex lies strictly inside an internal chasm
 * (bracketed by playable hexes on opposite sides) so chasm puzzles keep their clear abyssal gaps.
 */
function isInternalChasmGap(
  coord: AxialCoord,
  playableCoords: Array<{ c: AxialCoord; x: number; z: number }>,
): boolean {
  const w = hexToWorld(coord);
  let hasLeft = false;
  let hasRight = false;
  let hasTop = false;
  let hasBottom = false;

  for (const p of playableCoords) {
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    if (Math.abs(dz) < HEX_SIZE * 2.15) {
      if (dx < -HEX_SIZE * 0.6) hasLeft = true;
      if (dx > HEX_SIZE * 0.6) hasRight = true;
    }
    if (Math.abs(dx) < HEX_SIZE * 2.15) {
      if (dz < -HEX_SIZE * 0.6) hasTop = true;
      if (dz > HEX_SIZE * 0.6) hasBottom = true;
    }
    if ((hasLeft && hasRight) || (hasTop && hasBottom)) {
      return true;
    }
  }
  return false;
}

/**
 * Computes a deterministic, multi-tiered floating citadel terrace topology and
 * non-overlapping landmark placements strictly outside `platformHexes`.
 */
export function computeIslandTerrainLayout(
  platformHexes: Set<HexKey>,
  narrowGapHexes?: Set<HexKey>,
): IslandTerrainLayout {
  let maxR = 2;
  let sumX = 0;
  let sumZ = 0;
  const playableList: Array<{ c: AxialCoord; x: number; z: number }> = [];
  const edgePlayableKeys = new Set<HexKey>();

  for (const k of platformHexes) {
    const c = parseHexKey(k);
    const w = hexToWorld(c);
    playableList.push({ c, x: w.x, z: w.z });
    sumX += w.x;
    sumZ += w.z;
    maxR = Math.max(maxR, hexDistance(c, { q: 0, r: 0 }));

    // Edge playable hex if any axial neighbor is outside platform or is a narrow gap
    for (const d of HEX_DIRS) {
      const nk = hexKey({ q: c.q + d.q, r: c.r + d.r });
      if (!platformHexes.has(nk) || narrowGapHexes?.has(nk)) {
        edgePlayableKeys.add(k);
        break;
      }
    }
  }

  const count = Math.max(1, playableList.length);
  const centerX = sumX / count;
  const centerZ = sumZ / count;
  const fullDiskCount = 1 + 3 * maxR * (maxR + 1);
  const hasChasm =
    platformHexes.size < fullDiskCount || (narrowGapHexes?.size ?? 0) > 0;

  // BFS outward 1..3 rings from platformHexes so irregular chasm islands wrap naturally
  const ringMap = new Map<HexKey, { coord: AxialCoord; ring: 1 | 2 | 3 }>();
  let frontier: AxialCoord[] = playableList.map((p) => p.c);

  for (const ring of [1, 2, 3] as const) {
    const nextFrontier: AxialCoord[] = [];
    for (const src of frontier) {
      for (const dir of HEX_DIRS) {
        const nc = { q: src.q + dir.q, r: src.r + dir.r };
        const nk = hexKey(nc);
        if (platformHexes.has(nk) || ringMap.has(nk)) continue;
        // Skip interior holes/chasms so chasm puzzles keep dramatic open abyssal canyons
        if (isInternalChasmGap(nc, playableList)) continue;
        ringMap.set(nk, { coord: nc, ring });
        nextFrontier.push(nc);
      }
    }
    frontier = nextFrontier;
  }

  let maxWorldDist = (maxR + 1.2) * HEX_SIZE * 1.65;
  const terraces: TerraceHex[] = [];

  for (const { coord, ring } of ringMap.values()) {
    const w = hexToWorld(coord);
    const dx = w.x - centerX;
    const dz = w.z - centerZ;
    const angle = Math.atan2(dz, dx); // -PI..PI, where +Z (south/front) is +PI/2, -Z (north/back) is -PI/2
    const h = hashCoord(coord.q, coord.r, 17);
    const h2 = hashCoord(coord.q, coord.r, 53);

    // Organic asymmetric headland silhouette mask for outer rings 2 & 3
    const headlandWave =
      0.5 +
      0.32 * Math.sin(angle * 3 - 0.55) +
      0.22 * Math.cos(angle * 5 + 1.15);

    if (ring === 2 && headlandWave + h * 0.25 < 0.34) continue;
    if (ring === 3 && headlandWave + h * 0.3 < 0.72) continue;

    // South foreground factor: > 0 means front side toward camera (+Z); keep low for unobstructed board visibility
    const southFactor = Math.sin(angle); // +1 south (+Z), -1 north (-Z)
    const eastWest = Math.cos(angle); // +1 east (+X), -1 west (-X)

    let y = -0.24;
    let kind: TerraceKind = 'masonry';

    if (ring === 1) {
      if (southFactor > 0.36) {
        // Front camera rim stays gracefully stepped below the playable deck
        y = -0.24 - (h > 0.6 ? 0.16 : 0);
        kind = h2 > 0.78 ? 'turf' : 'masonry';
      } else if (southFactor < -0.35 && h > 0.32) {
        // Rear upper garden & stone retaining promenade
        y = 0.26 + (h > 0.74 ? 0.22 : 0);
        kind = eastWest > 0.12 || h2 > 0.42 ? 'turf' : 'masonry';
      } else {
        // Flanks alternate warm masonry ledges and lush moss garden beds
        y = h > 0.48 ? 0.22 : -0.2;
        kind = y > 0 ? 'turf' : 'masonry';
      }
    } else if (ring === 2) {
      if (southFactor > 0.38) {
        // Stepped South lookout balconies descending gracefully
        y = -0.48 - h * 0.28;
        kind = h2 > 0.82 ? 'crystal' : 'masonry';
      } else if (eastWest < -0.1 && southFactor < -0.15) {
        // North-West Observatory Acropolis bluff (high tier)
        y = 0.58 + h * 0.26;
        kind = h2 > 0.72 ? 'turf' : 'masonry';
      } else if (eastWest > 0.52 && southFactor > -0.1 && southFactor < 0.55) {
        // East-SE Crystal Spring & Mossy Waterfall Shelf on visible flank
        y = 0.2 + (h > 0.62 ? 0.14 : 0);
        kind = h2 > 0.3 ? 'turf' : 'crystal';
      } else {
        // General scenic flank promontory
        y = southFactor < -0.25 ? 0.36 + h * 0.18 : -0.2 + h * 0.38;
        kind = h2 > 0.38 ? 'turf' : 'masonry';
      }
    } else {
      // Ring 3 outer rocky cliff skerries & cantilevered crystal spurs
      if (southFactor > 0.35) {
        y = -0.82 - h * 0.38;
        kind = 'masonry';
      } else {
        y = -0.38 - h * 0.42 + (southFactor < -0.4 ? 0.26 : 0);
        kind = h2 > 0.55 ? 'turf' : h2 > 0.2 ? 'masonry' : 'crystal';
      }
    }

    const depthScale = Math.max(1.85, 2.75 + y * 1.45 + (ring === 3 ? 0.68 : 0));
    const hasTrimRail = false;
    const hasParapet =
      ring === 2 &&
      kind === 'masonry' &&
      southFactor < 0.15 &&
      y >= 0.24 &&
      h > 0.44;

    const rDist = Math.hypot(dx, dz);
    if (rDist > maxWorldDist) maxWorldDist = rDist;

    terraces.push({
      coord,
      ring,
      x: w.x,
      z: w.z,
      y: Number(y.toFixed(3)),
      depthScale: Number(depthScale.toFixed(3)),
      kind,
      angle,
      hasTrimRail,
      hasParapet,
    });
  }

  const outerWorldR = maxWorldDist + HEX_SIZE * 0.95;

  // Place Hero Landmarks & Botanical/Beacon Props with guaranteed spacing and zero playable-deck occlusion
  const landmarks: IslandLandmarkSpot[] = [];
  const occupiedSpots: Array<{ x: number; z: number; r: number }> = [];

  const isSpotFree = (x: number, z: number, minR: number): boolean => {
    for (const p of playableList) {
      if (Math.hypot(p.x - x, p.z - z) < HEX_SIZE * 1.15) return false;
    }
    for (const occ of occupiedSpots) {
      if (Math.hypot(occ.x - x, occ.z - z) < occ.r + minR) return false;
    }
    return true;
  };

  const reserve = (spot: IslandLandmarkSpot, radius: number) => {
    landmarks.push(spot);
    occupiedSpots.push({ x: spot.x, z: spot.z, r: radius });
  };

  const findBestTerrace = (
    predicate: (t: TerraceHex) => boolean,
    scoreFn: (t: TerraceHex) => number,
    minClearance: number,
  ): TerraceHex | null => {
    let best: TerraceHex | null = null;
    let bestScore = -Infinity;
    for (const t of terraces) {
      if (!predicate(t)) continue;
      if (!isSpotFree(t.x, t.z, minClearance)) continue;
      const sc = scoreFn(t);
      if (sc > bestScore) {
        bestScore = sc;
        best = t;
      }
    }
    return best;
  };

  // 1. Hero Brass Astrolabe Observatory on NNW high bluff (open sky gap between HUD cards)
  const obsTile = findBestTerrace(
    (t) =>
      t.ring >= 2 &&
      Math.cos(t.angle) < 0.08 &&
      Math.sin(t.angle) < -0.42 &&
      t.y >= 0.2,
    (t) => t.y * 4 + (t.ring === 2 ? 2 : 0) - Math.abs(t.angle + 1.85),
    1.5,
  );
  if (obsTile) {
    reserve(
      {
        kind: 'observatory',
        x: obsTile.x,
        y: obsTile.y,
        z: obsTile.z,
        rotY: Math.atan2(obsTile.x - centerX, obsTile.z - centerZ) + Math.PI * 0.15,
        scale: 1.0,
        seed: 11,
      },
      1.55,
    );
  }

  // 2. Crystal Spring & Cascading Sky-Waterfall pouring down the visible ESE flank cliff
  let waterfallAngle = 0.42;
  const wfTile = findBestTerrace(
    (t) =>
      t.ring >= 2 &&
      Math.cos(t.angle) > 0.55 &&
      Math.sin(t.angle) > -0.15 &&
      Math.sin(t.angle) < 0.62 &&
      t.y >= -0.05,
    (t) =>
      (t.ring >= 2 ? 2.4 : 1.0) +
      (t.kind === 'turf' ? 1.0 : 0) -
      Math.abs(t.angle - 0.42) * 2.5,
    1.45,
  );
  if (wfTile) {
    waterfallAngle = wfTile.angle;
    reserve(
      {
        kind: 'waterfall',
        x: wfTile.x,
        y: wfTile.y,
        z: wfTile.z,
        rotY: -wfTile.angle + Math.PI / 2,
        scale: 1.0,
        seed: 23,
      },
      1.5,
    );
  }

  // 3. Sky Wind-Vane Tower on West-SW flank (-X)
  const vaneTile = findBestTerrace(
    (t) =>
      t.ring >= 2 &&
      Math.cos(t.angle) < -0.5 &&
      Math.sin(t.angle) > -0.2 &&
      Math.sin(t.angle) < 0.42,
    (t) => t.y + (t.ring === 2 ? 1.5 : 0.4),
    1.15,
  );
  if (vaneTile) {
    reserve(
      {
        kind: 'windvane',
        x: vaneTile.x,
        y: vaneTile.y,
        z: vaneTile.z,
        rotY: -vaneTile.angle,
        scale: 0.96,
        seed: 37,
      },
      1.15,
    );
  }

  // 4. Carved Stone Arch Pergola on North-East / North garden walk
  const pergolaTile = findBestTerrace(
    (t) =>
      t.ring >= 1 &&
      Math.sin(t.angle) < -0.45 &&
      t.y >= 0.05,
    (t) => t.y * 2 + (t.kind === 'masonry' ? 1.2 : 0.4),
    1.15,
  );
  if (pergolaTile) {
    reserve(
      {
        kind: 'pergola',
        x: pergolaTile.x,
        y: pergolaTile.y,
        z: pergolaTile.z,
        rotY: -pergolaTile.angle + Math.PI / 2,
        scale: 0.96,
        seed: 41,
      },
      1.15,
    );
  }

  // 5. 2-3 Levitating Crystal Conduit Pylons on flanking crystal/stone spurs
  const pylonSectors: Array<{ targetAng: number; seed: number }> = [
    { targetAng: -0.35, seed: 61 },
    { targetAng: 2.55, seed: 67 },
    { targetAng: -1.35, seed: 73 },
  ];
  for (const sec of pylonSectors) {
    const pTile = findBestTerrace(
      (t) => t.ring >= 2 && Math.sin(t.angle) < 0.72,
      (t) =>
        (t.kind === 'crystal' ? 2.5 : 0.6) -
        Math.abs(Math.atan2(Math.sin(t.angle - sec.targetAng), Math.cos(t.angle - sec.targetAng))) *
          3.0,
      1.05,
    );
    if (pTile) {
      reserve(
        {
          kind: 'pylon',
          x: pTile.x,
          y: pTile.y,
          z: pTile.z,
          rotY: -pTile.angle,
          scale: 0.95,
          seed: sec.seed,
        },
        1.05,
      );
    }
  }

  // 6. Multi-species Bonsai & Blossom Groves on turf terraces (avoiding front-south sightline)
  const turfCandidates = terraces
    .filter((t) => t.kind === 'turf' && Math.sin(t.angle) < 0.36 && t.y >= -0.25)
    .sort((a, b) => b.y - a.y || a.angle - b.angle);

  let treeCount = 0;
  for (let i = 0; i < turfCandidates.length && treeCount < 7; i++) {
    const t = turfCandidates[i];
    if (!isSpotFree(t.x, t.z, 0.92)) continue;
    const isBlossom = treeCount % 2 === 1;
    reserve(
      {
        kind: isBlossom ? 'blossom' : 'bonsai',
        x: t.x,
        y: t.y,
        z: t.z,
        rotY: hashCoord(t.coord.q, t.coord.r, 91) * Math.PI * 2,
        scale: 0.86 + hashCoord(t.coord.q, t.coord.r, 92) * 0.24,
        seed: i + 5,
      },
      0.88,
    );
    treeCount++;
  }

  // 7. Architectural Survey Lantern Beacons along front balconies & stepped rims
  const beaconTargets = [-0.85, 0.88, 1.35, 2.05, 2.75, -2.55];
  let beaconCount = 0;
  for (let i = 0; i < beaconTargets.length && beaconCount < 5; i++) {
    const ang = beaconTargets[i];
    const bTile = findBestTerrace(
      (t) => t.y <= 0.38,
      (t) =>
        (t.ring === 1 ? 1.0 : 0.7) -
        Math.abs(Math.atan2(Math.sin(t.angle - ang), Math.cos(t.angle - ang))) * 3.5,
      0.78,
    );
    if (bTile) {
      reserve(
        {
          kind: 'beacon',
          x: bTile.x,
          y: bTile.y,
          z: bTile.z,
          rotY: -bTile.angle,
          scale: Math.sin(bTile.angle) > 0.35 ? 0.78 : 0.92,
          seed: i + 101,
        },
        0.74,
      );
      beaconCount++;
    }
  }

  // 8. Mossy Boulders & Crystal Outcrops to enrich natural rock variety
  let boulderCount = 0;
  for (let i = 0; i < terraces.length && boulderCount < 8; i++) {
    const t = terraces[i];
    if (t.ring < 2) continue;
    if (Math.sin(t.angle) > 0.55) continue;
    if (!isSpotFree(t.x, t.z, 0.75)) continue;
    const h = hashCoord(t.coord.q, t.coord.r, 131);
    if (h < 0.45) continue;
    reserve(
      {
        kind: t.kind === 'crystal' || h > 0.82 ? 'crystalCluster' : 'boulder',
        x: t.x,
        y: t.y,
        z: t.z,
        rotY: h * Math.PI * 2,
        scale: 0.72 + (h - 0.45) * 0.7,
        seed: i + 200,
      },
      0.7,
    );
    boulderCount++;
  }

  // 9. 5 Nearby Orbiting Levitating Rock Shards tethered directly to real outer cliff terraces
  const shardAngles = [-2.42, -1.62, -0.78, 0.08, 2.74];
  const orbitShards: OrbitShardSpec[] = shardAngles.map((ang, idx) => {
    // Anchor tether onto the furthest real terrace along this azimuth so cables never float in air on chasm maps
    let anchorTerrace: TerraceHex | null = null;
    let bestAnchorScore = -Infinity;
    for (const t of terraces) {
      const dAng = Math.abs(Math.atan2(Math.sin(t.angle - ang), Math.cos(t.angle - ang)));
      if (dAng > 0.55) continue;
      const r = Math.hypot(t.x - centerX, t.z - centerZ);
      const sc = r - dAng * 6.0;
      if (sc > bestAnchorScore) {
        bestAnchorScore = sc;
        anchorTerrace = t;
      }
    }
    const anchorX = anchorTerrace ? anchorTerrace.x : centerX + Math.cos(ang) * (outerWorldR - 1.3);
    const anchorY = anchorTerrace ? anchorTerrace.y - 0.32 : -0.55;
    const anchorZ = anchorTerrace ? anchorTerrace.z : centerZ + Math.sin(ang) * (outerWorldR - 1.3);
    const anchorDist = Math.hypot(anchorX - centerX, anchorZ - centerZ);

    const dist = Math.max(outerWorldR + 0.75, anchorDist + 2.45) + (idx % 2) * 0.65;
    const sx = centerX + Math.cos(ang) * dist;
    const sz = centerZ + Math.sin(ang) * dist;
    const sy = 0.68 + ((idx % 3) - 1) * 0.65;
    return {
      x: Number(sx.toFixed(3)),
      y: Number(sy.toFixed(3)),
      z: Number(sz.toFixed(3)),
      scale: idx === 1 || idx === 3 ? 0.92 : 0.74,
      rotY: ang + Math.PI * 0.4,
      phase: idx * 1.45,
      hasShrine: idx % 2 === 0,
      tetherStart: {
        x: Number(anchorX.toFixed(3)),
        y: Number(anchorY.toFixed(3)),
        z: Number(anchorZ.toFixed(3)),
      },
      tetherEnd: {
        x: Number(sx.toFixed(3)),
        y: Number((sy - 0.35).toFixed(3)),
        z: Number(sz.toFixed(3)),
      },
    };
  });

  return {
    maxR,
    hasChasm,
    centerX,
    centerZ,
    outerWorldR,
    edgePlayableKeys,
    terraces,
    landmarks,
    orbitShards,
    waterfallAngle,
  };
}
