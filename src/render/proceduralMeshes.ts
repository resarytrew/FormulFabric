import * as THREE from 'three';
import {
  dirToWorldYaw,
  HEX_SIZE,
  hexKey,
  hexNeighbor,
  hexToWorld,
  oppositeDir,
  rotateDir,
} from '../engine/hex-math';
import type { AxialCoord, HexDir, HexKey, MachineInstance, MachineType } from '../engine/types';
import {
  addInkOutline,
  createBillboardSignTexture,
  createCelMaterial,
  createInlaidChannelMaterial,
  createSymbolDecalTexture,
  createTokenNumberTexture,
  getSoftContactShadowTexture,
  getTokenPaletteColor,
  type PaletteThemeId,
  type ThemePalette,
} from './celMaterials';

function createHexShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

let sharedHexTileGeo: THREE.ExtrudeGeometry | null = null;
let sharedHexEdgesGeo: THREE.EdgesGeometry | null = null;
let sharedHexHitGeo: THREE.CylinderGeometry | null = null;
let sharedContactShadowGeo: THREE.PlaneGeometry | null = null;

export function getSharedHexTileGeometry(): THREE.ExtrudeGeometry {
  if (sharedHexTileGeo) return sharedHexTileGeo;
  // Slightly inset base with smooth 3-segment chamfered top edge so tiles catch light & leave clean recessed seams
  const shape = createHexShape(HEX_SIZE * 0.916);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.38,
    bevelEnabled: true,
    bevelThickness: 0.056,
    bevelSize: 0.052,
    bevelSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.436, 0);
  geo.userData.isShared = true;
  sharedHexTileGeo = geo;
  return geo;
}

export function getSharedHexEdgesGeometry(): THREE.EdgesGeometry {
  if (sharedHexEdgesGeo) return sharedHexEdgesGeo;
  sharedHexEdgesGeo = new THREE.EdgesGeometry(getSharedHexTileGeometry(), 36);
  sharedHexEdgesGeo.userData.isShared = true;
  return sharedHexEdgesGeo;
}

export function getSharedHexHitGeometry(): THREE.CylinderGeometry {
  if (sharedHexHitGeo) return sharedHexHitGeo;
  sharedHexHitGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.95, HEX_SIZE * 0.95, 0.25, 6);
  sharedHexHitGeo.userData.isShared = true;
  return sharedHexHitGeo;
}

let sharedHexGridRingGeo: THREE.RingGeometry | null = null;
export function getSharedHexGridRingGeometry(): THREE.RingGeometry {
  if (sharedHexGridRingGeo) return sharedHexGridRingGeo;
  const geo = new THREE.RingGeometry(HEX_SIZE * 0.878, HEX_SIZE * 0.91, 6);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 6);
  geo.userData.isShared = true;
  sharedHexGridRingGeo = geo;
  return geo;
}

export function getSharedContactShadowGeo(): THREE.PlaneGeometry {
  if (sharedContactShadowGeo) return sharedContactShadowGeo;
  sharedContactShadowGeo = new THREE.PlaneGeometry(1, 1);
  sharedContactShadowGeo.rotateX(-Math.PI / 2);
  sharedContactShadowGeo.userData.isShared = true;
  return sharedContactShadowGeo;
}

function createChevronGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.13, -0.27);
  s.lineTo(0.05, -0.27);
  s.lineTo(0.21, 0);
  s.lineTo(0.05, 0.27);
  s.lineTo(-0.13, 0.27);
  s.lineTo(0.03, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.052,
    bevelEnabled: true,
    bevelThickness: 0.013,
    bevelSize: 0.013,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function createCogGeometry(
  outerR: number,
  innerR: number,
  teeth: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / (teeth * 2);
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a0 = i * step;
    const a1 = a0 + step * 0.72;
    const x0 = Math.cos(a0) * r;
    const y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r;
    const y1 = Math.sin(a1) * r;
    if (i === 0) shape.moveTo(x0, y0);
    else shape.lineTo(x0, y0);
    shape.lineTo(x1, y1);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Spoked industrial flywheel oriented in XY plane (rotates cleanly around local Z axis)
 * with an eccentric crank pin for visible mechanical motion.
 */
function createSpokedFlywheel(
  radius: number,
  rimColor: number,
  hubColor: number,
  pinColor: number,
  inkColor: number,
): THREE.Group {
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.17, 8, 18),
    createCelMaterial(rimColor),
  );
  addInkOutline(rim, inkColor, 0.013);
  wheel.add(rim);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, radius * 0.36, 10),
    createCelMaterial(hubColor),
  );
  hub.rotation.x = Math.PI / 2;
  addInkOutline(hub, inkColor, 0.011);
  wheel.add(hub);

  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 1.82, radius * 0.15, radius * 0.14),
      createCelMaterial(hubColor),
    );
    spoke.rotation.z = (i * Math.PI) / 3;
    addInkOutline(spoke, inkColor, 0.009);
    wheel.add(spoke);
  }

  const crankPin = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.13, radius * 0.13, radius * 0.42, 8),
    createCelMaterial(pinColor),
  );
  crankPin.rotation.x = Math.PI / 2;
  crankPin.position.set(radius * 0.62, 0, radius * 0.14);
  addInkOutline(crankPin, inkColor, 0.009);
  wheel.add(crankPin);

  return wheel;
}

let sharedChevronGeo: THREE.ExtrudeGeometry | null = null;
function getChevronGeo(): THREE.ExtrudeGeometry {
  if (!sharedChevronGeo) {
    sharedChevronGeo = createChevronGeometry();
    sharedChevronGeo.userData.isShared = true;
  }
  return sharedChevronGeo;
}

let sharedDirArrowGeo: THREE.ExtrudeGeometry | null = null;
function getDirArrowGeo(): THREE.ExtrudeGeometry {
  if (sharedDirArrowGeo) return sharedDirArrowGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.085, -0.115);
  s.lineTo(0.015, -0.115);
  s.lineTo(0.14, 0);
  s.lineTo(0.015, 0.115);
  s.lineTo(-0.085, 0.115);
  s.lineTo(-0.02, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.014,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.025, 0);
  geo.userData.isShared = true;
  sharedDirArrowGeo = geo;
  return sharedDirArrowGeo;
}

let sharedCogGeo: THREE.ExtrudeGeometry | null = null;
function getCogGeo(): THREE.ExtrudeGeometry {
  if (!sharedCogGeo) {
    sharedCogGeo = createCogGeometry(0.28, 0.2, 8, 0.06);
    sharedCogGeo.userData.isShared = true;
  }
  return sharedCogGeo;
}

let sharedSmallCogGeo: THREE.ExtrudeGeometry | null = null;
function getSmallCogGeo(): THREE.ExtrudeGeometry {
  if (!sharedSmallCogGeo) {
    sharedSmallCogGeo = createCogGeometry(0.145, 0.105, 8, 0.055);
    sharedSmallCogGeo.rotateX(Math.PI / 2);
    sharedSmallCogGeo.userData.isShared = true;
  }
  return sharedSmallCogGeo;
}

let sharedBoltGeo: THREE.CylinderGeometry | null = null;
function getBoltGeo(): THREE.CylinderGeometry {
  if (!sharedBoltGeo) {
    sharedBoltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 6);
    sharedBoltGeo.userData.isShared = true;
  }
  return sharedBoltGeo;
}

let sharedConveyorBeltGeo: THREE.ExtrudeGeometry | null = null;
function getConveyorBeltGeo(): THREE.ExtrudeGeometry {
  if (sharedConveyorBeltGeo) return sharedConveyorBeltGeo;
  const r = 0.046;
  const halfLen = 0.57;
  const shape = new THREE.Shape();
  shape.moveTo(-halfLen, -r);
  shape.lineTo(halfLen, -r);
  shape.absarc(halfLen, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-halfLen, r);
  shape.absarc(-halfLen, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.78,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geo.translate(0, 0.108, -0.39);
  geo.userData.isShared = true;
  sharedConveyorBeltGeo = geo;
  return geo;
}

let sharedConveyorRailGeo: THREE.ExtrudeGeometry | null = null;
function getConveyorRailGeo(): THREE.ExtrudeGeometry {
  if (sharedConveyorRailGeo) return sharedConveyorRailGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.74, 0.06);
  s.lineTo(0.74, 0.06);
  s.lineTo(0.68, 0.21);
  s.lineTo(-0.68, 0.21);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.095,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.014,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -0.0475);
  geo.userData.isShared = true;
  sharedConveyorRailGeo = geo;
  return geo;
}

let sharedTokenBodyGeo: THREE.LatheGeometry | null = null;
function getTokenBodyGeo(): THREE.LatheGeometry {
  if (sharedTokenBodyGeo) return sharedTokenBodyGeo;
  const pts = [
    new THREE.Vector2(0.001, 0.08),
    new THREE.Vector2(0.54, 0.08),
    new THREE.Vector2(0.59, 0.115),
    new THREE.Vector2(0.59, 0.205),
    new THREE.Vector2(0.545, 0.228),
    new THREE.Vector2(0.575, 0.25),
    new THREE.Vector2(0.575, 0.34),
    new THREE.Vector2(0.52, 0.365),
    new THREE.Vector2(0.001, 0.365),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.userData.isShared = true;
  sharedTokenBodyGeo = geo;
  return geo;
}

let sharedTokenRimGeo: THREE.TorusGeometry | null = null;
function getTokenRimGeo(): THREE.TorusGeometry {
  if (sharedTokenRimGeo) return sharedTokenRimGeo;
  const geo = new THREE.TorusGeometry(0.525, 0.042, 8, 22);
  geo.rotateX(Math.PI / 2);
  geo.userData.isShared = true;
  sharedTokenRimGeo = geo;
  return geo;
}

let sharedTokenCapGeo: THREE.CircleGeometry | null = null;
function getTokenCapGeo(): THREE.CircleGeometry {
  if (sharedTokenCapGeo) return sharedTokenCapGeo;
  const geo = new THREE.CircleGeometry(0.495, 22);
  geo.rotateX(-Math.PI / 2);
  geo.userData.isShared = true;
  sharedTokenCapGeo = geo;
  return geo;
}

function addCornerBolts(
  group: THREE.Group,
  positions: Array<[number, number, number]>,
  color: number,
  inkColor: number,
) {
  const boltGeo = getBoltGeo();
  const mat = createCelMaterial(color);
  for (const [x, y, z] of positions) {
    const bolt = new THREE.Mesh(boltGeo, mat);
    bolt.position.set(x, y, z);
    addInkOutline(bolt, inkColor, 0.008);
    group.add(bolt);
  }
}

function createHexPadBase(palette: ThemePalette, color: number, height = 0.14): THREE.Group {
  const group = new THREE.Group();
  const padGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.82, HEX_SIZE * 0.88, height, 6);
  const padMesh = new THREE.Mesh(padGeo, createCelMaterial(color));
  padMesh.position.y = height * 0.5;
  padMesh.castShadow = true;
  padMesh.receiveShadow = true;
  addInkOutline(padMesh, palette.ink, 0.025);
  group.add(padMesh);

  // Beveled directional chevron fin on front edge (+X)
  const dirFin = new THREE.Mesh(
    getDirArrowGeo(),
    createCelMaterial(palette.accent, { roughness: 0.38, metalness: 0.15 }),
  );
  dirFin.position.set(HEX_SIZE * 0.7, height + 0.035, 0);
  addInkOutline(dirFin, palette.ink, 0.014);
  group.add(dirFin);

  return group;
}

function addDecalDisc(
  group: THREE.Group,
  symbol: string,
  bgHex: string,
  fgHex: string,
  inkHex: string,
  yPos: number,
  radius: number,
  maxAniso: number,
  subLabel?: string,
) {
  const tex = createSymbolDecalTexture(symbol, bgHex, fgHex, inkHex, maxAniso, subLabel);
  const discGeo = new THREE.CircleGeometry(radius, 24);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({
    map: tex,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = yPos;
  disc.rotation.y = Math.PI * 0.15;
  group.add(disc);
}

function addOverheadSignSprite(
  group: THREE.Group,
  text: string,
  bgColor: string,
  fgColor: string,
  borderColor: string,
  pos: [number, number, number],
  scale: [number, number],
  maxAniso: number,
  emitterY = 0.72,
) {
  // Subtle vertical holographic light cone anchoring badge to machine
  const coneHeight = Math.max(0.18, pos[1] - emitterY - 0.08);
  const coneMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(borderColor),
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(scale[0] * 0.26, 0.07, coneHeight, 12, 1, true),
    coneMat,
  );
  cone.position.set(pos[0], emitterY + coneHeight * 0.5, pos[2]);
  group.add(cone);

  // Tiny glowing projector emitter ring
  const emitterDot = new THREE.Mesh(
    new THREE.RingGeometry(0.04, 0.08, 12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(borderColor),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  emitterDot.rotation.x = -Math.PI / 2;
  emitterDot.position.set(pos[0], emitterY + 0.005, pos[2]);
  group.add(emitterDot);

  const tex = createBillboardSignTexture(text, bgColor, fgColor, borderColor, maxAniso);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(pos[0], pos[1], pos[2]);
  sprite.scale.set(scale[0], scale[1], 1);
  sprite.renderOrder = 10;
  group.add(sprite);
}

export function buildMachineMesh(
  machine: MachineInstance,
  palette: ThemePalette,
  maxAniso: number,
): THREE.Group {
  const root = new THREE.Group();
  const inkStr = `#${new THREE.Color(palette.ink).getHexString()}`;
  const topStr = `#${new THREE.Color(palette.machineTop).getHexString()}`;
  const accentStr = `#${new THREE.Color(palette.accent).getHexString()}`;

  const type: MachineType = machine.type;
  const yaw = dirToWorldYaw(machine.config.dir);
  root.rotation.y = yaw;

  if (type === 'spawner') {
    // Pneumatic Hopper Press & Crank-Driven Feeder with sight-glass gauge & twin discharge rollers
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * 0.82, HEX_SIZE * 0.88, 0.14, 6),
      createCelMaterial(palette.machineBase),
    );
    plinth.position.y = 0.07;
    plinth.receiveShadow = true;
    addInkOutline(plinth, palette.ink, 0.025);
    root.add(plinth);

    addCornerBolts(
      root,
      [
        [-0.58, 0.15, -0.35],
        [-0.58, 0.15, 0.35],
        [0.45, 0.15, -0.45],
        [0.45, 0.15, 0.45],
      ],
      palette.sinkGlow,
      palette.ink,
    );

    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.63, 0.62, 12),
      createCelMaterial(palette.machineTop),
    );
    silo.position.set(-0.08, 0.45, 0);
    silo.castShadow = true;
    addInkOutline(silo, palette.ink, 0.028);
    root.add(silo);

    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6 + Math.PI / 6;
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.56, 0.075),
        createCelMaterial(palette.machineBase),
      );
      rib.position.set(-0.08 + Math.cos(a) * 0.58, 0.45, Math.sin(a) * 0.58);
      rib.rotation.y = -a;
      addInkOutline(rib, palette.ink, 0.011);
      root.add(rib);
    }

    // Illuminated sight-glass inspection slot on front-left of silo
    const sightSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.34, 0.14),
      createCelMaterial(palette.sinkGlow, { emissive: palette.accent, emissiveIntensity: 0.35 }),
    );
    sightSlot.position.set(0.38, 0.45, -0.32);
    sightSlot.rotation.y = 0.65;
    addInkOutline(sightSlot, palette.ink, 0.012);
    root.add(sightSlot);

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.51, 0.57, 0.12, 12),
      createCelMaterial(palette.accent),
    );
    collar.position.set(-0.08, 0.82, 0);
    addInkOutline(collar, palette.ink, 0.022);
    root.add(collar);

    const archBridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.72),
      createCelMaterial(palette.machineBase),
    );
    archBridge.position.set(-0.08, 0.98, 0);
    addInkOutline(archBridge, palette.ink, 0.016);
    root.add(archBridge);

    const pistonGroup = new THREE.Group();
    pistonGroup.position.set(-0.08, 1.05, 0);
    pistonGroup.userData.animType = 'spawnerPiston';
    const pistonHead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10),
      createCelMaterial(palette.sinkGlow),
    );
    pistonHead.position.y = 0.14;
    addInkOutline(pistonHead, palette.ink, 0.015);
    pistonGroup.add(pistonHead);
    const pistonRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.28, 8),
      createCelMaterial(palette.accent),
    );
    pistonRod.position.y = 0.02;
    addInkOutline(pistonRod, palette.ink, 0.012);
    pistonGroup.add(pistonRod);
    root.add(pistonGroup);

    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.11, 0.34, 8),
      createCelMaterial(palette.machineBase),
    );
    stack.position.set(-0.46, 0.92, -0.26);
    addInkOutline(stack, palette.ink, 0.015);
    root.add(stack);

    const rotaryDial = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.sinkGlow));
    rotaryDial.position.set(-0.42, 0.9, 0.24);
    rotaryDial.scale.setScalar(0.65);
    rotaryDial.userData.animType = 'steamWheel';
    addInkOutline(rotaryDial, palette.ink, 0.012);
    root.add(rotaryDial);

    const flywheel = createSpokedFlywheel(0.24, palette.accent, palette.sinkGlow, palette.machineBase, palette.ink);
    flywheel.position.set(-0.08, 0.5, 0.64);
    flywheel.userData.animType = 'flywheelZ';
    root.add(flywheel);

    const crankRod = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.42, 0.045),
      createCelMaterial(palette.sinkGlow),
    );
    crankRod.position.set(-0.08, 0.72, 0.69);
    crankRod.userData.animType = 'spawnerCrankRod';
    addInkOutline(crankRod, palette.ink, 0.01);
    root.add(crankRod);

    const chuteFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.48, 0.58),
      createCelMaterial(palette.machineBase),
    );
    chuteFrame.position.set(0.5, 0.34, 0);
    addInkOutline(chuteFrame, palette.ink, 0.02);
    root.add(chuteFrame);

    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.06, 0.48),
      createCelMaterial(palette.machineTop),
    );
    ramp.position.set(0.65, 0.14, 0);
    ramp.rotation.z = -0.14;
    addInkOutline(ramp, palette.ink, 0.014);
    root.add(ramp);

    // Chute exit feed roller
    const feedRoller = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.46, 8),
      createCelMaterial(palette.accent),
    );
    feedRoller.rotation.x = Math.PI / 2;
    feedRoller.position.set(0.76, 0.11, 0);
    feedRoller.userData.animType = 'conveyorRoller';
    addInkOutline(feedRoller, palette.ink, 0.011);
    root.add(feedRoller);

    const gatePivot = new THREE.Group();
    gatePivot.position.set(0.61, 0.54, 0);
    gatePivot.userData.animType = 'spawnerGate';
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.38, 0.46),
      createCelMaterial(palette.sinkGlow),
    );
    door.position.set(0, -0.2, 0);
    addInkOutline(door, palette.ink, 0.016);
    gatePivot.add(door);
    root.add(gatePivot);

    addOverheadSignSprite(
      root,
      'ВХОД',
      palette.holoBg,
      palette.holoText,
      palette.holoBorder,
      [-0.08, 1.56, 0],
      [1.06, 0.44],
      maxAniso,
      1.16,
    );
  } else if (type === 'conveyor') {
    // Industrial Tensioned-Belt Conveyor: stadium rubber loop, extruded C-channel rails, pillow bearings, drive motor + meshing gears, 6 wrap-around cleats & side direction arrows
    const bed = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * 0.84, HEX_SIZE * 0.88, 0.075, 6),
      createCelMaterial(palette.machineBase),
    );
    bed.position.y = 0.0375;
    bed.receiveShadow = true;
    addInkOutline(bed, palette.ink, 0.024);
    root.add(bed);

    addCornerBolts(
      root,
      [
        [-0.6, 0.085, -0.35],
        [-0.6, 0.085, 0.35],
        [0.6, 0.085, -0.35],
        [0.6, 0.085, 0.35],
      ],
      palette.sinkGlow,
      palette.ink,
    );

    // Continuous stadium tensioned belt loop wrapping around both drums
    const beltLoop = new THREE.Mesh(getConveyorBeltGeo(), createCelMaterial(palette.ink));
    beltLoop.receiveShadow = true;
    addInkOutline(beltLoop, palette.ink, 0.01);
    root.add(beltLoop);

    // Beveled extruded C-channel side frames + top trim + axle pillow bearings
    const railGeo = getConveyorRailGeo();
    const endDrumGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.14, 10);
    endDrumGeo.rotateX(Math.PI / 2);
    const sideChevronGeo = getChevronGeo();

    for (const zSide of [-0.47, 0.47]) {
      const rail = new THREE.Mesh(railGeo, createCelMaterial(palette.machineTop));
      rail.position.z = zSide;
      rail.castShadow = true;
      addInkOutline(rail, palette.ink, 0.017);
      root.add(rail);

      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(HEX_SIZE * 1.28, 0.038, 0.125),
        createCelMaterial(palette.machineBase),
      );
      lip.position.set(0, 0.225, zSide);
      addInkOutline(lip, palette.ink, 0.011);
      root.add(lip);

      // Embossed direction indicator chevrons on top lip of side rails
      const sideSign = Math.sign(zSide);
      const guideChev = new THREE.Mesh(sideChevronGeo, createCelMaterial(palette.sinkGlow));
      guideChev.scale.set(0.45, 0.55, 0.24);
      guideChev.position.set(0.24, 0.246, zSide + sideSign * 0.005);
      root.add(guideChev);

      for (const xEnd of [-0.59, 0.59]) {
        const cap = new THREE.Mesh(endDrumGeo, createCelMaterial(palette.accent));
        cap.position.set(xEnd, 0.115, zSide);
        cap.userData.animType = 'conveyorRoller';
        addInkOutline(cap, palette.ink, 0.013);
        root.add(cap);
      }
    }

    // Finned side-mounted electric drive motor + junction box + dual meshing gears on +Z rail
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.3, 10),
      createCelMaterial(palette.accentSecondary),
    );
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-0.34, 0.145, 0.625);
    addInkOutline(motor, palette.ink, 0.015);
    root.add(motor);

    for (let f = 0; f < 3; f++) {
      const fin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.132, 0.132, 0.025, 10),
        createCelMaterial(palette.machineBase),
      );
      fin.rotation.z = Math.PI / 2;
      fin.position.set(-0.43 + f * 0.085, 0.145, 0.625);
      root.add(fin);
    }

    const driveBeltBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.075, 0.045),
      createCelMaterial(palette.machineBase),
    );
    driveBeltBar.position.set(-0.08, 0.145, 0.585);
    addInkOutline(driveBeltBar, palette.ink, 0.01);
    root.add(driveBeltBar);

    const driveGearGeo = getSmallCogGeo();
    for (let gi = 0; gi < 2; gi++) {
      const gx = gi === 0 ? -0.17 : 0.09;
      const driveGear = new THREE.Mesh(driveGearGeo, createCelMaterial(palette.sinkGlow));
      driveGear.position.set(gx, 0.145, 0.56);
      driveGear.userData.animType = 'conveyorGear';
      driveGear.userData.gearSign = gi === 0 ? -1 : 1;
      addInkOutline(driveGear, palette.ink, 0.01);
      root.add(driveGear);
    }

    // 5 spinning hexagonal drive rollers with bright end bearings
    const rollerGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.84, 6);
    rollerGeo.rotateX(Math.PI / 2);
    const bearingGeo = new THREE.CylinderGeometry(0.072, 0.072, 0.055, 6);
    bearingGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const rx = -0.54 + i * 0.27;
      const roller = new THREE.Mesh(rollerGeo, createCelMaterial(palette.machineBase));
      roller.position.set(rx, 0.108, 0);
      roller.userData.animType = 'conveyorRoller';
      root.add(roller);

      for (const zB of [-0.38, 0.38]) {
        const bearing = new THREE.Mesh(bearingGeo, createCelMaterial(palette.sinkGlow));
        bearing.position.set(rx, 0.108, zB);
        bearing.userData.animType = 'conveyorRoller';
        root.add(bearing);
      }
    }

    // 6 animated looping 3D chevron cleats wrapping cleanly around front/rear drums
    for (let i = 0; i < 6; i++) {
      const chev = new THREE.Mesh(
        getChevronGeo(),
        createCelMaterial(i % 2 === 0 ? palette.sinkGlow : palette.accent),
      );
      chev.position.set(-0.55 + i * 0.22, 0.15, 0);
      chev.userData.animType = 'conveyorTread';
      chev.userData.treadIdx = i;
      chev.userData.treadCount = 6;
      addInkOutline(chev, palette.ink, 0.013);
      root.add(chev);
    }
  } else if (type === 'pusher') {
    // Hydraulic Ram Press with horizontal machined slideways, pressure gauge needle, finned cylinder, 4-coil return spring & cushioned bumper plate
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.84, 0.14, 6),
      createCelMaterial(palette.machineBase),
    );
    plinth.position.y = 0.07;
    plinth.receiveShadow = true;
    addInkOutline(plinth, palette.ink, 0.025);
    root.add(plinth);

    addCornerBolts(
      root,
      [
        [-0.55, 0.15, -0.35],
        [-0.55, 0.15, 0.35],
        [0.45, 0.15, -0.45],
        [0.45, 0.15, 0.45],
      ],
      palette.sinkGlow,
      palette.ink,
    );

    // Lower machined guide slideway rails supporting the ram path
    for (const zSlide of [-0.24, 0.24]) {
      const gusset = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.36, 0.09),
        createCelMaterial(palette.machineBase),
      );
      gusset.position.set(-0.34, 0.28, zSlide);
      addInkOutline(gusset, palette.ink, 0.016);
      root.add(gusset);

      const slideRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 0.06, 0.07),
        createCelMaterial(palette.machineTop),
      );
      slideRail.position.set(0.28, 0.17, zSlide);
      addInkOutline(slideRail, palette.ink, 0.011);
      root.add(slideRail);
    }

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.3, 0.56, 12),
      createCelMaterial(palette.machineTop),
    );
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(-0.22, 0.42, 0);
    barrel.castShadow = true;
    addInkOutline(barrel, palette.ink, 0.024);
    root.add(barrel);

    for (let f = 0; f < 3; f++) {
      const fin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.33, 0.33, 0.045, 12),
        createCelMaterial(palette.machineBase),
      );
      fin.rotation.z = Math.PI / 2;
      fin.position.set(-0.38 + f * 0.15, 0.42, 0);
      addInkOutline(fin, palette.ink, 0.012);
      root.add(fin);
    }

    // Side pressure gauge dial with animated needle
    const gaugeHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.07, 12),
      createCelMaterial(palette.sinkGlow),
    );
    gaugeHousing.rotation.x = Math.PI / 2;
    gaugeHousing.position.set(-0.26, 0.62, 0.34);
    addInkOutline(gaugeHousing, palette.ink, 0.012);
    root.add(gaugeHousing);

    const needlePivot = new THREE.Group();
    needlePivot.position.set(-0.26, 0.62, 0.39);
    needlePivot.userData.animType = 'pusherGauge';
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.1, 0.02),
      createCelMaterial(palette.accent),
    );
    needle.position.y = 0.035;
    needlePivot.add(needle);
    root.add(needlePivot);

    const dome = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.19, 0.14, 10),
      createCelMaterial(palette.accent),
    );
    dome.position.set(-0.22, 0.74, 0);
    addInkOutline(dome, palette.ink, 0.016);
    root.add(dome);

    const valveCog = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.sinkGlow));
    valveCog.position.set(-0.22, 0.83, 0);
    valveCog.scale.setScalar(0.55);
    valveCog.userData.animType = 'steamWheel';
    addInkOutline(valveCog, palette.ink, 0.012);
    root.add(valveCog);

    const bushing = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.38, 0.56),
      createCelMaterial(palette.machineBase),
    );
    bushing.position.set(0.12, 0.38, 0);
    addInkOutline(bushing, palette.ink, 0.018);
    root.add(bushing);

    const coilGroup = new THREE.Group();
    coilGroup.position.set(0.18, 0.42, 0);
    coilGroup.userData.animType = 'pusherCoil';
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.032, 6, 12),
        createCelMaterial(palette.sinkGlow),
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = 0.05 + i * 0.08;
      addInkOutline(ring, palette.ink, 0.011);
      coilGroup.add(ring);
    }
    root.add(coilGroup);

    const ramGroup = new THREE.Group();
    ramGroup.userData.animType = 'pusher';
    for (const zOff of [-0.18, 0.18]) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8),
        createCelMaterial(palette.sinkGlow),
      );
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0.32, 0.42, zOff);
      addInkOutline(rod, palette.ink, 0.014);
      ramGroup.add(rod);
    }

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.48, 0.62),
      createCelMaterial(palette.accent),
    );
    plate.position.set(0.64, 0.4, 0);
    plate.castShadow = true;
    addInkOutline(plate, palette.ink, 0.022);
    ramGroup.add(plate);

    for (const zRib of [-0.18, 0, 0.18]) {
      const bumper = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.36, 0.1),
        createCelMaterial(palette.machineBase),
      );
      bumper.position.set(0.72, 0.4, zRib);
      addInkOutline(bumper, palette.ink, 0.012);
      ramGroup.add(bumper);
    }
    root.add(ramGroup);
  } else if (type === 'magnet') {
    // Electromagnetic Crane Core: transformer pack, cooling fan, busbars, laminated U-yoke, induction bobbins, pole shoes, & 3 flux wave arcs
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.84, 0.14, 6),
      createCelMaterial(palette.machineBase),
    );
    plinth.position.y = 0.07;
    plinth.receiveShadow = true;
    addInkOutline(plinth, palette.ink, 0.025);
    root.add(plinth);

    const xfmr = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.38, 0.52),
      createCelMaterial(palette.accentSecondary),
    );
    xfmr.position.set(-0.46, 0.33, 0);
    xfmr.castShadow = true;
    addInkOutline(xfmr, palette.ink, 0.02);
    root.add(xfmr);

    const fanRotor = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.sinkGlow));
    fanRotor.position.set(-0.46, 0.54, 0);
    fanRotor.scale.setScalar(0.65);
    fanRotor.userData.animType = 'steamWheel';
    addInkOutline(fanRotor, palette.ink, 0.012);
    root.add(fanRotor);

    for (const zBus of [-0.18, 0.18]) {
      const busbar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.28, 6),
        createCelMaterial(palette.accent),
      );
      busbar.rotation.z = Math.PI / 2;
      busbar.position.set(-0.28, 0.44, zBus);
      addInkOutline(busbar, palette.ink, 0.009);
      root.add(busbar);
    }

    const yoke = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.115, 10, 20, Math.PI),
      createCelMaterial(palette.machineTop),
    );
    yoke.rotation.x = Math.PI / 2;
    yoke.rotation.z = Math.PI / 2;
    yoke.position.set(-0.04, 0.36, 0);
    yoke.castShadow = true;
    addInkOutline(yoke, palette.ink, 0.022);
    root.add(yoke);

    for (const zOff of [-0.34, 0.34]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.115, 0.38, 10),
        createCelMaterial(palette.machineTop),
      );
      arm.rotation.z = Math.PI / 2;
      arm.position.set(0.15, 0.36, zOff);
      addInkOutline(arm, palette.ink, 0.02);
      root.add(arm);

      for (let c = 0; c < 3; c++) {
        const coil = new THREE.Mesh(
          new THREE.TorusGeometry(0.135, 0.03, 6, 12),
          createCelMaterial(c % 2 === 0 ? palette.sinkGlow : palette.accent),
        );
        coil.rotation.y = Math.PI / 2;
        coil.position.set(0.06 + c * 0.1, 0.36, zOff);
        addInkOutline(coil, palette.ink, 0.011);
        root.add(coil);
      }

      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.138, 0.125, 0.15, 10),
        createCelMaterial(palette.accent, { emissive: palette.accent, emissiveIntensity: 0.25 }),
      );
      tip.rotation.z = Math.PI / 2;
      tip.position.set(0.4, 0.36, zOff);
      tip.userData.animType = 'magnetPole';
      addInkOutline(tip, palette.ink, 0.02);
      root.add(tip);
    }

    const waveGeo = new THREE.TorusGeometry(0.3, 0.025, 6, 14, Math.PI * 0.65);
    waveGeo.rotateX(Math.PI / 2);
    for (let w = 0; w < 3; w++) {
      const wave = new THREE.Mesh(
        waveGeo,
        createCelMaterial(palette.accent, { emissive: palette.accent, emissiveIntensity: 0.75 }),
      );
      wave.rotation.y = Math.PI * 0.325;
      wave.position.set(0.65 + w * 0.25, 0.36, 0);
      wave.userData.animType = 'magnetArc';
      wave.userData.waveIdx = w;
      root.add(wave);
    }
  } else if (type === 'rotator') {
    // 3-Axis Robotic Pick-and-Place Turret: slew-ring planetary gear + meshing pinion + lifting arm + telescoping truss boom + servo claws
    const isCCW = machine.config.rotMode === 'ccw';

    const baseGear = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.machineBase));
    baseGear.position.y = 0.02;
    baseGear.scale.set(2.35, 1.35, 2.35);
    baseGear.userData.animType = 'rotatorGear';
    baseGear.userData.cw = !isCCW;
    addInkOutline(baseGear, palette.ink, 0.015);
    root.add(baseGear);

    const pinion = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.accent));
    pinion.position.set(-0.62, 0.06, -0.45);
    pinion.scale.set(0.85, 1.5, 0.85);
    pinion.userData.animType = 'rotatorGear';
    pinion.userData.cw = isCCW;
    addInkOutline(pinion, palette.ink, 0.012);
    root.add(pinion);

    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.54, 0.68, 12),
      createCelMaterial(palette.machineTop),
    );
    turret.position.y = 0.42;
    turret.castShadow = true;
    addInkOutline(turret, palette.ink, 0.028);
    root.add(turret);

    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.56, 0.075),
        createCelMaterial(palette.machineBase),
      );
      rib.position.set(Math.cos(a) * 0.49, 0.4, Math.sin(a) * 0.49);
      rib.rotation.y = -a;
      addInkOutline(rib, palette.ink, 0.011);
      root.add(rib);
    }

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.47, 0.1, 16),
      createCelMaterial(palette.sinkGlow),
    );
    cap.position.y = 0.81;
    addInkOutline(cap, palette.ink, 0.022);
    root.add(cap);

    addDecalDisc(
      root,
      isCCW ? '↺' : '↻',
      topStr,
      '#ffffff',
      inkStr,
      0.87,
      0.38,
      maxAniso,
    );

    const armPivot = new THREE.Group();
    armPivot.userData.animType = 'rotatorArm';
    armPivot.userData.cw = !isCCW;

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.54, 0.54, 0.18, 12),
      createCelMaterial(palette.accent),
    );
    collar.position.y = 0.36;
    addInkOutline(collar, palette.ink, 0.02);
    armPivot.add(collar);

    const counterweight = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.24, 0.42),
      createCelMaterial(palette.machineBase),
    );
    counterweight.position.set(-0.56, 0.36, 0);
    addInkOutline(counterweight, palette.ink, 0.018);
    armPivot.add(counterweight);

    const boomCarriage = new THREE.Group();
    boomCarriage.userData.animType = 'rotatorBoom';
    for (const zRail of [-0.085, 0.085]) {
      const boom = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 0.12, 0.07),
        createCelMaterial(palette.accent),
      );
      boom.position.set(0.66, 0.36, zRail);
      addInkOutline(boom, palette.ink, 0.016);
      boomCarriage.add(boom);
    }

    // Angled hydraulic boom support strut
    const trussStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.045, 0.46, 8),
      createCelMaterial(palette.sinkGlow),
    );
    trussStrut.rotation.z = -Math.PI / 2.9;
    trussStrut.position.set(0.66, 0.49, 0);
    addInkOutline(trussStrut, palette.ink, 0.01);
    boomCarriage.add(trussStrut);

    const wrist = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.24, 10),
      createCelMaterial(palette.machineBase),
    );
    wrist.position.set(1.04, 0.36, 0);
    addInkOutline(wrist, palette.ink, 0.016);
    boomCarriage.add(wrist);

    for (const zSide of [-0.18, 0.18]) {
      const clawPivot = new THREE.Group();
      clawPivot.position.set(1.06, 0.36, zSide);
      clawPivot.rotation.y = zSide > 0 ? -0.32 : 0.32;
      clawPivot.userData.animType = 'rotatorClaw';
      clawPivot.userData.side = zSide > 0 ? 1 : -1;

      const finger = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.12, 0.08),
        createCelMaterial(palette.sinkGlow),
      );
      finger.position.set(0.16, 0, 0);
      addInkOutline(finger, palette.ink, 0.015);
      clawPivot.add(finger);

      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.06),
        createCelMaterial(palette.accent),
      );
      pad.position.set(0.28, 0, zSide > 0 ? -0.04 : 0.04);
      addInkOutline(pad, palette.ink, 0.012);
      clawPivot.add(pad);

      boomCarriage.add(clawPivot);
    }
    armPivot.add(boomCarriage);
    root.add(armPivot);
  } else if (type === 'welder') {
    // Dual-Arm 2-Joint Robotic Arc Welding Station + power conduit cables + cooling fan + articulated elbow torch weave
    const base = createHexPadBase(palette, palette.machineBase, 0.12);
    root.add(base);

    const powerBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.46),
      createCelMaterial(palette.accentSecondary),
    );
    powerBox.position.set(-0.56, 0.24, 0);
    addInkOutline(powerBox, palette.ink, 0.016);
    root.add(powerBox);

    const xfmrFan = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.sinkGlow));
    xfmrFan.position.set(-0.56, 0.38, 0);
    xfmrFan.scale.setScalar(0.55);
    xfmrFan.userData.animType = 'steamWheel';
    addInkOutline(xfmrFan, palette.ink, 0.011);
    root.add(xfmrFan);

    for (const zOff of [-0.38, 0.38]) {
      // Flexible insulated cable conduit from powerBox to shoulder
      const cableCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.46, 0.22, zOff * 0.45),
        new THREE.Vector3(-0.15, 0.19, zOff * 0.9),
        new THREE.Vector3(0.2, 0.22, zOff),
      ]);
      const cableMesh = new THREE.Mesh(
        new THREE.TubeGeometry(cableCurve, 10, 0.032, 6, false),
        createCelMaterial(palette.ink),
      );
      root.add(cableMesh);

      const shoulder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.13, 0.18, 8),
        createCelMaterial(palette.machineTop),
      );
      shoulder.position.set(0.24, 0.2, zOff);
      addInkOutline(shoulder, palette.ink, 0.016);
      root.add(shoulder);

      const armPivot = new THREE.Group();
      armPivot.position.set(0.24, 0.28, zOff);
      armPivot.userData.animType = 'weldArm';
      armPivot.userData.side = zOff > 0 ? 1 : -1;

      const upperArm = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.1, 0.1),
        createCelMaterial(palette.machineTop),
      );
      upperArm.position.set(0.13, 0.09, -Math.sign(zOff) * 0.03);
      upperArm.rotation.y = Math.sign(zOff) * 0.22;
      addInkOutline(upperArm, palette.ink, 0.014);
      armPivot.add(upperArm);

      const elbowPivot = new THREE.Group();
      elbowPivot.position.set(0.26, 0.12, -Math.sign(zOff) * 0.07);
      elbowPivot.userData.animType = 'weldElbow';
      elbowPivot.userData.side = zOff > 0 ? 1 : -1;

      const elbowDrum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 0.11, 8),
        createCelMaterial(palette.sinkGlow),
      );
      addInkOutline(elbowDrum, palette.ink, 0.011);
      elbowPivot.add(elbowDrum);

      const torch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.075, 0.3, 8),
        createCelMaterial(palette.accent),
      );
      torch.rotation.z = -Math.PI / 2.6;
      torch.rotation.y = Math.sign(zOff) * 0.38;
      torch.position.set(0.15, -0.05, -Math.sign(zOff) * 0.08);
      addInkOutline(torch, palette.ink, 0.014);
      elbowPivot.add(torch);

      armPivot.add(elbowPivot);
      root.add(armPivot);
    }

    const arc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.38, 8),
      createCelMaterial(palette.accent, { emissive: palette.accent, emissiveIntensity: 0.95 }),
    );
    arc.rotation.x = Math.PI / 2;
    arc.position.set(HEX_SIZE * 0.86, 0.28, 0);
    arc.userData.animType = 'weldArc';
    root.add(arc);

    const sparkCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09, 0),
      createCelMaterial(0xffffff, { emissive: palette.sinkGlow, emissiveIntensity: 0.95 }),
    );
    sparkCore.position.set(HEX_SIZE * 0.86, 0.28, 0);
    sparkCore.userData.animType = 'weldSpark';
    root.add(sparkCore);

    addDecalDisc(root, 'WELD_ICON', topStr, '#ffffff', inkStr, 0.13, 0.44, maxAniso, 'СВАРКА');
  } else if (type === 'laser') {
    // Steam-Optical Laser Cutter: boiler, curved steam hose, spoked flywheel, finned cannon barrel, spinning prism iris, dual-layer plasma beam
    const base = createHexPadBase(palette, palette.machineBase, 0.14);
    root.add(base);

    const boiler = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.27, 0.48, 12),
      createCelMaterial(palette.machineTop),
    );
    boiler.position.set(-0.28, 0.38, 0);
    boiler.castShadow = true;
    addInkOutline(boiler, palette.ink, 0.022);
    root.add(boiler);

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.275, 0.275, 0.06, 12),
      createCelMaterial(palette.accent),
    );
    band.position.set(-0.28, 0.36, 0);
    addInkOutline(band, palette.ink, 0.012);
    root.add(band);

    const chimney = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.24, 8),
      createCelMaterial(palette.machineBase),
    );
    chimney.position.set(-0.36, 0.7, -0.1);
    addInkOutline(chimney, palette.ink, 0.014);
    root.add(chimney);

    const governorCog = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.sinkGlow));
    governorCog.position.set(-0.22, 0.64, 0.06);
    governorCog.scale.setScalar(0.75);
    governorCog.userData.animType = 'steamWheel';
    addInkOutline(governorCog, palette.ink, 0.013);
    root.add(governorCog);

    const sideFlywheel = createSpokedFlywheel(0.22, palette.accent, palette.sinkGlow, palette.machineBase, palette.ink);
    sideFlywheel.position.set(-0.28, 0.38, 0.29);
    sideFlywheel.userData.animType = 'flywheelZ';
    root.add(sideFlywheel);

    // Curved overhead pressurized steam conduit linking boiler top to laser turret
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.14, 0.56, -0.05),
      new THREE.Vector3(0.0, 0.6, -0.16),
      new THREE.Vector3(0.14, 0.42, -0.1),
    ]);
    const hoseMesh = new THREE.Mesh(
      new THREE.TubeGeometry(hoseCurve, 10, 0.036, 7, false),
      createCelMaterial(palette.accent),
    );
    addInkOutline(hoseMesh, palette.ink, 0.01);
    root.add(hoseMesh);

    const feedPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.36, 8),
      createCelMaterial(palette.accent),
    );
    feedPipe.rotation.z = Math.PI / 2;
    feedPipe.position.set(-0.04, 0.3, 0);
    addInkOutline(feedPipe, palette.ink, 0.012);
    root.add(feedPipe);

    const emitterGroup = new THREE.Group();
    emitterGroup.userData.animType = 'laserEmitter';

    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.26, 10),
      createCelMaterial(palette.accentSecondary),
    );
    turret.position.set(0.16, 0.27, 0);
    addInkOutline(turret, palette.ink, 0.02);
    emitterGroup.add(turret);

    for (let f = 0; f < 3; f++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.26, 0.28),
        createCelMaterial(palette.machineBase),
      );
      fin.position.set(0.24 + f * 0.1, 0.33, 0);
      addInkOutline(fin, palette.ink, 0.011);
      emitterGroup.add(fin);
    }

    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.125, 0.44, 10),
      createCelMaterial(palette.sinkGlow),
    );
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(0.42, 0.33, 0);
    addInkOutline(nozzle, palette.ink, 0.017);
    emitterGroup.add(nozzle);

    const focusRingGeo = new THREE.TorusGeometry(0.13, 0.028, 6, 6);
    focusRingGeo.rotateY(Math.PI / 2);
    const focusRing = new THREE.Mesh(focusRingGeo, createCelMaterial(palette.accent));
    focusRing.position.set(0.62, 0.33, 0);
    focusRing.userData.animType = 'laserCollimator';
    addInkOutline(focusRing, palette.ink, 0.011);
    emitterGroup.add(focusRing);

    const lensGem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.075, 0),
      createCelMaterial(0xff6b6b, { emissive: 0xff3b30, emissiveIntensity: 0.95 }),
    );
    lensGem.position.set(0.63, 0.33, 0);
    lensGem.userData.animType = 'laserCollimator';
    emitterGroup.add(lensGem);

    root.add(emitterGroup);

    const beamOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.044, 0.044, 0.5, 8),
      createCelMaterial(0xff4d4d, { emissive: 0xff2d20, emissiveIntensity: 0.95 }),
    );
    beamOuter.rotation.z = Math.PI / 2;
    beamOuter.position.set(0.88, 0.33, 0);
    beamOuter.userData.animType = 'laserBeam';
    root.add(beamOuter);

    const beamCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6),
      createCelMaterial(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.0 }),
    );
    beamCore.rotation.z = Math.PI / 2;
    beamCore.position.set(0.88, 0.33, 0);
    root.add(beamCore);

    const energyRingGeo = new THREE.TorusGeometry(0.105, 0.02, 6, 8);
    energyRingGeo.rotateY(Math.PI / 2);
    for (let r = 0; r < 2; r++) {
      const energyRing = new THREE.Mesh(
        energyRingGeo,
        createCelMaterial(0xffffff, { emissive: 0xff6b6b, emissiveIntensity: 0.9 }),
      );
      energyRing.position.set(0.8, 0.33, 0);
      energyRing.userData.animType = 'laserRing';
      energyRing.userData.ringIdx = r;
      root.add(energyRing);
    }
  } else if (type === 'sink') {
    const pattern = machine.config.targetPattern;
    const nodes = pattern?.nodes ?? [{ offset: { q: 0, r: 0 } }];
    root.rotation.y = 0;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const worldOff = hexToWorld(n.offset);
      const sockGroup = new THREE.Group();
      sockGroup.position.set(worldOff.x, 0, worldOff.z);

      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(HEX_SIZE * 0.78, HEX_SIZE * 0.85, 0.1, 6),
        createCelMaterial(palette.sinkGlow, {
          emissive: palette.sinkGlow,
          emissiveIntensity: 0.22,
        }),
      );
      ring.position.y = 0.05;
      addInkOutline(ring, palette.ink, 0.024);
      sockGroup.add(ring);

      // Subtle floating rotating target reception ring around socket
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(HEX_SIZE * 0.69, 0.024, 6, 6),
        createCelMaterial(palette.accent, { emissive: palette.accent, emissiveIntensity: 0.35 }),
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.14;
      halo.userData.animType = 'sinkHalo';
      sockGroup.add(halo);

      // Outer luminous holographic podium ring
      const outerHalo = new THREE.Mesh(
        new THREE.TorusGeometry(HEX_SIZE * 0.9, 0.032, 6, 24),
        createCelMaterial(0x38bdf8, { emissive: 0x38bdf8, emissiveIntensity: 0.75 }),
      );
      outerHalo.rotation.x = Math.PI / 2;
      outerHalo.position.y = 0.06;
      outerHalo.userData.animType = 'sinkOuterHalo';
      sockGroup.add(outerHalo);

      for (let b = 0; b < 3; b++) {
        const ba = (Math.PI * 2 * b) / 3 + Math.PI / 6;
        const clampPivot = new THREE.Group();
        clampPivot.position.set(Math.cos(ba) * HEX_SIZE * 0.76, 0.11, Math.sin(ba) * HEX_SIZE * 0.76);
        clampPivot.rotation.y = -ba;
        clampPivot.userData.animType = 'sinkClamp';
        clampPivot.userData.pinIdx = b;

        const strut = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.22, 0.14),
          createCelMaterial(palette.machineTop),
        );
        strut.position.y = 0.1;
        addInkOutline(strut, palette.ink, 0.014);
        clampPivot.add(strut);

        const beacon = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.08, 0.12),
          createCelMaterial(palette.accent),
        );
        beacon.position.set(-0.04, 0.22, 0);
        addInkOutline(beacon, palette.ink, 0.012);
        clampPivot.add(beacon);

        sockGroup.add(clampPivot);
      }

      const labelText =
        n.value !== undefined
          ? String(n.value)
          : pattern?.requiredSum !== undefined
            ? `Σ=${pattern.requiredSum}`
            : pattern?.expectedValues
              ? pattern.expectedValues.slice(0, 3).join(',')
              : '★';

      addDecalDisc(
        sockGroup,
        labelText,
        `#${new THREE.Color(palette.sinkGlow).getHexString()}`,
        inkStr,
        '#ffffff',
        0.105,
        0.58,
        maxAniso,
        i === 0 && pattern?.expectedValues ? 'ЦЕЛЬ' : undefined,
      );
      if (i === 0) {
        addOverheadSignSprite(
          sockGroup,
          'ВЫХОД',
          palette.holoBg,
          palette.holoText,
          palette.holoBorder,
          [0, 1.06, 0],
          [1.1, 0.44],
          maxAniso,
          0.16,
        );
      }
      root.add(sockGroup);
    }

    for (const edge of pattern?.edges ?? []) {
      const pA = hexToWorld(nodes[edge.fromIdx].offset);
      const pB = hexToWorld(nodes[edge.toIdx].offset);
      const dx = pB.x - pA.x;
      const dz = pB.z - pA.z;
      const dist = Math.hypot(dx, dz);
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(dist, 0.07, 0.26),
        createCelMaterial(palette.sinkGlow),
      );
      bridge.position.set((pA.x + pB.x) / 2, 0.04, (pA.z + pB.z) / 2);
      bridge.rotation.y = -Math.atan2(dz, dx);
      addInkOutline(bridge, palette.ink, 0.018);
      root.add(bridge);
    }
  } else if (type === 'destroyer') {
    // Twin-drum Industrial Shredder / Recycler (Утилизатор ×)
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * 0.82, HEX_SIZE * 0.88, 0.14, 6),
      createCelMaterial(palette.machineBase),
    );
    plinth.position.y = 0.07;
    plinth.receiveShadow = true;
    addInkOutline(plinth, palette.ink, 0.025);
    root.add(plinth);

    for (const zSide of [-0.46, 0.46]) {
      const cheek = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.34, 0.14),
        createCelMaterial(0xdc2626),
      );
      cheek.position.set(0, 0.28, zSide);
      cheek.castShadow = true;
      addInkOutline(cheek, palette.ink, 0.018);
      root.add(cheek);
    }

    // Twin counter-rotating crusher drums with cog teeth
    for (const [idx, xDrum] of [-0.21, 0.21].entries()) {
      const drumGrp = new THREE.Group();
      drumGrp.position.set(xDrum, 0.31, 0);
      drumGrp.userData.animType = 'shredderDrum';
      drumGrp.userData.drumSign = idx === 0 ? 1 : -1;

      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.76, 10),
        createCelMaterial(palette.machineTop),
      );
      core.rotation.x = Math.PI / 2;
      addInkOutline(core, palette.ink, 0.014);
      drumGrp.add(core);

      for (let t = 0; t < 3; t++) {
        const cog = new THREE.Mesh(getSmallCogGeo(), createCelMaterial(palette.sinkGlow));
        cog.position.z = -0.24 + t * 0.24;
        cog.scale.set(1.22, 1.22, 1.0);
        addInkOutline(cog, palette.ink, 0.01);
        drumGrp.add(cog);
      }
      root.add(drumGrp);
    }

    const hopperRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.045, 6, 6),
      createCelMaterial(0xf97316),
    );
    hopperRim.rotation.x = Math.PI / 2;
    hopperRim.rotation.z = Math.PI / 6;
    hopperRim.position.y = 0.45;
    addInkOutline(hopperRim, palette.ink, 0.014);
    root.add(hopperRim);

    addOverheadSignSprite(
      root,
      '×',
      palette.holoBg,
      '#fecaca',
      '#f87171',
      [0, 0.94, 0],
      [0.7, 0.4],
      maxAniso,
      0.46,
    );
  } else if (type === 'splitter') {
    // Rotating Gear Track Diverter (Разделитель ⇄)
    const base = createHexPadBase(palette, palette.machineBase, 0.14);
    root.add(base);

    const altRel =
      ((machine.config.altDir ?? ((machine.config.dir + 1) % 6)) - machine.config.dir + 6) % 6;
    const altAngle = -altRel * (Math.PI / 3);
    const secFin = new THREE.Mesh(
      getDirArrowGeo(),
      createCelMaterial(0x38bdf8, { roughness: 0.36, metalness: 0.18 }),
    );
    secFin.rotation.y = altAngle;
    secFin.position.set(
      Math.cos(-altAngle) * HEX_SIZE * 0.7,
      0.175,
      Math.sin(-altAngle) * HEX_SIZE * 0.7,
    );
    addInkOutline(secFin, palette.ink, 0.014);
    root.add(secFin);

    const centerGear = new THREE.Mesh(getCogGeo(), createCelMaterial(palette.machineTop));
    centerGear.position.y = 0.18;
    centerGear.scale.set(1.38, 1.15, 1.38);
    centerGear.userData.animType = 'steamWheel';
    addInkOutline(centerGear, palette.ink, 0.015);
    root.add(centerGear);

    // Pivoting diverter flap showing which port is currently primed (A vs B)
    const flapPivot = new THREE.Group();
    flapPivot.position.set(0, 0.28, 0);
    flapPivot.rotation.y = machine.state.memory === 1 ? altAngle : 0;
    flapPivot.userData.animType = 'splitterFlap';
    flapPivot.userData.baseRotY = machine.state.memory === 1 ? altAngle : 0;

    const flapBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.09, 0.14),
      createCelMaterial(palette.accent),
    );
    flapBody.position.set(0.18, 0, 0);
    addInkOutline(flapBody, palette.ink, 0.014);
    flapPivot.add(flapBody);
    root.add(flapPivot);

    addDecalDisc(
      root,
      '⇄',
      topStr,
      '#ffffff',
      inkStr,
      0.16,
      0.46,
      maxAniso,
      machine.state.memory === 1 ? 'ПОРТ B' : 'ПОРТ A',
    );
  } else if (type === 'swapper') {
    // Rotating Twin-Grip Turntable Seesaw (Качели-менялка ⇄)
    const base = createHexPadBase(palette, palette.machineBase, 0.14);
    root.add(base);

    const ringRim = new THREE.Mesh(
      new THREE.TorusGeometry(HEX_SIZE * 0.54, 0.04, 6, 18),
      createCelMaterial(palette.accentSecondary),
    );
    ringRim.rotation.x = Math.PI / 2;
    ringRim.position.y = 0.16;
    addInkOutline(ringRim, palette.ink, 0.013);
    root.add(ringRim);

    const turntable = new THREE.Group();
    turntable.position.y = 0.19;
    turntable.userData.animType = 'swapperTurntable';

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.32, 0.1, 12),
      createCelMaterial(palette.accent),
    );
    addInkOutline(hub, palette.ink, 0.015);
    turntable.add(hub);

    // Crossbeam reaching toward +X (dir) and -X (oppositeDir) with twin side claws
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(HEX_SIZE * 1.48, 0.075, 0.18),
      createCelMaterial(palette.machineTop),
    );
    beam.position.y = 0.03;
    addInkOutline(beam, palette.ink, 0.014);
    turntable.add(beam);

    for (const xSide of [-1, 1]) {
      const clampArm = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.16, 0.44),
        createCelMaterial(palette.sinkGlow),
      );
      clampArm.position.set(xSide * HEX_SIZE * 0.72, 0.08, 0);
      addInkOutline(clampArm, palette.ink, 0.013);
      turntable.add(clampArm);
    }
    root.add(turntable);

    addDecalDisc(root, '⇄', accentStr, '#ffffff', inkStr, 0.25, 0.38, maxAniso, 'ОБМЕН');
    addOverheadSignSprite(
      root,
      '⇄',
      palette.holoBg,
      palette.holoText,
      palette.holoBorder,
      [0, 0.92, 0],
      [0.74, 0.4],
      maxAniso,
      0.24,
    );
  } else if (type === 'jumper') {
    // Spring-Loaded Hex Leap Catapult (Батут ↷)
    const base = createHexPadBase(palette, palette.machineBase, 0.14);
    root.add(base);

    // Side spring anchor rails
    for (const zSide of [-0.46, 0.46]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.18, 0.11),
        createCelMaterial(palette.machineTop),
      );
      rail.position.set(0, 0.21, zSide);
      addInkOutline(rail, palette.ink, 0.014);
      root.add(rail);
    }

    // Twin coiled springs beneath angled launch deck
    const springGroup = new THREE.Group();
    springGroup.position.set(0, 0.16, 0);
    springGroup.userData.animType = 'jumperSpring';

    for (const xCoil of [-0.22, 0.2]) {
      const coil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.14, 0.18, 10),
        createCelMaterial(palette.sinkGlow),
      );
      coil.position.set(xCoil, 0.09, 0);
      addInkOutline(coil, palette.ink, 0.012);
      springGroup.add(coil);
    }

    // Angled catapult plate pitched toward exit dir (+X)
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.08, 0.72),
      createCelMaterial(palette.accent),
    );
    ramp.position.set(0.06, 0.22, 0);
    ramp.rotation.z = 0.28;
    addInkOutline(ramp, palette.ink, 0.015);
    springGroup.add(ramp);

    // Chevrons on ramp lip
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.11, 0.64),
      createCelMaterial(0xfde047, { emissive: 0xf59e0b, emissiveIntensity: 0.35 }),
    );
    lip.position.set(0.45, 0.35, 0);
    lip.rotation.z = 0.28;
    addInkOutline(lip, palette.ink, 0.012);
    springGroup.add(lip);

    root.add(springGroup);
    addOverheadSignSprite(
      root,
      '↷ ×2',
      palette.holoBg,
      palette.holoText,
      palette.holoBorder,
      [0, 0.98, 0],
      [0.86, 0.4],
      maxAniso,
      0.34,
    );
  } else {
    // Specialized Math & Logic Stations — distinct 3D industrial silhouettes per module family
    const base = createHexPadBase(palette, palette.machineBase, 0.14);
    root.add(base);

    for (const [px, pz] of [
      [-0.58, -0.36],
      [-0.58, 0.36],
      [0.44, -0.44],
      [0.44, 0.44],
    ]) {
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.074, 0.1, 6),
        createCelMaterial(palette.machineBase),
      );
      sleeve.position.set(px, 0.14, pz);
      addInkOutline(sleeve, palette.ink, 0.011);
      root.add(sleeve);

      const piston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.14, 6),
        createCelMaterial(palette.sinkGlow),
      );
      piston.position.set(px, 0.2, pz);
      piston.userData.animType = 'mathPost';
      addInkOutline(piston, palette.ink, 0.01);
      root.add(piston);
    }

    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(HEX_SIZE * 0.61, 0.036, 6, 6),
      createCelMaterial(palette.accent),
    );
    collar.rotation.x = Math.PI / 2;
    collar.rotation.z = Math.PI / 6;
    collar.position.y = 0.155;
    collar.userData.animType = 'mathRing';
    addInkOutline(collar, palette.ink, 0.013);
    root.add(collar);

    const symbolMap: Record<string, string> = {
      add1: '+1',
      sub1: '−1',
      mul2: '×2',
      div2: '÷2',
      sqrt: '√x',
      neg: '−x',
      dup: '=',
      adder: 'Σ',
      divmod: `÷${machine.config.divisor ?? 2}`,
      filter: 'Ч/Н',
      halver: '½',
      scales: '⚖',
    };
    const filterRuleLabels: Record<string, string> = {
      even: 'ЧЁТ→',
      odd: 'НЕЧ→',
      positive: '>0→',
      negative: '<0→',
      gt5: '>5→',
    };
    const subLabel =
      (type === 'adder' || type === 'scales') && machine.state.memory !== null
        ? `M:${machine.state.memory}`
        : type === 'filter'
          ? filterRuleLabels[machine.config.filterRule ?? 'even'] ?? 'ЧЁТ→'
          : type === 'neg'
            ? '×(−1)'
            : type === 'dup'
              ? 'КОПИЯ'
              : type === 'divmod'
                ? 'q | r'
                : type === 'halver'
                  ? 'a/2 | a/2'
                  : type === 'scales'
                    ? 'max | min'
                    : undefined;

    const bgColor =
      type === 'adder' ||
      type === 'filter' ||
      type === 'dup' ||
      type === 'neg' ||
      type === 'halver' ||
      type === 'scales'
        ? accentStr
        : topStr;

    addDecalDisc(
      root,
      symbolMap[type] ?? '?',
      bgColor,
      '#ffffff',
      inkStr,
      0.15,
      0.54,
      maxAniso,
      subLabel,
    );

    if (type === 'add1' || type === 'sub1') {
      // Side hydraulic booster/caliper actuator housing + flared vertical stamping hammer
      const isAdd = type === 'add1';
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.19, 0.28, 0.2),
        createCelMaterial(isAdd ? palette.accentSecondary : palette.accent),
      );
      tower.position.set(-0.28, 0.24, -0.62);
      addInkOutline(tower, palette.ink, 0.014);
      root.add(tower);

      const hammer = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.085, 0.14, 6),
        createCelMaterial(palette.sinkGlow),
      );
      hammer.position.set(-0.28, isAdd ? 0.41 : 0.46, -0.62);
      hammer.userData.animType = 'stepperHammer';
      hammer.userData.dirSign = isAdd ? 1 : -1;
      addInkOutline(hammer, palette.ink, 0.012);
      root.add(hammer);
    } else if (type === 'mul2') {
      // Raised side gearbox housing + 1:2 meshing counter-rotating flywheel gears clear of collar
      const gearPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.2, 0.08),
        createCelMaterial(palette.machineBase),
      );
      gearPlate.position.set(-0.14, 0.22, 0.56);
      addInkOutline(gearPlate, palette.ink, 0.012);
      root.add(gearPlate);

      const smallGear = new THREE.Mesh(getSmallCogGeo(), createCelMaterial(palette.sinkGlow));
      smallGear.position.set(-0.28, 0.31, 0.62);
      smallGear.userData.animType = 'counterGear';
      smallGear.userData.gearSign = 1;
      smallGear.userData.gearRatio = 2;
      addInkOutline(smallGear, palette.ink, 0.011);
      root.add(smallGear);

      const bigGear = new THREE.Mesh(getSmallCogGeo(), createCelMaterial(palette.accent));
      bigGear.scale.set(1.45, 1.45, 1.0);
      bigGear.position.set(0.01, 0.31, 0.62);
      bigGear.userData.animType = 'counterGear';
      bigGear.userData.gearSign = -1;
      bigGear.userData.gearRatio = 1;
      addInkOutline(bigGear, palette.ink, 0.012);
      root.add(bigGear);

      for (const zArch of [-0.64, 0.64]) {
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.12, 0.08),
          createCelMaterial(palette.accentSecondary),
        );
        rib.position.set(-0.32, 0.19, zArch);
        addInkOutline(rib, palette.ink, 0.011);
        root.add(rib);
      }
    } else if (type === 'div2' || type === 'divmod') {
      // Raised pillow-block mounts + twin opposing precision shearing gears + diverter baffle on divmod
      for (const zSide of [-0.6, 0.6]) {
        const mount = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.14, 0.09),
          createCelMaterial(palette.machineBase),
        );
        mount.position.set(-0.18, 0.19, zSide * 0.94);
        addInkOutline(mount, palette.ink, 0.011);
        root.add(mount);

        const gear = new THREE.Mesh(getSmallCogGeo(), createCelMaterial(palette.sinkGlow));
        gear.scale.set(1.18, 1.18, 1);
        gear.position.set(-0.18, 0.31, zSide);
        gear.userData.animType = 'counterGear';
        gear.userData.gearSign = zSide > 0 ? 1 : -1;
        gear.userData.gearRatio = 1.4;
        addInkOutline(gear, palette.ink, 0.011);
        root.add(gear);
      }
      if (type === 'divmod') {
        const bafflePin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.055, 0.14, 8),
          createCelMaterial(palette.machineBase),
        );
        bafflePin.position.set(0.36, 0.2, 0.24);
        addInkOutline(bafflePin, palette.ink, 0.01);
        root.add(bafflePin);

        const splitterBaffle = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.14, 0.07),
          createCelMaterial(palette.accent),
        );
        splitterBaffle.position.set(0.38, 0.29, 0.24);
        splitterBaffle.rotation.y = -0.5;
        splitterBaffle.userData.animType = 'filterBlade';
        addInkOutline(splitterBaffle, palette.ink, 0.012);
        root.add(splitterBaffle);
      }
    } else if (type === 'sqrt') {
      // Three angled optical focusing pylons seated outside collar
      for (let p = 0; p < 3; p++) {
        const a = Math.PI * 0.45 + (p * Math.PI * 2) / 3;
        const px = Math.cos(a) * 0.68;
        const pz = Math.sin(a) * 0.68;
        const pylon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.085, 0.34, 6),
          createCelMaterial(palette.accentSecondary),
        );
        pylon.position.set(px, 0.29, pz);
        pylon.rotation.z = Math.cos(a) * 0.24;
        pylon.rotation.x = -Math.sin(a) * 0.24;
        addInkOutline(pylon, palette.ink, 0.012);
        root.add(pylon);

        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.075, 0),
          createCelMaterial(palette.sinkGlow, { emissive: palette.accent, emissiveIntensity: 0.6 }),
        );
        crystal.position.set(px * 0.89, 0.47, pz * 0.89);
        crystal.userData.animType = 'sqrtPylonGem';
        root.add(crystal);
      }
    } else if (type === 'neg') {
      // Polarity inverter raised insulator mounts + dual copper phase-coils + oscillating polarity vanes
      for (const zSide of [-0.59, 0.59]) {
        const coilPedestal = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.12, 0.14),
          createCelMaterial(palette.machineBase),
        );
        coilPedestal.position.set(-0.08, 0.18, zSide);
        addInkOutline(coilPedestal, palette.ink, 0.011);
        root.add(coilPedestal);

        const coilStack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.105, 0.105, 0.2, 10),
          createCelMaterial(palette.accentSecondary),
        );
        coilStack.rotation.z = Math.PI / 2;
        coilStack.position.set(-0.08, 0.29, zSide);
        addInkOutline(coilStack, palette.ink, 0.012);
        root.add(coilStack);

        const vane = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.12, 0.075),
          createCelMaterial(palette.sinkGlow),
        );
        vane.position.set(0.06, 0.31, zSide);
        vane.userData.animType = 'negVane';
        vane.userData.side = zSide > 0 ? 1 : -1;
        addInkOutline(vane, palette.ink, 0.013);
        root.add(vane);
      }
    } else if (type === 'dup') {
      // Twin prism splitter crystal + rear arched mounting yoke
      const yokeArm = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.28, 0.16),
        createCelMaterial(palette.machineBase),
      );
      yokeArm.position.set(-0.56, 0.24, 0);
      addInkOutline(yokeArm, palette.ink, 0.012);
      root.add(yokeArm);

      const prism = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.165, 0),
        createCelMaterial(palette.sinkGlow, {
          emissive: palette.accent,
          emissiveIntensity: 0.45,
        }),
      );
      prism.position.set(-0.46, 0.44, 0);
      prism.userData.animType = 'memoryOrb';
      addInkOutline(prism, palette.ink, 0.014);
      root.add(prism);
    } else if (type === 'filter') {
      // Pivoting railway diverter blade above collar + vertical semaphore signal mast
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.055, 0.44, 8),
        createCelMaterial(palette.machineTop),
      );
      mast.position.set(-0.54, 0.34, -0.34);
      addInkOutline(mast, palette.ink, 0.012);
      root.add(mast);

      const ruleColor =
        machine.config.filterRule === 'positive'
          ? 0x22c55e
          : machine.config.filterRule === 'negative'
            ? 0xf43f5e
            : machine.config.filterRule === 'gt5'
              ? 0xf59e0b
              : palette.sinkGlow;
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.095, 0),
        createCelMaterial(ruleColor, { emissive: ruleColor, emissiveIntensity: 0.75 }),
      );
      beacon.position.set(-0.54, 0.6, -0.34);
      beacon.userData.animType = 'sqrtPylonGem';
      addInkOutline(beacon, palette.ink, 0.011);
      root.add(beacon);

      const bladePin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.055, 0.12, 8),
        createCelMaterial(palette.machineBase),
      );
      bladePin.position.set(0.36, 0.19, 0.16);
      addInkOutline(bladePin, palette.ink, 0.01);
      root.add(bladePin);

      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.12, 0.07),
        createCelMaterial(palette.sinkGlow),
      );
      blade.position.set(0.36, 0.27, 0.16);
      blade.rotation.y = -0.38;
      blade.userData.animType = 'filterBlade';
      addInkOutline(blade, palette.ink, 0.013);
      root.add(blade);
    } else if (type === 'adder') {
      const cradle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, 0.16, 8),
        createCelMaterial(palette.machineBase),
      );
      cradle.position.set(-0.48, 0.2, -0.42);
      addInkOutline(cradle, palette.ink, 0.014);
      root.add(cradle);

      if (machine.state.memory !== null) {
        const memOrb = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.16, 1),
          createCelMaterial(palette.sinkGlow, {
            emissive: 0xc084fc,
            emissiveIntensity: 0.72,
          }),
        );
        memOrb.position.set(-0.48, 0.46, -0.42);
        memOrb.userData.animType = 'memoryOrb';
        addInkOutline(memOrb, palette.ink, 0.015);
        root.add(memOrb);

        const gyro = new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.02, 6, 16),
          createCelMaterial(0xa855f7, { emissive: 0xa855f7, emissiveIntensity: 0.55 }),
        );
        gyro.position.set(-0.48, 0.46, -0.42);
        gyro.userData.animType = 'adderGyro';
        root.add(gyro);

        const gyroOuter = new THREE.Mesh(
          new THREE.TorusGeometry(0.28, 0.016, 6, 16),
          createCelMaterial(palette.sinkGlow),
        );
        gyroOuter.position.set(-0.48, 0.46, -0.42);
        gyroOuter.userData.animType = 'adderGyroOuter';
        root.add(gyroOuter);

        // Glowing purple memory aura ring framing the adder platform
        const memAura = new THREE.Mesh(
          new THREE.TorusGeometry(HEX_SIZE * 0.74, 0.03, 6, 24),
          createCelMaterial(0xa855f7, { emissive: 0xa855f7, emissiveIntensity: 0.75 }),
        );
        memAura.rotation.x = Math.PI / 2;
        memAura.position.y = 0.12;
        memAura.userData.animType = 'sinkOuterHalo';
        root.add(memAura);
      }
    } else if (type === 'halver') {
      // Heavy steel splitting anvil rails + overhead cleaving wedge blade (Раскольник пополам ½)
      for (const zSide of [-0.52, 0.52]) {
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.44, 0.14),
          createCelMaterial(palette.machineTop),
        );
        pillar.position.set(0, 0.34, zSide);
        addInkOutline(pillar, palette.ink, 0.013);
        root.add(pillar);
      }
      const wedgeGroup = new THREE.Group();
      wedgeGroup.position.set(0, 0.56, 0);
      wedgeGroup.userData.animType = 'halverWedge';

      const crossHead = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.14, 1.12),
        createCelMaterial(palette.accent),
      );
      addInkOutline(crossHead, palette.ink, 0.014);
      wedgeGroup.add(crossHead);

      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 0.32, 4),
        createCelMaterial(palette.sinkGlow, { roughness: 0.25, metalness: 0.4 }),
      );
      blade.rotation.z = Math.PI;
      blade.rotation.y = Math.PI / 4;
      blade.position.y = -0.18;
      addInkOutline(blade, palette.ink, 0.013);
      wedgeGroup.add(blade);
      root.add(wedgeGroup);
    } else if (type === 'scales') {
      // Brass Balance Fulcrum + Tilting Beam + Twin Scale Pans (Чаша весов ⚖)
      const fulcrum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.11, 0.42, 8),
        createCelMaterial(palette.machineTop),
      );
      fulcrum.position.set(-0.36, 0.34, 0);
      addInkOutline(fulcrum, palette.ink, 0.013);
      root.add(fulcrum);

      const beamPivot = new THREE.Group();
      beamPivot.position.set(-0.36, 0.56, 0);
      beamPivot.userData.animType = 'scalesBeam';

      const crossBeam = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.07, 0.88),
        createCelMaterial(palette.sinkGlow),
      );
      addInkOutline(crossBeam, palette.ink, 0.012);
      beamPivot.add(crossBeam);

      for (const zPan of [-0.4, 0.4]) {
        const pan = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.12, 0.06, 10),
          createCelMaterial(palette.accent),
        );
        pan.position.set(0, -0.14, zPan);
        addInkOutline(pan, palette.ink, 0.011);
        beamPivot.add(pan);
      }
      root.add(beamPivot);

      if (machine.state.memory !== null) {
        const memOrb = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.15, 1),
          createCelMaterial(palette.sinkGlow, {
            emissive: 0x38bdf8,
            emissiveIntensity: 0.72,
          }),
        );
        memOrb.position.set(-0.36, 0.44, 0.4);
        memOrb.userData.animType = 'memoryOrb';
        addInkOutline(memOrb, palette.ink, 0.014);
        root.add(memOrb);

        const memAura = new THREE.Mesh(
          new THREE.TorusGeometry(HEX_SIZE * 0.74, 0.028, 6, 24),
          createCelMaterial(0x38bdf8, { emissive: 0x38bdf8, emissiveIntensity: 0.72 }),
        );
        memAura.rotation.x = Math.PI / 2;
        memAura.position.y = 0.12;
        memAura.userData.animType = 'sinkOuterHalo';
        root.add(memAura);
      }
    }

    // Overhead gantry arch + legible sign badge on unary & 5th-grade math stations
    if (
      type === 'add1' ||
      type === 'sub1' ||
      type === 'mul2' ||
      type === 'div2' ||
      type === 'sqrt' ||
      type === 'neg' ||
      type === 'halver' ||
      type === 'scales'
    ) {
      for (const zPost of [-0.56, 0.56]) {
        const archLeg = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.62, 0.11),
          createCelMaterial(palette.machineBase),
        );
        archLeg.position.set(0, 0.43, zPost);
        addInkOutline(archLeg, palette.ink, 0.013);
        root.add(archLeg);
      }
      const archCrossbar = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.12, 1.24),
        createCelMaterial(palette.machineTop),
      );
      archCrossbar.position.set(0, 0.74, 0);
      addInkOutline(archCrossbar, palette.ink, 0.014);
      root.add(archCrossbar);

      addOverheadSignSprite(
        root,
        symbolMap[type] ?? '?',
        palette.holoBg,
        palette.holoText,
        palette.holoBorder,
        [0, 1.04, 0],
        [0.88, 0.42],
        maxAniso,
        0.79,
      );
    }

    if (
      type === 'filter' ||
      type === 'divmod' ||
      type === 'dup' ||
      type === 'halver' ||
      type === 'scales'
    ) {
      const altRel = ((machine.config.altDir ?? ((machine.config.dir + 1) % 6)) - machine.config.dir + 6) % 6;
      const altAngle = -altRel * (Math.PI / 3);
      const secFin = new THREE.Mesh(
        getDirArrowGeo(),
        createCelMaterial(palette.sinkGlow, { roughness: 0.36, metalness: 0.15 }),
      );
      secFin.rotation.y = altAngle;
      secFin.position.set(
        Math.cos(-altAngle) * HEX_SIZE * 0.69,
        0.175,
        Math.sin(-altAngle) * HEX_SIZE * 0.69,
      );
      addInkOutline(secFin, palette.ink, 0.014);
      root.add(secFin);
    }
  }

  return root;
}

export function buildTokenMesh(
  value: number,
  palette: ThemePalette,
  themeId: PaletteThemeId,
  maxAniso: number,
): THREE.Group {
  const group = new THREE.Group();
  const discHexStr = getTokenPaletteColor(value, themeId);
  const discColor = new THREE.Color(discHexStr).getHex();
  const inkStr = `#${new THREE.Color(palette.ink).getHexString()}`;

  // Grounding soft contact shadow disc beneath puck
  const shadowMat = new THREE.MeshBasicMaterial({
    map: getSoftContactShadowTexture(),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(getSharedContactShadowGeo(), shadowMat);
  shadowDisc.scale.set(1.45, 1, 1.45);
  shadowDisc.position.y = 0.016;
  group.add(shadowDisc);

  // Chamfered satin ceramic lathe puck body with waist groove
  const body = new THREE.Mesh(
    getTokenBodyGeo(),
    createCelMaterial(discColor, { roughness: 0.36, metalness: 0.08, envMapIntensity: 0.75 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  addInkOutline(body, palette.ink, 0.016);
  group.add(body);

  // Lower metallic flange ring seated around waist groove
  const waistRing = new THREE.Mesh(
    getTokenRimGeo(),
    createCelMaterial(palette.machineBase, { roughness: 0.35, metalness: 0.45 }),
  );
  waistRing.scale.set(1.06, 0.65, 1.06);
  waistRing.position.y = 0.228;
  group.add(waistRing);

  // Crisp upper ceramic collar rim
  const rim = new THREE.Mesh(
    getTokenRimGeo(),
    createCelMaterial(0xffffff, { roughness: 0.28, metalness: 0.05 }),
  );
  rim.position.y = 0.36;
  group.add(rim);

  const tex = createTokenNumberTexture(value, discHexStr, inkStr, maxAniso);
  const capMat = new THREE.MeshBasicMaterial({
    map: tex,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const cap = new THREE.Mesh(getTokenCapGeo(), capMat);
  cap.position.y = 0.372;
  cap.rotation.y = Math.PI * 0.12;
  group.add(cap);

  return group;
}

export function buildBondRodMesh(palette: ThemePalette): THREE.Group {
  const group = new THREE.Group();
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.068, 1.0, 10),
    createCelMaterial(palette.rodColor, { roughness: 0.35, metalness: 0.35 }),
  );
  rod.rotation.z = Math.PI / 2;
  rod.castShadow = true;
  group.add(rod);

  const centerSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.105, 0.18, 10),
    createCelMaterial(palette.accent, { roughness: 0.38, metalness: 0.25 }),
  );
  centerSleeve.rotation.z = Math.PI / 2;
  group.add(centerSleeve);

  for (const xEnd of [-0.42, 0.42]) {
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.098, 0.082, 0.11, 10),
      createCelMaterial(palette.sinkGlow, { roughness: 0.35, metalness: 0.2 }),
    );
    flange.rotation.z = Math.PI / 2;
    flange.position.x = xEnd;
    group.add(flange);
  }

  return group;
}

const TRACK_JOIN_TYPES: ReadonlySet<MachineType> = new Set([
  'conveyor',
  'add1',
  'sub1',
  'mul2',
  'div2',
  'sqrt',
  'neg',
  'dup',
  'adder',
  'divmod',
  'filter',
  'splitter',
  'halver',
  'scales',
  'jumper',
  'destroyer',
  'sink',
]);

/**
 * Generates seamless belt bridges & side-rail couplers between adjacent track machines
 * so consecutive conveyors fuse into continuous industrial tracks.
 */
export function buildConveyorConnectorGroup(
  machines: Map<HexKey, MachineInstance>,
  palette: ThemePalette,
): THREE.Group {
  const group = new THREE.Group();
  const beltMat = createCelMaterial(palette.ink, { roughness: 0.72, metalness: 0.08 });
  const railMat = createCelMaterial(palette.machineTop, { roughness: 0.48, metalness: 0.18 });
  const seamWidth = 0.78;
  const seamLen = 0.48;

  for (const m of machines.values()) {
    if (!TRACK_JOIN_TYPES.has(m.type) || m.type === 'sink' || m.type === 'destroyer' || m.type === 'jumper') {
      continue;
    }
    const outDirs: HexDir[] = [m.config.dir];
    if (
      m.type === 'filter' ||
      m.type === 'divmod' ||
      m.type === 'dup' ||
      m.type === 'splitter' ||
      m.type === 'halver' ||
      m.type === 'scales'
    ) {
      outDirs.push(m.config.altDir ?? rotateDir(m.config.dir, 1));
    }

    const wA = hexToWorld(m.coord);
    for (const d of outDirs) {
      const nb = machines.get(hexKey(hexNeighbor(m.coord, d)));
      if (!nb || !TRACK_JOIN_TYPES.has(nb.type)) continue;
      if (nb.type !== 'sink' && nb.type !== 'destroyer' && oppositeDir(d) === nb.config.dir) continue;

      const wB = hexToWorld(nb.coord);
      const midX = (wA.x + wB.x) * 0.5;
      const midZ = (wA.z + wB.z) * 0.5;
      const yaw = dirToWorldYaw(d);

      const coupler = new THREE.Group();
      coupler.position.set(midX, 0, midZ);
      coupler.rotation.y = yaw;

      const bridgeBelt = new THREE.Mesh(
        new THREE.BoxGeometry(seamLen, 0.085, seamWidth),
        beltMat,
      );
      bridgeBelt.position.y = 0.102;
      coupler.add(bridgeBelt);

      for (const zRail of [-0.47, 0.47]) {
        const railJoin = new THREE.Mesh(
          new THREE.BoxGeometry(seamLen + 0.06, 0.13, 0.105),
          railMat,
        );
        railJoin.position.set(0, 0.135, zRail);
        coupler.add(railJoin);
      }

      group.add(coupler);
    }
  }

  return group;
}

/**
 * Recessed glowing inlaid pathway channels embedded into the hex deck along active
 * conveyor/mechanism connections and utility range beams.
 */
export function buildInlaidChannelGroup(
  machines: Map<HexKey, MachineInstance>,
  platformHexes: Set<HexKey>,
  palette: ThemePalette,
): { group: THREE.Group; material: THREE.ShaderMaterial } {
  const group = new THREE.Group();
  const mat = createInlaidChannelMaterial(palette.channelColor, palette.channelPulse);
  const stripLen = HEX_SIZE * Math.sqrt(3);
  const stripGeo = new THREE.PlaneGeometry(stripLen, 0.18);
  stripGeo.rotateX(-Math.PI / 2);

  for (const m of machines.values()) {
    if (m.type === 'sink' || m.type === 'destroyer') continue;

    if (m.type === 'jumper') {
      const d1 = hexNeighbor(m.coord, m.config.dir);
      const d2 = hexNeighbor(d1, m.config.dir);
      if (platformHexes.has(hexKey(d2))) {
        const wA = hexToWorld(m.coord);
        const wB = hexToWorld(d2);
        const longLen = Math.hypot(wB.x - wA.x, wB.z - wA.z);
        const jumpGeo = new THREE.PlaneGeometry(longLen, 0.14);
        jumpGeo.rotateX(-Math.PI / 2);
        const jumpStrip = new THREE.Mesh(jumpGeo, mat);
        jumpStrip.position.set((wA.x + wB.x) * 0.5, 0.012, (wA.z + wB.z) * 0.5);
        jumpStrip.rotation.y = dirToWorldYaw(m.config.dir);
        jumpStrip.renderOrder = 2;
        group.add(jumpStrip);
      }
      continue;
    }

    const outDirs: HexDir[] = [m.config.dir];
    if (
      m.type === 'filter' ||
      m.type === 'divmod' ||
      m.type === 'dup' ||
      m.type === 'splitter' ||
      m.type === 'halver' ||
      m.type === 'scales'
    ) {
      outDirs.push(m.config.altDir ?? rotateDir(m.config.dir, 1));
    } else if (m.type === 'swapper') {
      outDirs.push(oppositeDir(m.config.dir));
    }

    const wA = hexToWorld(m.coord);
    for (const d of outDirs) {
      const nbCoord = hexNeighbor(m.coord, d);
      if (!platformHexes.has(hexKey(nbCoord))) continue;
      const wB = hexToWorld(nbCoord);
      const midX = (wA.x + wB.x) * 0.5;
      const midZ = (wA.z + wB.z) * 0.5;
      const yaw = dirToWorldYaw(d);

      const channel = new THREE.Mesh(stripGeo, mat);
      channel.position.set(midX, 0.008, midZ);
      channel.rotation.y = yaw;
      channel.renderOrder = 2;
      group.add(channel);
    }
  }

  return { group, material: mat };
}

export {
  buildBonsaiTreeGroup,
  buildFloatingMiniIsland,
  buildIslandUnderbellyAndCables,
  buildPlatformBeaconPost,
  buildScenicValleyEnvironment,
  buildStylizedCloudGroup,
} from './worldScenery';


