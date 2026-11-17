import { animateMachines } from './animateMachines';
import { createSceneInput } from './sceneInput';
import { useSceneCamera } from './useSceneCamera';
import { useSceneEvents } from './useSceneEvents';
import { disposeObjectTree } from './disposeObjectTree';
import { machineMeshSignature } from './machineMeshSignature';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  getConnectedComponents,
  getMachineFootprint,
  getRotationSweptHexes,
  SOLID_MACHINE_TYPES,
} from '../engine/hex-engine';
import {
  dirToWorldYaw,
  HEX_SIZE,
  hexEqual,
  hexKey,
  hexNeighbor,
  hexToWorld,
  parseHexKey,
  rotateAroundPivot,
  rotateDir,
} from '../engine/hex-math';
import type {
  AxialCoord,
  HexDir,
  HexKey,
  MachineInstance,
  MachineType,
  RotatorMode,
  SimEvent,
  SimulationWorld,
} from '../engine/types';
import {
  addInkOutline,
  createCelMaterial,
  createSkyDomeMaterial,
  getSoftGlowParticleTexture,
  PALETTES,
  type PaletteThemeId,
} from './celMaterials';
import type { Vec2 } from './conveyorTopology';
import { computeIslandTerrainLayout } from './islandLayout';
import {
  buildBondRodMesh,
  buildBonsaiTreeGroup,
  buildConveyorConnectorGroup,
  buildFloatingMiniIsland,
  buildInlaidChannelGroup,
  buildIslandUnderbellyAndCables,
  buildMachineMesh,
  buildPlatformBeaconPost,
  buildScenicValleyEnvironment,
  buildStylizedCloudGroup,
  buildTokenMesh,
  getSharedHexGridRingGeometry,
  getSharedHexHitGeometry,
  getSharedHexTileGeometry,
} from './proceduralMeshes';
import {
  evaluateConsumedTokenTimeline,
  evaluateMachineActionCurves,
  evaluateTokenTickTimeline,
  evaluateTransportCurve,
  TOKEN_ARRIVAL_ALPHA,
  TOKEN_TRIGGER_ALPHA,
} from './tokenAnimationTimeline';
import {
  buildBlossomBonsaiGroup,
  buildBrassAstrolabeObservatory,
  buildCrystalOutcropGroup,
  buildCrystalSpringWaterfall,
  buildLevitatingCrystalPylon,
  buildOrbitingRockShard,
  buildSkyWindVaneTower,
  buildStoneArchPergola,
  buildTerraceBoulder,
  buildTerraceFireflies,
  createTerraceParapetGeometry,
  createTerraceTrimRingGeometry,
  createTerraceTurfCapGeometry,
} from './worldScenery';

export interface HexSceneProps {
  world: SimulationWorld;
  events: SimEvent[];
  theme: PaletteThemeId;
  isTitleMode: boolean;
  isSimPlaying?: boolean;
  continuousCamera?: boolean;
  onStopContinuousCamera?: () => void;
  focusCoordTrigger?: { coord: AxialCoord; seq: number } | null;
  selectedTool: MachineType | 'erase' | 'select' | null;
  selectedDir: HexDir;
  rotatorMode?: RotatorMode;
  /** Progress [0..1] within the current simulation tick for smooth 60fps interpolation */
  tickProgressRef: React.MutableRefObject<number>;
  highlightCoord?: AxialCoord;
  inspectedCoord?: AxialCoord | null;
  onHexClick: (coord: AxialCoord) => void;
  onHexRightClick?: (coord: AxialCoord) => void;
  onHexHover?: (coord: AxialCoord | null) => void;
  onMoveBlock?: (from: AxialCoord, to: AxialCoord, newDir?: HexDir) => void;
  cameraResetTrigger: number;
}

// Pre-allocated scratch math objects (Zero GC inside render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _shakeOffset = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _tileColor = new THREE.Color();

interface SteamPuff {
  mesh: THREE.Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
}

interface PulseRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  life: number;
  maxLife: number;
  maxScale: number;
}

interface OpPopup {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  life: number;
  maxLife: number;
  startY: number;
}

function detectSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export function HexScene3D({
  world,
  events,
  theme,
  isTitleMode,
  isSimPlaying = false,
  continuousCamera = false,
  onStopContinuousCamera,
  focusCoordTrigger,
  selectedTool,
  selectedDir,
  rotatorMode,
  tickProgressRef,
  highlightCoord,
  inspectedCoord,
  onHexClick,
  onHexRightClick,
  onHexHover,
  onMoveBlock,
  cameraResetTrigger,
}: HexSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Store latest props in refs so WebGL scene mounts exactly once
  const propsRef = useRef({
    world,
    theme,
    isTitleMode,
    isSimPlaying,
    continuousCamera,
    onStopContinuousCamera,
    selectedTool,
    selectedDir,
    rotatorMode,
    highlightCoord,
    inspectedCoord,
    onHexClick,
    onHexRightClick,
    onHexHover,
    onMoveBlock,
  });
  propsRef.current = {
    world,
    theme,
    isTitleMode,
    isSimPlaying,
    continuousCamera,
    onStopContinuousCamera,
    selectedTool,
    selectedDir,
    rotatorMode,
    highlightCoord,
    inspectedCoord,
    onHexClick,
    onHexRightClick,
    onHexHover,
    onMoveBlock,
  };

  const sceneApiRef = useRef<{
    rebuildGrid: () => void;
    syncMachines: () => void;
    syncTheme: () => void;
    resetCamera: () => void;
    focusCoord: (coord: AxialCoord) => void;
    spawnFallingToken: (value: number, fromCoord: AxialCoord, toCoord: AxialCoord) => void;
    clearFallingTokens: () => void;
    spawnSteamBurst: (x: number, z: number, count?: number) => void;
    spawnSparkBurst: (x: number, z: number, count?: number) => void;
    spawnPulseRing: (x: number, z: number, colorHex: number, maxScale?: number, delay?: number) => void;
    spawnOpPopup: (x: number, z: number, label: string, severity: 'info' | 'success' | 'warning' | 'error') => void;
    addTrauma: (amount: number) => void;
    emitEventFx: (ev: SimEvent) => void;
    queueEventFx: (ev: SimEvent) => void;
    clearPendingEventFx: () => void;
  } | null>(null);

  // Sync grid when platform hex set or narrow gap fissure set changes
  const platformSig = `${Array.from(world.platformHexes).sort().join(';')}|GAPS:${Array.from(world.narrowGapHexes).sort().join(';')}`;
  useEffect(() => {
    sceneApiRef.current?.rebuildGrid();
    if (!propsRef.current.isTitleMode) {
      sceneApiRef.current?.resetCamera();
    }
  }, [platformSig]);

  useSceneCamera(sceneApiRef, isTitleMode, cameraResetTrigger, focusCoordTrigger);

  // Sync theme palette
  useEffect(() => {
    sceneApiRef.current?.syncTheme();
    sceneApiRef.current?.rebuildGrid();
    sceneApiRef.current?.syncMachines();
  }, [theme]);

  // Sync machines whenever machine map, config, or memory changes
  const machineSig = JSON.stringify(Array.from(world.machines.values(), m => machineMeshSignature(m, world.machines, theme)));
  useEffect(() => {
    sceneApiRef.current?.syncMachines();
  }, [machineSig]);

  useSceneEvents(events, world.tick, isSimPlaying, isTitleMode, tickProgressRef, sceneApiRef);

  useEffect(() => {
    if (world.tick === 0) {
      sceneApiRef.current?.clearFallingTokens();
    }
  }, [world.tick]);

  useEffect(() => {
    if (world.fallingTokens && world.fallingTokens.length > 0) {
      for (const ft of world.fallingTokens) {
        sceneApiRef.current?.spawnFallingToken(ft.value, ft.fromCoord, ft.toCoord);
      }
    }
  }, [world.fallingTokens]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: isSoftwareGl,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new THREE.Scene();
    const initPal = PALETTES[propsRef.current.theme];
    scene.background = new THREE.Color(initPal.fogColor);
    scene.fog = new THREE.FogExp2(initPal.fogColor, 0.0074);

    // Studio PMREM Environment
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    // Camera (tilted isometric perspective for strong 3D diorama readability)
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.5, 220);
    const defaultCamPos = new THREE.Vector3(0, 15.5, 15.8);
    const defaultTarget = new THREE.Vector3(0, 0, 0.3);
    if (propsRef.current.isTitleMode) {
      const a0 = 0.25;
      camera.position.set(-2.3 + Math.sin(a0) * 24.5, 14.8, 0.2 + Math.cos(a0) * 24.5);
      camera.lookAt(-2.3, -0.3, 0.2);
    } else {
      camera.position.copy(defaultCamPos);
      camera.lookAt(defaultTarget);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.target.copy(defaultTarget);
    controls.minDistance = 7;
    controls.maxDistance = 52;
    controls.minPolarAngle = 0.32;
    controls.maxPolarAngle = Math.PI / 2.25;
    controls.screenSpacePanning = true;

    // Tunic / Monument Valley 4-point Atmospheric Diorama Lighting Rig
    const hemiLight = new THREE.HemisphereLight(initPal.hemiSky, initPal.hemiGround, 0.84);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(initPal.sunColor, 1.38);
    keyLight.position.set(10, 19, 11);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 3;
    keyLight.shadow.camera.left = -16;
    keyLight.shadow.camera.right = 16;
    keyLight.shadow.camera.top = 16;
    keyLight.shadow.camera.bottom = -16;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 54;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.025;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdceeff, 0.3);
    fillLight.position.set(-9, 7, 10);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xaee6ff, 0.45);
    rimLight.position.set(-10, 9, -11);
    scene.add(rimLight);

    // Smooth Atmospheric Sky Dome (replaces noisy polka-dot abyss plane)
    const skyMat = createSkyDomeMaterial(initPal);
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(125, 32, 24), skyMat);
    skyDome.frustumCulled = false;
    skyDome.renderOrder = -10;
    scene.add(skyDome);

    // Scene Groups
    const gridGroup = new THREE.Group();
    const cliffGroup = new THREE.Group();
    const sceneryGroup = new THREE.Group();
    const channelGroup = new THREE.Group();
    const machineGroup = new THREE.Group();
    const machineDecorationGroup = new THREE.Group();
    machineGroup.add(machineDecorationGroup);
    const tokenGroup = new THREE.Group();
    const bondGroup = new THREE.Group();
    const fxGroup = new THREE.Group();
    scene.add(
      gridGroup,
      cliffGroup,
      sceneryGroup,
      channelGroup,
      machineGroup,
      tokenGroup,
      bondGroup,
      fxGroup,
    );
    let activeChannelMat: THREE.ShaderMaterial | null = null;
    let activeWaterMat: THREE.ShaderMaterial | null = null;
    let activeWaterfallMat: THREE.ShaderMaterial | null = null;
    let animatedSceneryNodes: THREE.Object3D[] = [];
    let channelActiveBlend = 0.28;

    // Hover / Ghost / Highlight / Inspected / Polymer / Error rings
    const hoverRingGeo = new THREE.RingGeometry(HEX_SIZE * 0.72, HEX_SIZE * 0.92, 6);
    hoverRingGeo.rotateX(-Math.PI / 2);
    hoverRingGeo.rotateY(Math.PI / 6);
    hoverRingGeo.userData.isShared = true;
    const hoverRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const hoverRing = new THREE.Mesh(hoverRingGeo, hoverRingMat);
    hoverRing.position.y = 0.025;
    hoverRing.visible = false;
    scene.add(hoverRing);

    const coachRingMat = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      side: THREE.DoubleSide,
    });
    const coachRing = new THREE.Mesh(hoverRingGeo, coachRingMat);
    coachRing.position.y = 0.03;
    coachRing.visible = false;
    scene.add(coachRing);

    const inspectedRingMat = new THREE.MeshBasicMaterial({
      color: 0x00d1b2,
      side: THREE.DoubleSide,
    });
    const inspectedRing = new THREE.Mesh(hoverRingGeo, inspectedRingMat);
    inspectedRing.position.y = 0.038;
    inspectedRing.visible = false;
    scene.add(inspectedRing);

    // Pooled Connected Polymer Hover Rings (up to 12)
    const polymerRings: THREE.Mesh[] = [];
    const polymerRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(hoverRingGeo, polymerRingMat);
      m.position.y = 0.032;
      m.visible = false;
      fxGroup.add(m);
      polymerRings.push(m);
    }

    // Ghost preview group & tactical 3D trajectory overlay group
    const ghostGroup = new THREE.Group();
    ghostGroup.visible = false;
    scene.add(ghostGroup);
    let ghostKey = '';

    const tacticalGroup = new THREE.Group();
    tacticalGroup.visible = false;
    scene.add(tacticalGroup);
    let tacticalKey = '';

    // Pooled Error Highlight Rings (up to 8)
    const errorRings: THREE.Mesh[] = [];
    const errorRingMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(hoverRingGeo, errorRingMat);
      m.position.y = 0.04;
      m.visible = false;
      fxGroup.add(m);
      errorRings.push(m);
    }

    // Pooled Hex Shockwave Pulse Rings (12)
    const pulseRingGeo = new THREE.RingGeometry(HEX_SIZE * 0.56, HEX_SIZE * 0.84, 6);
    pulseRingGeo.rotateX(-Math.PI / 2);
    pulseRingGeo.rotateY(Math.PI / 6);
    pulseRingGeo.userData.isShared = true;
    const pulseRings: PulseRing[] = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(pulseRingGeo, mat);
      mesh.position.y = 0.055;
      mesh.visible = false;
      fxGroup.add(mesh);
      pulseRings.push({
        mesh,
        mat,
        active: false,
        life: 0,
        maxLife: 0.52,
        maxScale: 1.75,
      });
    }
    let pulseCursor = 0;

    function spawnPulseRing(
      x: number,
      z: number,
      colorHex: number,
      maxScale = 1.75,
      delay = 0,
    ) {
      const pr = pulseRings[pulseCursor];
      pulseCursor = (pulseCursor + 1) % pulseRings.length;
      pr.active = true;
      pr.life = -delay;
      pr.maxLife = 0.52;
      pr.maxScale = maxScale;
      pr.mat.color.setHex(colorHex);
      pr.mat.opacity = 0.92;
      pr.mesh.position.set(x, 0.055, z);
      pr.mesh.scale.setScalar(0.55);
      pr.mesh.visible = delay <= 0;
    }

    // Pooled Floating Operation Badges (16 sleek holographic THREE.Sprite billboards)
    const opTextureCache = new Map<string, THREE.CanvasTexture>();
    function getOpBadgeTexture(
      label: string,
      severity: 'info' | 'success' | 'warning' | 'error',
    ): THREE.CanvasTexture {
      const cacheKey = `${label}|${severity}`;
      const existing = opTextureCache.get(cacheKey);
      if (existing) return existing;

      const cw = 256;
      const ch = 104;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;

      const bgFill =
        severity === 'success'
          ? 'rgba(16, 85, 52, 0.85)'
          : severity === 'error'
            ? 'rgba(127, 29, 29, 0.88)'
            : severity === 'warning'
              ? 'rgba(120, 53, 15, 0.86)'
              : 'rgba(15, 31, 48, 0.84)';
      const accentBorder =
        severity === 'success'
          ? '#4ade80'
          : severity === 'error'
            ? '#f87171'
            : severity === 'warning'
              ? '#fbbf24'
              : '#38bdf8';

      const pad = 12;
      const rw = cw - pad * 2;
      const rh = ch - pad * 2;
      const rad = 18;

      ctx.fillStyle = bgFill;
      ctx.beginPath();
      ctx.roundRect(pad, pad, rw, rh, rad);
      ctx.fill();

      ctx.lineWidth = 3.5;
      ctx.strokeStyle = accentBorder;
      ctx.stroke();

      const fontSize = label.length >= 6 ? 34 : label.length >= 4 ? 42 : 48;
      ctx.font = `800 ${fontSize}px "JetBrains Mono", "Plus Jakarta Sans", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = accentBorder;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(label, cw / 2, ch / 2 + 1);
      ctx.shadowBlur = 0;

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      opTextureCache.set(cacheKey, tex);
      return tex;
    }

    const opPopups: OpPopup[] = [];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 20;
      fxGroup.add(sprite);
      opPopups.push({
        sprite,
        mat,
        active: false,
        life: 0,
        maxLife: 0.62,
        startY: 0.72,
      });
    }
    let opCursor = 0;

    function spawnOpPopup(
      x: number,
      z: number,
      label: string,
      severity: 'info' | 'success' | 'warning' | 'error',
    ) {
      for (const existing of opPopups) {
        if (!existing.active) continue;
        if (Math.hypot(existing.sprite.position.x - x, existing.sprite.position.z - z) < 0.35) {
          existing.active = false;
          existing.sprite.visible = false;
        }
      }
      const pop = opPopups[opCursor];
      opCursor = (opCursor + 1) % opPopups.length;
      pop.active = true;
      pop.life = 0;
      pop.maxLife = 0.72;
      pop.startY = 0.96;
      pop.mat.map = getOpBadgeTexture(label, severity);
      pop.mat.opacity = 1;
      pop.mat.needsUpdate = true;
      pop.sprite.position.set(x, pop.startY, z);
      pop.sprite.scale.set(1.34, 0.55, 1);
      pop.sprite.visible = true;
    }

    // Camera Trauma Micro-Shake
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let cameraTrauma = 0;
    function addTrauma(amount: number) {
      if (prefersReducedMotion) return;
      cameraTrauma = Math.min(1, cameraTrauma + amount);
    }

    // Pooled Soft Steam Wisps (28 translucent puffs)
    const steamPuffs: SteamPuff[] = [];
    const puffGeo = new THREE.SphereGeometry(0.2, 10, 8);
    puffGeo.userData.isShared = true;
    const puffMat = createCelMaterial(0xffffff, {
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.58,
      emissive: 0xffffff,
      emissiveIntensity: 0.15,
    });
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(puffGeo, puffMat);
      mesh.visible = false;
      fxGroup.add(mesh);
      steamPuffs.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 0.9,
        vx: 0,
        vy: 0,
        vz: 0,
      });
    }
    let steamCursor = 0;

    function spawnSteamBurst(x: number, z: number, count = 5) {
      for (let i = 0; i < count; i++) {
        const p = steamPuffs[steamCursor];
        steamCursor = (steamCursor + 1) % steamPuffs.length;
        p.active = true;
        p.life = 0;
        p.maxLife = 0.55 + Math.random() * 0.35;
        p.vx = (Math.random() - 0.5) * 0.85;
        p.vy = 0.85 + Math.random() * 0.75;
        p.vz = (Math.random() - 0.5) * 0.85;
        p.mesh.position.set(
          x + (Math.random() - 0.5) * 0.32,
          0.35,
          z + (Math.random() - 0.5) * 0.32,
        );
        p.mesh.scale.setScalar(0.45);
        p.mesh.visible = true;
      }
    }

    // Pooled Luminous Spark Embers (28 glowing additive sparks for welding/laser/transform)
    const sparkPuffs: SteamPuff[] = [];
    const sparkGeo = new THREE.OctahedronGeometry(0.075, 0);
    sparkGeo.scale(0.65, 1.45, 0.65);
    sparkGeo.userData.isShared = true;
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffe082,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      fxGroup.add(mesh);
      sparkPuffs.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 0.45,
        vx: 0,
        vy: 0,
        vz: 0,
      });
    }
    let sparkCursor = 0;

    function spawnSparkBurst(x: number, z: number, count = 6) {
      for (let i = 0; i < count; i++) {
        const p = sparkPuffs[sparkCursor];
        sparkCursor = (sparkCursor + 1) % sparkPuffs.length;
        p.active = true;
        p.life = 0;
        p.maxLife = 0.34 + Math.random() * 0.24;
        const a = Math.random() * Math.PI * 2;
        const spd = 1.15 + Math.random() * 1.45;
        p.vx = Math.cos(a) * spd;
        p.vy = 1.35 + Math.random() * 1.15;
        p.vz = Math.sin(a) * spd;
        p.mesh.position.set(x, 0.34, z);
        p.mesh.scale.setScalar(0.95);
        p.mesh.visible = true;
      }
    }

    // Atmospheric Sunlit Floating Dust Motes (64 ambient Points drifting gently over the island)
    const DUST_COUNT = 64;
    const dustPositions = new Float32Array(DUST_COUNT * 3);
    const dustSeeds = new Float32Array(DUST_COUNT * 3); // [baseX, baseY, phase]
    for (let i = 0; i < DUST_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 7.8;
      const x = Math.cos(a) * r;
      const y = 0.45 + Math.random() * 3.4;
      const z = Math.sin(a) * r;
      dustPositions[i * 3] = x;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = z;
      dustSeeds[i * 3] = x;
      dustSeeds[i * 3 + 1] = y;
      dustSeeds[i * 3 + 2] = Math.random() * Math.PI * 2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      map: getSoftGlowParticleTexture(),
      color: initPal.sunGlow,
      size: 0.19,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    dustPoints.frustumCulled = false;
    fxGroup.add(dustPoints);

    // Interactable hit meshes for fast raycasting
    let interactableHexes: THREE.Mesh[] = [];
    const machineMeshes = new Map<HexKey, THREE.Group>();
    const machineMeshSignatures = new Map<HexKey, string>();
    const prevMachineIds = new Map<HexKey, string>();
    const machineDropAge = new Map<HexKey, number>();
    const tokenVisuals = new Map<
      string,
      { group: THREE.Group; value: number; theme: PaletteThemeId; popAge: number }
    >();
    const consumedVisuals = new Map<
      string,
      { group: THREE.Group; value: number; theme: PaletteThemeId }
    >();
    const pendingVfxEvents: SimEvent[] = [];
    let prevUpdateTick = -1;
    let prevUpdateAlpha = 1;
    const fallingVisuals: Array<{
      group: THREE.Group;
      vx: number;
      vy: number;
      vz: number;
      rx: number;
      rz: number;
      life: number;
      maxLife: number;
    }> = [];
    const bondMeshes: THREE.Group[] = [];

    function clearFallingTokens() {
      while (fallingVisuals.length > 0) {
        const fv = fallingVisuals.pop()!;
        fxGroup.remove(fv.group);
        disposeObjectTree(fv.group);
      }
    }

    function spawnFallingToken(value: number, fromCoord: AxialCoord, toCoord: AxialCoord) {
      const pal = PALETTES[propsRef.current.theme];
      const group = buildTokenMesh(value, pal, propsRef.current.theme, maxAniso);
      const wFrom = hexToWorld(fromCoord);
      const wTo = hexToWorld(toCoord);
      const dx = wTo.x - wFrom.x;
      const dz = wTo.z - wFrom.z;
      group.position.set(wFrom.x, 0.14, wFrom.z);
      fxGroup.add(group);
      spawnSparkBurst((wFrom.x + wTo.x) * 0.5, (wFrom.z + wTo.z) * 0.5, 8);
      fallingVisuals.push({
        group,
        vx: dx * 2.2,
        vy: 1.6,
        vz: dz * 2.2,
        rx: (Math.random() - 0.5) * 6,
        rz: (Math.random() - 0.5) * 6,
        life: 0,
        maxLife: 1.35,
      });
    }

    function clearGroup(g: THREE.Group) {
      while (g.children.length > 0) {
        const child = g.children[0];
        g.remove(child);
        disposeObjectTree(child);
      }
    }

    function syncTheme() {
      const pal = PALETTES[propsRef.current.theme];
      scene.background = new THREE.Color(pal.fogColor);
      (scene.fog as THREE.FogExp2).color.setHex(pal.fogColor);
      (scene.fog as THREE.FogExp2).density = propsRef.current.theme === 'workshop' ? 0.0072 : 0.0084;
      skyMat.uniforms.uZenith.value.setHex(pal.skyZenith);
      skyMat.uniforms.uMid.value.setHex(pal.skyMid);
      skyMat.uniforms.uHorizon.value.setHex(pal.skyHorizon);
      skyMat.uniforms.uAbyss.value.setHex(pal.skyAbyss);
      skyMat.uniforms.uSunGlow.value.setHex(pal.sunGlow);

      hemiLight.color.setHex(pal.hemiSky);
      hemiLight.groundColor.setHex(pal.hemiGround);
      hemiLight.intensity = propsRef.current.theme === 'workshop' ? 0.92 : 0.88;
      keyLight.color.setHex(pal.sunColor);
      keyLight.intensity = propsRef.current.theme === 'workshop' ? 1.52 : 1.44;
      dustMat.color.setHex(pal.sunGlow);
    }

    function rebuildGrid() {
      clearGroup(gridGroup);
      clearGroup(cliffGroup);
      activeWaterMat = null;
      activeWaterfallMat = null;
      animatedSceneryNodes = [];
      clearGroup(sceneryGroup);
      interactableHexes = [];

      const pal = PALETTES[propsRef.current.theme];
      const worldSnap = propsRef.current.world;
      const tileGeo = getSharedHexTileGeometry();
      const hitGeo = getSharedHexHitGeometry();
      const layout = computeIslandTerrainLayout(worldSnap.platformHexes, worldSnap.narrowGapHexes);

      // Expand shadow frustum dynamically to embrace enlarged playable deck + 3-ring terraces
      const shadowSpan = Math.max(15, layout.outerWorldR * 1.38);
      keyLight.shadow.camera.left = -shadowSpan;
      keyLight.shadow.camera.right = shadowSpan;
      keyLight.shadow.camera.top = shadowSpan;
      keyLight.shadow.camera.bottom = -shadowSpan;
      keyLight.shadow.camera.far = Math.max(54, shadowSpan * 2.8);
      keyLight.shadow.camera.updateProjectionMatrix();

      // Matte tactile stone/ceramic hex deck materials; instance colors apply subtle per-tile variation
      const topMat = createCelMaterial(0xffffff, {
        roughness: 0.7,
        metalness: 0.03,
        envMapIntensity: 0.34,
      });
      const sideMat = createCelMaterial(pal.hexSide, {
        roughness: 0.82,
        metalness: 0.04,
      });
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });

      const solidCoords: AxialCoord[] = [];
      const gapCoords: AxialCoord[] = [];
      for (const k of worldSnap.platformHexes) {
        const c = parseHexKey(k);
        if (worldSnap.narrowGapHexes.has(k)) {
          gapCoords.push(c);
        } else {
          solidCoords.push(c);
        }
      }

      // Per-hex instanced recessed dark seam sub-plinths (clean grout lines without outer plate overhang)
      const count = solidCoords.length;
      const seamGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.992, HEX_SIZE * 0.96, 0.34, 6);
      const seamMat = createCelMaterial(pal.ink, { roughness: 0.95, metalness: 0 });
      const seamInst = new THREE.InstancedMesh(seamGeo, seamMat, Math.max(1, count));

      // Instanced beveled playable hex tiles with subtle courtyard edge cornice & tonal variation
      const tileInst = new THREE.InstancedMesh(tileGeo, [topMat, sideMat], Math.max(1, count));
      tileInst.receiveShadow = !isSoftwareGl;
      tileInst.castShadow = !isSoftwareGl;
      const baseTopColor = new THREE.Color(pal.hexTop);
      const edgeTintColor = new THREE.Color(pal.hexRim);

      // Crisp flat instanced hex outline rings flush on deck top so cells read clearly on dark slate
      const gridRingGeo = getSharedHexGridRingGeometry();
      const gridRingMat = new THREE.MeshBasicMaterial({
        color: pal.hexGridLine,
        transparent: true,
        opacity: 0.56,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const gridRingInst = new THREE.InstancedMesh(gridRingGeo, gridRingMat, Math.max(1, count));

      const maxR = layout.maxR;
      const hasChasm = layout.hasChasm;

      solidCoords.forEach((c, idx) => {
        const w = hexToWorld(c);
        const ck = hexKey(c);
        _dummy.position.set(w.x, 0, w.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        tileInst.setMatrixAt(idx, _dummy.matrix);

        _dummy.position.set(w.x, 0.004, w.z);
        _dummy.updateMatrix();
        gridRingInst.setMatrixAt(idx, _dummy.matrix);

        _dummy.position.set(w.x, hasChasm ? -0.42 : -0.24, w.z);
        _dummy.scale.set(1, hasChasm ? 2.1 : 1, 1);
        _dummy.updateMatrix();
        seamInst.setMatrixAt(idx, _dummy.matrix);
        _dummy.scale.set(1, 1, 1);

        const hash = Math.abs((c.q * 73856093) ^ (c.r * 19349663)) % 100;
        const shade = 0.94 + (hash / 100) * 0.085;
        _tileColor.copy(baseTopColor).multiplyScalar(shade);
        if (layout.edgePlayableKeys.has(ck)) {
          _tileColor.lerp(edgeTintColor, 0.16);
        }
        tileInst.setColorAt(idx, _tileColor);

        // Invisible hit mesh for raycasting
        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.position.set(w.x, -0.1, w.z);
        hit.userData.coord = c;
        gridGroup.add(hit);
        interactableHexes.push(hit);
      });
      if (count > 0) {
        if (tileInst.instanceColor) tileInst.instanceColor.needsUpdate = true;
        tileInst.computeBoundingSphere();
        gridRingInst.computeBoundingSphere();
        seamInst.computeBoundingSphere();
        gridGroup.add(seamInst, tileInst, gridRingInst);
      }

      // Subtle architectural compass medallion ring recessed on center origin hex (0,0)
      if (worldSnap.platformHexes.has('0,0') && !worldSnap.narrowGapHexes.has('0,0')) {
        const originRingGeo = new THREE.RingGeometry(HEX_SIZE * 0.43, HEX_SIZE * 0.49, 6);
        originRingGeo.rotateX(-Math.PI / 2);
        originRingGeo.rotateY(Math.PI / 6);
        const originRingMat = new THREE.MeshBasicMaterial({
          color: pal.hexRim,
          transparent: true,
          opacity: 0.45,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const originRing = new THREE.Mesh(originRingGeo, originRingMat);
        originRing.position.set(0, 0.005, 0);
        gridGroup.add(originRing);
      }

      // Render narrow-gap fissure hexes: sunken abyssal pit rimmed with amber caution beacon ring
      if (gapCoords.length > 0) {
        const gapRingMat = createCelMaterial(0xf59e0b, {
          emissive: 0xd97706,
          emissiveIntensity: 0.45,
          roughness: 0.45,
        });
        const gapAbyssMat = createCelMaterial(pal.cliffSide, { roughness: 0.95, metalness: 0.02 });
        const gapWarnGeo = new THREE.RingGeometry(HEX_SIZE * 0.66, HEX_SIZE * 0.84, 6);
        gapWarnGeo.rotateX(-Math.PI / 2);
        gapWarnGeo.rotateY(Math.PI / 6);

        for (const gc of gapCoords) {
          const gw = hexToWorld(gc);
          const pit = new THREE.Mesh(
            new THREE.CylinderGeometry(HEX_SIZE * 0.84, HEX_SIZE * 0.68, 0.34, 6),
            gapAbyssMat,
          );
          pit.position.set(gw.x, -0.42, gw.z);
          addInkOutline(pit, pal.ink, 0.02);
          gridGroup.add(pit);

          const warnFrame = new THREE.Mesh(gapWarnGeo, gapRingMat);
          warnFrame.position.set(gw.x, -0.02, gw.z);
          gridGroup.add(warnFrame);

          // Cross-bridge laser guide bars hinting polymers can span across
          const bridgeHint = new THREE.Mesh(
            new THREE.BoxGeometry(HEX_SIZE * 1.1, 0.024, 0.09),
            gapRingMat,
          );
          bridgeHint.position.set(gw.x, -0.04, gw.z);
          gridGroup.add(bridgeHint);

          const hit = new THREE.Mesh(hitGeo, hitMat);
          hit.position.set(gw.x, -0.1, gw.z);
          hit.userData.coord = gc;
          gridGroup.add(hit);
          interactableHexes.push(hit);
        }
      }

      // Multi-Level Sculpted Outer Floating Citadel Terraces (Rings 1..3: masonry retaining walls,
      // mossy meadow turf shelves, luminous step trim rails, carved stone parapets, crystal headlands)
      const terraces = layout.terraces;
      if (terraces.length > 0) {
        const cliffTopMat = createCelMaterial(0xffffff, { roughness: 0.84, metalness: 0.04 });
        const cliffSideMat = createCelMaterial(pal.cliffSide, { roughness: 0.88, metalness: 0.04 });
        const cliffInst = new THREE.InstancedMesh(
          tileGeo,
          [cliffTopMat, cliffSideMat],
          terraces.length,
        );
        cliffInst.receiveShadow = !isSoftwareGl;
        cliffInst.castShadow = !isSoftwareGl;

        const baseCliffTop = new THREE.Color(pal.cliffTop);
        const masonryWarm = new THREE.Color(pal.machineBase).lerp(baseCliffTop, 0.68);
        const crystalTopCol = new THREE.Color(pal.hexRim).lerp(
          new THREE.Color(pal.accentSecondary),
          0.22,
        );

        const turfTerraces: typeof terraces = [];
        const trimTerraces: typeof terraces = [];
        const parapetTerraces: typeof terraces = [];
        const crystalTerraces: typeof terraces = [];

        terraces.forEach((t, idx) => {
          _dummy.position.set(t.x, t.y, t.z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, t.depthScale, 1);
          _dummy.updateMatrix();
          cliffInst.setMatrixAt(idx, _dummy.matrix);
          _dummy.scale.set(1, 1, 1);

          const hash = Math.abs((t.coord.q * 19349663) ^ (t.coord.r * 83492791)) % 100;
          const shade = 0.9 + (hash / 100) * 0.16;
          if (t.kind === 'crystal') {
            _tileColor.copy(crystalTopCol).multiplyScalar(shade);
            crystalTerraces.push(t);
          } else if (t.kind === 'turf') {
            _tileColor.copy(baseCliffTop).multiplyScalar(0.92 * shade);
            turfTerraces.push(t);
          } else {
            _tileColor
              .copy(t.ring === 2 && t.y > 0.1 ? masonryWarm : baseCliffTop)
              .multiplyScalar(shade);
          }
          cliffInst.setColorAt(idx, _tileColor);

          if (t.hasTrimRail) trimTerraces.push(t);
          if (t.hasParapet) parapetTerraces.push(t);
        });
        if (cliffInst.instanceColor) cliffInst.instanceColor.needsUpdate = true;
        cliffInst.computeBoundingSphere();
        cliffGroup.add(cliffInst);

        // Cushioned mossy grass meadow caps atop botanical terraces
        if (turfTerraces.length > 0) {
          const turfGeo = createTerraceTurfCapGeometry();
          const turfMat = createCelMaterial(0xffffff, { roughness: 0.84, metalness: 0.02 });
          const turfInst = new THREE.InstancedMesh(turfGeo, turfMat, turfTerraces.length);
          turfInst.receiveShadow = !isSoftwareGl;
          turfInst.castShadow = !isSoftwareGl;
          const baseGrass = new THREE.Color(pal.valleyGrass);
          const sunGrass = baseGrass.clone().lerp(new THREE.Color(pal.cloudTop), 0.16);

          turfTerraces.forEach((t, idx) => {
            _dummy.position.set(t.x, t.y + 0.012, t.z);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            turfInst.setMatrixAt(idx, _dummy.matrix);

            const h = Math.abs((t.coord.q * 73856093) ^ (t.coord.r * 19349663)) % 100;
            _tileColor
              .copy(baseGrass)
              .lerp(sunGrass, h / 100)
              .multiplyScalar(t.y > 0.2 ? 1.08 : 0.96);
            turfInst.setColorAt(idx, _tileColor);
          });
          if (turfInst.instanceColor) turfInst.instanceColor.needsUpdate = true;
          turfInst.computeBoundingSphere();
          cliffGroup.add(turfInst);
        }

        // Luminous architectural step trim rails framing ring-1 transitions
        if (trimTerraces.length > 0) {
          const trimGeo = createTerraceTrimRingGeometry();
          const trimMat = createCelMaterial(pal.accentSecondary, {
            emissive: pal.accentSecondary,
            emissiveIntensity: 0.42,
            roughness: 0.28,
            metalness: 0.2,
          });
          const trimInst = new THREE.InstancedMesh(trimGeo, trimMat, trimTerraces.length);
          trimTerraces.forEach((t, idx) => {
            _dummy.position.set(t.x, t.y - 0.015, t.z);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            trimInst.setMatrixAt(idx, _dummy.matrix);
          });
          trimInst.computeBoundingSphere();
          cliffGroup.add(trimInst);
        }

        // Carved stone citadel parapets & bollards oriented radially outward on upper masonry ledges
        if (parapetTerraces.length > 0) {
          const parapetGeo = createTerraceParapetGeometry();
          const parapetCol = new THREE.Color(pal.cliffTop)
            .lerp(new THREE.Color(pal.machineTop), 0.48)
            .getHex();
          const parapetMat = createCelMaterial(parapetCol, { roughness: 0.78, metalness: 0.08 });
          const parapetInst = new THREE.InstancedMesh(
            parapetGeo,
            parapetMat,
            parapetTerraces.length,
          );
          parapetInst.castShadow = !isSoftwareGl;
          parapetInst.receiveShadow = !isSoftwareGl;
          parapetTerraces.forEach((t, idx) => {
            _dummy.position.set(t.x, t.y, t.z);
            _dummy.rotation.set(0, Math.atan2(-(t.x - layout.centerX), -(t.z - layout.centerZ)), 0);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            parapetInst.setMatrixAt(idx, _dummy.matrix);
          });
          parapetInst.computeBoundingSphere();
          cliffGroup.add(parapetInst);
        }

        // Subtle inner glowing rune medallions on crystal headland terraces
        if (crystalTerraces.length > 0) {
          const cRingGeo = new THREE.RingGeometry(HEX_SIZE * 0.24, HEX_SIZE * 0.35, 6);
          cRingGeo.rotateX(-Math.PI / 2);
          cRingGeo.rotateY(Math.PI / 6);
          const cRingMat = new THREE.MeshBasicMaterial({
            color: pal.accentSecondary,
            transparent: true,
            opacity: 0.44,
          });
          const cRingInst = new THREE.InstancedMesh(cRingGeo, cRingMat, crystalTerraces.length);
          crystalTerraces.forEach((t, idx) => {
            _dummy.position.set(t.x, t.y + 0.016, t.z);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(1, 1, 1);
            _dummy.updateMatrix();
            cRingInst.setMatrixAt(idx, _dummy.matrix);
          });
          cRingInst.computeBoundingSphere();
          cliffGroup.add(cRingInst);
        }
      }

      // Hero Landmarks, Waterfalls, Flora & Citadel Accents across the terraced island
      for (const lm of layout.landmarks) {
        let node: THREE.Group | null = null;
        if (lm.kind === 'observatory') {
          node = buildBrassAstrolabeObservatory(pal);
        } else if (lm.kind === 'waterfall') {
          const wf = buildCrystalSpringWaterfall(pal);
          activeWaterfallMat = wf.waterfallMaterial;
          node = wf.group;
        } else if (lm.kind === 'windvane') {
          node = buildSkyWindVaneTower(pal, lm.seed);
        } else if (lm.kind === 'pergola') {
          node = buildStoneArchPergola(pal);
        } else if (lm.kind === 'pylon') {
          node = buildLevitatingCrystalPylon(pal, lm.seed * 0.4);
        } else if (lm.kind === 'bonsai') {
          node = buildBonsaiTreeGroup(pal, lm.seed);
        } else if (lm.kind === 'blossom') {
          node = buildBlossomBonsaiGroup(pal, lm.seed);
        } else if (lm.kind === 'beacon') {
          node = buildPlatformBeaconPost(pal);
        } else if (lm.kind === 'boulder') {
          node = buildTerraceBoulder(pal, lm.seed);
        } else if (lm.kind === 'crystalCluster') {
          node = buildCrystalOutcropGroup(pal, lm.seed);
        }
        if (node) {
          node.position.set(lm.x, lm.y, lm.z);
          node.rotation.y = lm.rotY;
          node.scale.setScalar(lm.scale);
          sceneryGroup.add(node);
        }
      }

      // Rich stylized 3D canyon valley vista below & around the floating citadel
      const valley = buildScenicValleyEnvironment(pal);
      activeWaterMat = valley.waterMaterial;
      sceneryGroup.add(valley.group);

      // Multi-tiered rocky underbelly + hanging cables beneath the enlarged terraced citadel
      const underbelly = buildIslandUnderbellyAndCables(maxR, pal, hasChasm, layout.outerWorldR);
      sceneryGroup.add(underbelly);

      // 5 Nearby Orbiting Levitating Rock Shards tethered with catenary cables to the citadel rim
      for (let i = 0; i < layout.orbitShards.length; i++) {
        const s = layout.orbitShards[i];
        const wx = (s.tetherStart.x - s.x) / s.scale;
        const wy = (s.tetherStart.y - s.y) / s.scale;
        const wz = (s.tetherStart.z - s.z) / s.scale;
        const cosR = Math.cos(s.rotY);
        const sinR = Math.sin(s.rotY);
        const tetherDelta = {
          x: wx * cosR - wz * sinR,
          y: wy,
          z: wx * sinR + wz * cosR,
        };
        const shard = buildOrbitingRockShard(pal, i + 1, s.hasShrine, tetherDelta);
        shard.position.set(s.x, s.y, s.z);
        shard.rotation.y = s.rotY;
        shard.scale.setScalar(s.scale);
        shard.userData.sceneryAnim = 'miniIsland';
        shard.userData.baseY = s.y;
        shard.userData.amp = 0.12;
        shard.userData.phase = s.phase;
        sceneryGroup.add(shard);
      }

      // Soft glowing firefly motes hovering around garden terraces and crystal springs
      sceneryGroup.add(
        buildTerraceFireflies(pal, layout.outerWorldR, layout.centerX, layout.centerZ),
      );

      // Distant Monument Valley floating terrace mini-islands framed beyond tethered shards
      const miniAngles = [-Math.PI * 0.78, -Math.PI * 0.21, Math.PI * 0.16];
      for (let m = 0; m < miniAngles.length; m++) {
        const ang = miniAngles[m];
        const dist = layout.outerWorldR + 5.6 + (m % 2) * 2.2;
        const mini = buildFloatingMiniIsland(pal, m);
        mini.position.set(
          layout.centerX + Math.cos(ang) * dist,
          0.7 - m * 0.48,
          layout.centerZ + Math.sin(ang) * dist,
        );
        mini.scale.setScalar(m === 2 ? 0.8 : 0.96);
        mini.userData.sceneryAnim = 'miniIsland';
        mini.userData.baseY = mini.position.y;
        mini.userData.amp = 0.26;
        mini.userData.phase = m * 2.1;
        sceneryGroup.add(mini);
      }

      // 4 soft distant twilight clouds framed along the upper horizon without blocking valley landmarks
      const cloudAngles = [-2.35, -1.75, -1.15, -0.58];
      for (let cl = 0; cl < cloudAngles.length; cl++) {
        const cloud = buildStylizedCloudGroup(pal, cl);
        const ang = cloudAngles[cl];
        const rad = layout.outerWorldR + 8.5 + (cl % 2) * 2.4;
        const cx = layout.centerX + Math.cos(ang) * rad;
        const cz = layout.centerZ + Math.sin(ang) * rad;
        const cy = -1.5 + (cl % 2) * 1.1;
        cloud.position.set(cx, cy, cz);
        cloud.scale.setScalar(0.9 + (cl % 2) * 0.22);
        cloud.userData.sceneryAnim = 'cloud';
        cloud.userData.baseX = cx;
        cloud.userData.speed = 0.14 + (cl % 2) * 0.06;
        cloud.userData.phase = cl * 1.4;
        sceneryGroup.add(cloud);
      }

      sceneryGroup.traverse((obj) => {
        if (obj.userData?.sceneryAnim) {
          animatedSceneryNodes.push(obj);
        }
      });
    }

    function syncMachines() {
      clearGroup(machineDecorationGroup);
      clearGroup(channelGroup);
      activeChannelMat = null;
      for (const [key, mesh] of machineMeshes) {
        if (!propsRef.current.world.machines.has(key)) {
          machineGroup.remove(mesh);
          disposeObjectTree(mesh);
          machineMeshes.delete(key);
          machineMeshSignatures.delete(key);
        }
      }
      const pal = PALETTES[propsRef.current.theme];
      const nextIds = new Map<HexKey, string>();

      // Flush recessed socket collar geometry shared across spawner/sink tiles
      const socketRingGeo = new THREE.RingGeometry(HEX_SIZE * 0.72, HEX_SIZE * 0.84, 6);
      socketRingGeo.rotateX(-Math.PI / 2);
      socketRingGeo.rotateY(Math.PI / 6);
      let hasIoSocket = false;

      for (const [k, machine] of propsRef.current.world.machines.entries()) {
        const sig = `${machine.id}:${machine.type}`;
        nextIds.set(k, sig);
        if (prevMachineIds.size > 0 && prevMachineIds.get(k) !== sig) {
          machineDropAge.set(k, 0);
        }
        const meshSig = machineMeshSignature(machine, propsRef.current.world.machines, propsRef.current.theme);
        if (machineMeshSignatures.get(k) !== meshSig) {
          const previous = machineMeshes.get(k);
          if (previous) {
            machineGroup.remove(previous);
            disposeObjectTree(previous);
          }
          const mesh = buildMachineMesh(machine, pal, maxAniso, propsRef.current.world.machines);
          const w = hexToWorld(machine.coord);
          mesh.position.set(w.x, 0, w.z);
          machineGroup.add(mesh);
          machineMeshes.set(k, mesh);
          machineMeshSignatures.set(k, meshSig);
        }

        if (machine.type === 'spawner' || machine.type === 'sink') {
          hasIoSocket = true;
          const sockCol = machine.type === 'spawner' ? pal.accent : pal.accentSecondary;
          for (const pad of getMachineFootprint(machine)) {
            const pw = hexToWorld(pad);
            const sockMat = new THREE.MeshBasicMaterial({
              color: sockCol,
              transparent: true,
              opacity: 0.42,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            });
            const sock = new THREE.Mesh(socketRingGeo, sockMat);
            sock.position.set(pw.x, 0.006, pw.z);
            machineDecorationGroup.add(sock);
          }
        }
      }
      if (!hasIoSocket) {
        socketRingGeo.dispose();
      }

      // Seamless conveyor track junction couplers
      const connectors = buildConveyorConnectorGroup(propsRef.current.world.machines, pal);
      machineDecorationGroup.add(connectors);

      // Inlaid luminous pathway channels connecting adjacent flows
      const inlaid = buildInlaidChannelGroup(
        propsRef.current.world.machines,
        propsRef.current.world.platformHexes,
        pal,
      );
      channelGroup.add(inlaid.group);
      activeChannelMat = inlaid.material;

      prevMachineIds.clear();
      for (const [k, sig] of nextIds.entries()) {
        prevMachineIds.set(k, sig);
      }
    }

    // Initial build
    syncTheme();
    rebuildGrid();
    syncMachines();

    // Pre-warm shaders on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Tactical 3D Field Overlay Builder (ports, magnet pull, laser seam, 60-deg rotator sweep)
    function addTacticalArrow(
      fromCoord: AxialCoord,
      dir: HexDir,
      colorHex: number,
      inkColor: number,
      lenScale = 0.9,
      yPos = 0.08,
    ) {
      const w = hexToWorld(fromCoord);
      const yaw = dirToWorldYaw(dir);
      const arrowGrp = new THREE.Group();
      arrowGrp.position.set(w.x, yPos, w.z);
      arrowGrp.rotation.y = yaw;

      const mat = createCelMaterial(colorHex, {
        emissive: colorHex,
        emissiveIntensity: 0.38,
      });
      const shaftLen = HEX_SIZE * 0.82 * lenScale;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(shaftLen, 0.045, 0.12), mat);
      shaft.position.set(HEX_SIZE * 0.48 + shaftLen * 0.5, 0, 0);
      addInkOutline(shaft, inkColor, 0.016);

      const headShape = new THREE.Shape();
      headShape.moveTo(-0.08, -0.17);
      headShape.lineTo(0.2, 0);
      headShape.lineTo(-0.08, 0.17);
      headShape.lineTo(-0.02, 0);
      headShape.closePath();
      const headGeo = new THREE.ExtrudeGeometry(headShape, {
        depth: 0.055,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.012,
        bevelSegments: 1,
      });
      headGeo.rotateX(-Math.PI / 2);
      headGeo.translate(0, -0.027, 0);
      const head = new THREE.Mesh(headGeo, mat);
      head.position.set(HEX_SIZE * 0.48 + shaftLen + 0.04, 0, 0);
      addInkOutline(head, inkColor, 0.016);

      arrowGrp.add(shaft, head);
      tacticalGroup.add(arrowGrp);
    }

    function addTacticalHexRing(coord: AxialCoord, colorHex: number, yPos = 0.06) {
      const w = hexToWorld(coord);
      const ring = new THREE.Mesh(
        hoverRingGeo,
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(w.x, yPos, w.z);
      ring.scale.setScalar(0.92);
      tacticalGroup.add(ring);
    }

    function rebuildTacticalOverlay(
      coord: AxialCoord,
      mType: MachineType,
      dir: HexDir,
      altDir: HexDir,
      rotMode: RotatorMode,
      inkColor: number,
    ) {
      clearGroup(tacticalGroup);

      if (
        mType === 'conveyor' ||
        mType === 'add1' ||
        mType === 'sub1' ||
        mType === 'mul2' ||
        mType === 'div2' ||
        mType === 'sqrt' ||
        mType === 'neg' ||
        mType === 'adder' ||
        mType === 'spawner'
      ) {
        addTacticalArrow(coord, dir, 0x26b557, inkColor, 0.9);
        addTacticalHexRing(hexNeighbor(coord, dir), 0x86efac, 0.055);
      } else if (
        mType === 'filter' ||
        mType === 'divmod' ||
        mType === 'dup' ||
        mType === 'splitter' ||
        mType === 'halver' ||
        mType === 'scales'
      ) {
        addTacticalArrow(coord, dir, 0x26b557, inkColor, 0.9);
        addTacticalHexRing(hexNeighbor(coord, dir), 0x86efac, 0.055);
        const secColor =
          mType === 'dup' || mType === 'splitter' || mType === 'halver' ? 0x38bdf8 : 0xf59e0b;
        addTacticalArrow(coord, altDir, secColor, inkColor, 0.82, 0.09);
        addTacticalHexRing(hexNeighbor(coord, altDir), secColor, 0.058);
      } else if (mType === 'jumper') {
        const d1 = hexNeighbor(coord, dir);
        const d2 = hexNeighbor(d1, dir);
        addTacticalArrow(coord, dir, 0xfde047, inkColor, 1.55, 0.22);
        addTacticalHexRing(d1, 0x94a3b8, 0.045);
        addTacticalHexRing(d2, 0x38bdf8, 0.07);
      } else if (mType === 'swapper') {
        const dFront = hexNeighbor(coord, dir);
        const dBack = hexNeighbor(coord, ((dir + 3) % 6) as HexDir);
        addTacticalHexRing(dFront, 0xfde047, 0.065);
        addTacticalHexRing(dBack, 0x38bdf8, 0.065);
      } else if (mType === 'destroyer') {
        addTacticalHexRing(coord, 0xef4444, 0.065);
      } else if (mType === 'pusher') {
        const d1 = hexNeighbor(coord, dir);
        const d2 = hexNeighbor(d1, dir);
        addTacticalHexRing(d1, 0xf97316, 0.06);
        addTacticalArrow(d1, dir, 0xf97316, inkColor, 0.92, 0.09);
        addTacticalHexRing(d2, 0xfdba74, 0.055);
      } else if (mType === 'magnet') {
        const d1 = hexNeighbor(coord, dir);
        const d2 = hexNeighbor(d1, dir);
        addTacticalHexRing(d1, 0x7dd3fc, 0.055);
        addTacticalHexRing(d2, 0x38bdf8, 0.065);
        // Attraction vector pulling from d2 back toward d1
        addTacticalArrow(d2, ((dir + 3) % 6) as HexDir, 0x38bdf8, inkColor, 0.88, 0.09);
      } else if (mType === 'welder') {
        const d1 = hexNeighbor(coord, dir);
        addTacticalHexRing(coord, 0xfbbf24, 0.06);
        addTacticalHexRing(d1, 0xfbbf24, 0.06);
        const w0 = hexToWorld(coord);
        const w1 = hexToWorld(d1);
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(HEX_SIZE * 1.45, 0.05, 0.16),
          createCelMaterial(0xfbbf24, { emissive: 0xf59e0b, emissiveIntensity: 0.45 }),
        );
        bar.position.set((w0.x + w1.x) * 0.5, 0.085, (w0.z + w1.z) * 0.5);
        bar.rotation.y = dirToWorldYaw(dir);
        addInkOutline(bar, inkColor, 0.02);
        tacticalGroup.add(bar);
      } else if (mType === 'laser') {
        const d1 = hexNeighbor(coord, dir);
        addTacticalHexRing(d1, 0x22d3ee, 0.06);
        const w0 = hexToWorld(coord);
        const w1 = hexToWorld(d1);
        const seam = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.07, HEX_SIZE * 1.15),
          createCelMaterial(0x22d3ee, { emissive: 0x06b6d4, emissiveIntensity: 0.65 }),
        );
        seam.position.set((w0.x + w1.x) * 0.5, 0.095, (w0.z + w1.z) * 0.5);
        seam.rotation.y = dirToWorldYaw(dir);
        addInkOutline(seam, inkColor, 0.018);
        tacticalGroup.add(seam);
      } else if (mType === 'rotator') {
        const cwSteps = rotMode === 'ccw' ? -1 : 1;
        const grabCoord = hexNeighbor(coord, dir);
        const destCoord = rotateAroundPivot(grabCoord, coord, cwSteps);
        addTacticalHexRing(grabCoord, 0xfde047, 0.062);
        addTacticalHexRing(destCoord, 0x14b8a6, 0.065);

        const pivotW = hexToWorld(coord);
        const grabW = hexToWorld(grabCoord);
        const radius = Math.hypot(grabW.x - pivotW.x, grabW.z - pivotW.z);
        const startAng = Math.atan2(grabW.z - pivotW.z, grabW.x - pivotW.x);
        const sweepDelta = cwSteps === 1 ? Math.PI / 3 : -Math.PI / 3;

        const arcSegs = 12;
        const arcMat = createCelMaterial(0x14b8a6, {
          emissive: 0x14b8a6,
          emissiveIntensity: 0.45,
        });
        for (let i = 0; i < arcSegs; i++) {
          const tMid = (i + 0.5) / arcSegs;
          const a = startAng + sweepDelta * tMid;
          const seg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.1), arcMat);
          seg.position.set(
            pivotW.x + Math.cos(a) * radius,
            0.09,
            pivotW.z + Math.sin(a) * radius,
          );
          seg.rotation.y = -a + Math.PI / 2;
          tacticalGroup.add(seg);
        }
        const endAng = startAng + sweepDelta;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.26, 4), arcMat);
        tip.position.set(
          pivotW.x + Math.cos(endAng) * radius,
          0.095,
          pivotW.z + Math.sin(endAng) * radius,
        );
        tip.rotation.order = 'YXZ';
        tip.rotation.y = -endAng + (cwSteps === 1 ? Math.PI : 0);
        tip.rotation.x = Math.PI / 2;
        addInkOutline(tip, inkColor, 0.02);
        tacticalGroup.add(tip);

        const wNow = propsRef.current.world;
        const tokAtGrab = Array.from(wNow.tokens.values()).find((t) => hexEqual(t.coord, grabCoord));
        if (tokAtGrab) {
          const comp = getConnectedComponents(wNow).find((c) => c.tokenIds.includes(tokAtGrab.id));
          const compIds = comp?.tokenIds ?? [tokAtGrab.id];
          for (const tid of compIds) {
            const pt = wNow.tokens.get(tid);
            if (!pt) continue;
            for (const sh of getRotationSweptHexes(pt.coord, coord, cwSteps)) {
              const sm = wNow.machines.get(hexKey(sh));
              const blockedSolid = Boolean(sm && SOLID_MACHINE_TYPES.has(sm.type));
              addTacticalHexRing(sh, blockedSolid ? 0xef4444 : 0x2dd4bf, 0.052);
            }
          }
        }
      } else if (mType === 'sink') {
        const wNow = propsRef.current.world;
        const cKey = hexKey(coord);
        const sinkId = wNow.sinkFootprintHexes.get(cKey);
        const sinkMach =
          wNow.machines.get(cKey) ??
          (sinkId ? Array.from(wNow.machines.values()).find((m) => m.id === sinkId) : undefined);
        if (sinkMach) {
          for (const pad of getMachineFootprint(sinkMach)) {
            addTacticalHexRing(pad, 0x26b557, 0.065);
          }
        } else {
          addTacticalHexRing(coord, 0x26b557, 0.065);
        }
      }
    }

    // Raycaster & Drag-and-Drop Pointer State
    const input = createSceneInput(renderer, camera, controls, propsRef, machineMeshes, () => interactableHexes, () => { ghostKey = ''; });

    // ResizeObserver for clean responsive sizing
    const resizeObs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
      renderer.render(scene, camera);
    });
    resizeObs.observe(container);

    // Context loss safety
    function onContextLost(e: Event) {
      e.preventDefault();
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    // Smart Camera Auto-Framing over world.platformHexes
    const autoCamPos = defaultCamPos.clone();
    const autoCamTarget = defaultTarget.clone();
    let autoFrameActive = false;

    controls.addEventListener('start', () => {
      autoFrameActive = false;
      if (propsRef.current.continuousCamera) {
        propsRef.current.onStopContinuousCamera?.();
      }
    });

    function focusCoord(coord: AxialCoord) {
      const w = hexToWorld(coord);
      autoCamTarget.set(w.x, 0.15, w.z);
      autoCamPos.set(w.x, 8.8, w.z + 7.6);
      autoFrameActive = true;
    }

    function resetCamera() {
      const hexKeys = propsRef.current.world.platformHexes;
      if (hexKeys.size === 0) {
        autoCamPos.copy(defaultCamPos);
        autoCamTarget.copy(defaultTarget);
        autoFrameActive = true;
        return;
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const k of hexKeys) {
        const w = hexToWorld(parseHexKey(k));
        if (w.x < minX) minX = w.x;
        if (w.x > maxX) maxX = w.x;
        if (w.z < minZ) minZ = w.z;
        if (w.z > maxZ) maxZ = w.z;
      }

      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const halfX = (maxX - minX) * 0.5 + HEX_SIZE * 2.95;
      const halfZ = (maxZ - minZ) * 0.5 + HEX_SIZE * 2.95;

      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      const tanHalfV = Math.tan(vFovRad * 0.5);
      const aspect = Math.max(0.55, camera.aspect || 1.6);
      const distV = (halfZ * 1.48) / tanHalfV;
      const distH = (halfX * 1.56) / (tanHalfV * aspect);
      const dist = THREE.MathUtils.clamp(Math.max(distV, distH, 16.5), 16.5, 42.0);
      const hudOffsetX = halfX > 5.8 ? 1.55 : 0.75;

      autoCamTarget.set(cx + hudOffsetX, -0.15, cz + 0.15);
      autoCamPos.set(cx + hudOffsetX, dist * 0.65, cz + 0.15 + dist * 0.78);
      autoFrameActive = true;
    }

    if (!propsRef.current.isTitleMode) {
      resetCamera();
      camera.position.copy(autoCamPos);
      controls.target.copy(autoCamTarget);
      controls.update();
      autoFrameActive = false;
    }
    renderer.render(scene, camera);

    function emitEventFx(ev: SimEvent) {
      const w = hexToWorld(ev.coord);
      if (ev.type === 'deliver' || ev.type === 'weld' || ev.type === 'spawn' || ev.type === 'cut') {
        const burstCount = ev.type === 'deliver' ? 8 : ev.type === 'cut' ? 4 : 3;
        spawnSteamBurst(w.x, w.z, burstCount);
      }
      if (ev.type === 'weld' || ev.type === 'cut' || ev.type === 'transform' || ev.type === 'destroy') {
        spawnSparkBurst(w.x, w.z, ev.type === 'transform' ? 6 : 9);
      }
      if (ev.type === 'deliver') {
        spawnPulseRing(w.x, w.z, 0x26b557, 1.95);
        addTrauma(0.16);
      } else if (ev.type === 'weld') {
        spawnPulseRing(w.x, w.z, 0xfbbf24, 1.7);
        addTrauma(0.14);
      } else if (ev.type === 'cut') {
        spawnPulseRing(w.x, w.z, 0x38bdf8, 1.7);
        addTrauma(0.14);
      } else if (ev.type === 'destroy') {
        spawnPulseRing(w.x, w.z, 0xf97316, 1.75);
        addTrauma(0.14);
      } else if (ev.type === 'transform') {
        spawnPulseRing(w.x, w.z, 0xfde047, 1.82, 0);
        spawnPulseRing(w.x, w.z, 0xffffff, 1.35, 0.05);
      } else if (ev.type === 'store') {
        spawnPulseRing(w.x, w.z, 0xfde047, 1.55);
      } else if (ev.type === 'collision' || ev.type === 'error') {
        spawnPulseRing(w.x, w.z, 0xff3b30, 1.95, 0);
        spawnPulseRing(w.x, w.z, 0xff3b30, 2.25, 0.11);
        addTrauma(0.55);
      }
      if (ev.badge && !propsRef.current.isTitleMode) {
        spawnOpPopup(w.x, w.z, ev.badge, ev.severity);
      }
    }

    sceneApiRef.current = {
      rebuildGrid,
      syncMachines,
      syncTheme,
      resetCamera,
      focusCoord,
      spawnFallingToken,
      clearFallingTokens,
      spawnSteamBurst,
      spawnSparkBurst,
      spawnPulseRing,
      spawnOpPopup,
      addTrauma,
      emitEventFx,
      queueEventFx: (ev: SimEvent) => {
        pendingVfxEvents.push(ev);
      },
      clearPendingEventFx: () => {
        pendingVfxEvents.length = 0;
      },
    };

    // Main Render Loop (GPU rAF vs Software WebGL afterDraw)
    let frameId = 0;
    let disposed = false;
    let lastTimeMs = performance.now();
    let elapsed = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function applyTokenGlow(group: THREE.Group, hexColor: number, intensity: number) {
      const bodyMat = group.userData.bodyMat as THREE.MeshStandardMaterial | undefined;
      const rimMat = group.userData.rimMat as THREE.MeshStandardMaterial | undefined;
      if (bodyMat) {
        if (intensity > 0.005) {
          bodyMat.emissive.setHex(hexColor);
          bodyMat.emissiveIntensity = intensity;
        } else if (bodyMat.emissiveIntensity !== 0) {
          bodyMat.emissiveIntensity = 0;
        }
      }
      if (rimMat) {
        if (intensity > 0.005) {
          rimMat.emissive.setHex(0xffffff);
          rimMat.emissiveIntensity = intensity * 1.15;
        } else if (rimMat.emissiveIntensity !== 0) {
          rimMat.emissiveIntensity = 0;
        }
      }
    }

    function updateTokensAndBonds(elapsed: number, dt: number) {
      const { world: wSnap, theme: tId } = propsRef.current;
      const pal = PALETTES[tId];
      const rawAlpha = THREE.MathUtils.clamp(tickProgressRef.current, 0, 1);

      // Tear-free guard: if rAF tick reset alpha -> 0 before React committed next world.tick, hold at 1.0
      let alpha = rawAlpha;
      if (wSnap.tick === prevUpdateTick && rawAlpha < prevUpdateAlpha - 0.5) {
        alpha = 1;
      } else {
        prevUpdateTick = wSnap.tick;
        prevUpdateAlpha = rawAlpha;
      }

      // Flush queued machine VFX (popups, sparks, rings) right at TOKEN_TRIGGER_ALPHA
      if (pendingVfxEvents.length > 0 && alpha >= TOKEN_TRIGGER_ALPHA) {
        for (let i = pendingVfxEvents.length - 1; i >= 0; i--) {
          const ev = pendingVfxEvents[i];
          if (ev.tick <= wSnap.tick) {
            emitEventFx(ev);
            pendingVfxEvents.splice(i, 1);
          }
        }
      }

      // Smooth cubic ease over travel phase [0..TOKEN_ARRIVAL_ALPHA] for rotator/swapper synchronization
      const moveNorm = alpha >= TOKEN_ARRIVAL_ALPHA ? 1 : THREE.MathUtils.clamp(alpha / TOKEN_ARRIVAL_ALPHA, 0, 1);
      const moveEase = moveNorm < 0.5 ? 4 * moveNorm * moveNorm * moveNorm : 1 - Math.pow(-2 * moveNorm + 2, 3) / 2;

      // Remove stale token visuals & dispose GPU resources
      for (const [id, vis] of tokenVisuals.entries()) {
        if (!wSnap.tokens.has(id)) {
          tokenGroup.remove(vis.group);
          disposeObjectTree(vis.group);
          tokenVisuals.delete(id);
        }
      }

      // Position tokens with 3-phase choreography: Travel [0..0.42] -> Dwell [0.42..0.56] -> Trigger & Accent [0.56..1.0]
      const tokenRenderPositions = new Map<string, { x: number; y: number; z: number }>();
      for (const tok of wSnap.tokens.values()) {
        const isMoving =
          Boolean(tok.rotatedFrom) ||
          tok.prevCoord.q !== tok.coord.q ||
          tok.prevCoord.r !== tok.coord.r;
        const prevVal = tok.prevValue ?? tok.value;
        const valueChanged = prevVal !== tok.value;
        const destMachine = wSnap.machines.get(hexKey(tok.coord));
        const machineTriggeredOnTok = Boolean(
          destMachine &&
            destMachine.state.activeFlashTicks > 0 &&
            destMachine.type !== 'spawner' &&
            destMachine.type !== 'conveyor',
        );
        const hasAccent = valueChanged || tok.moveSource === 'split' || machineTriggeredOnTok;

        const tl = evaluateTokenTickTimeline({
          alpha,
          isMoving,
          moveSource: tok.moveSource,
          pushChainIndex: tok.pushChainIndex,
          hasAccent,
        });
        const displayValue = tl.showTransformed ? tok.value : prevVal;

        let vis = tokenVisuals.get(tok.id);
        if (!vis || vis.value !== displayValue || vis.theme !== tId) {
          const isTransformSwap = Boolean(vis && vis.value !== displayValue);
          if (vis) {
            tokenGroup.remove(vis.group);
            disposeObjectTree(vis.group);
          }
          const group = buildTokenMesh(displayValue, pal, tId, maxAniso);
          tokenGroup.add(group);
          vis = {
            group,
            value: displayValue,
            theme: tId,
            popAge: isTransformSwap || (tl.showTransformed && tok.moveSource === 'split') ? 0 : 1,
          };
          tokenVisuals.set(tok.id, vis);
        }
        vis.popAge = Math.min(1, vis.popAge + dt * 2.4);

        if (tl.hiddenBeforeTrigger) {
          vis.group.visible = false;
          continue;
        }
        vis.group.visible = true;

        let wx = 0;
        let wz = 0;
        let hop = 0;
        let pitchX = 0;
        let pitchZ = 0;
        let yawSpin = 0;
        let stretchXZ = 1;
        let stretchY = 1;

        const mT = tl.moveT;
        if (tok.rotatedFrom && mT < 1) {
          const rotEase = mT < 0.5 ? 4 * mT * mT * mT : 1 - Math.pow(-2 * mT + 2, 3) / 2;
          const pW = hexToWorld(tok.rotatedFrom.pivot);
          const sW = hexToWorld(tok.prevCoord);
          const dx = sW.x - pW.x;
          const dz = sW.z - pW.z;
          const rotAngle = -tok.rotatedFrom.angleDelta * rotEase;
          const cos = Math.cos(rotAngle);
          const sin = Math.sin(rotAngle);
          wx = pW.x + (dx * cos - dz * sin);
          wz = pW.z + (dx * sin + dz * cos);
          const isSwap180 = Math.abs(tok.rotatedFrom.angleDelta) > 2;
          hop = Math.sin(mT * Math.PI) * (isSwap180 ? 0.36 : 0.17);
          const armSwing = Math.sin(mT * Math.PI);
          pitchZ = armSwing * 0.1 * Math.sign(tok.rotatedFrom.angleDelta);
          stretchXZ = 1 + armSwing * 0.04;
          stretchY = 1 - armSwing * 0.04;
        } else {
          const sW = hexToWorld(tok.prevCoord);
          const eW = hexToWorld(tok.coord);
          if (isMoving && mT < 1) {
            const kin = evaluateTransportCurve(mT, tok.moveSource ?? 'conveyor');
            hop = kin.hop;
            stretchXZ = kin.stretchXZ;
            stretchY = kin.stretchY;
            wx = THREE.MathUtils.lerp(sW.x, eW.x, kin.tCurve);
            wz = THREE.MathUtils.lerp(sW.z, eW.z, kin.tCurve);

            const dx = eW.x - sW.x;
            const dz = eW.z - sW.z;
            const dist = Math.hypot(dx, dz) || 1;
            const tiltEnv = Math.sin(Math.min(1, Math.max(0, mT)) * Math.PI) * kin.tiltMag;
            pitchX = (dz / dist) * tiltEnv;
            pitchZ = -(dx / dist) * tiltEnv;
          } else {
            wx = eW.x;
            wz = eW.z;
          }
        }

        // Dwell anticipation: subtle mechanical lock-on squash right before the machine strikes
        if (tl.dwellAnticipation > 0) {
          const ant = tl.dwellAnticipation;
          stretchXZ *= 1 + ant * 0.1;
          stretchY *= 1 - ant * 0.12;
        }

        // Held/queued token on blocked side-port breathes gently in amber readiness
        const isWaitingSide = Boolean(tok.waitingSidePort);
        if (isWaitingSide) {
          const holdWave = Math.sin(elapsed * 5.2 + tok.spawnOrder) * 0.05;
          stretchXZ *= 1 + holdWave;
          stretchY *= 1 - holdWave * 0.8;
        }

        // Emphasized transformation pop & golden-white glow after TOKEN_TRIGGER_ALPHA
        let glowColor = 0xffe082;
        let glowIntensity = 0;
        if (tl.transformAccentT > 0 && tl.transformAccentT < 1) {
          const tt = tl.transformAccentT;
          const amp = valueChanged ? 1.0 : 0.55;
          hop += Math.sin(tt * Math.PI) * (valueChanged ? 0.34 : 0.18);
          const pulse = Math.sin(tt * Math.PI * 1.4) * (1 - tt) * 0.34 * amp;
          stretchXZ *= 1 + pulse;
          stretchY *= 1 + Math.sin(tt * Math.PI) * 0.24 * amp - pulse * 0.35;
          yawSpin = valueChanged ? Math.sin(tt * Math.PI) * 0.32 : 0;
          glowIntensity = Math.pow(1 - tt, 1.35) * (valueChanged ? 1.15 : 0.65);
        } else if (isWaitingSide) {
          glowColor = 0xf59e0b;
          glowIntensity = 0.42 + (Math.sin(elapsed * 5.5 + tok.spawnOrder) + 1) * 0.18;
        } else if (vis.popAge < 1) {
          const popWave = Math.sin(vis.popAge * Math.PI * 1.5) * (1 - vis.popAge) * 0.22;
          stretchXZ *= 1 + popWave;
          stretchY *= 1 / Math.sqrt(Math.max(0.65, 1 + popWave));
        }
        applyTokenGlow(vis.group, glowColor, glowIntensity);

        const bob =
          tl.isDwelling || tl.transformAccentT > 0
            ? 0
            : isWaitingSide
              ? Math.sin(elapsed * 4.5 + tok.spawnOrder) * 0.025 + 0.04
              : Math.sin(elapsed * 2.5 + tok.spawnOrder) * 0.014;
        const wy = bob + hop;
        vis.group.position.set(wx, wy, wz);
        vis.group.rotation.set(pitchX, yawSpin, pitchZ);
        vis.group.scale.set(stretchXZ, stretchY, stretchXZ);
        tokenRenderPositions.set(tok.id, { x: wx, y: wy, z: wz });
      }

      // Update consumed tokens (delivered to sink, stored in memory, shredded, or merged):
      // Ride onto target [0..0.42], pause [0.42..0.56], flash & absorb [0.56..0.92]
      const activeConsumedKeys = new Set<string>();
      const consumedList = wSnap.consumedTokens ?? [];
      for (const ct of consumedList) {
        const cKey = `${wSnap.tick}:${ct.id}`;
        activeConsumedKeys.add(cKey);
        let cVis = consumedVisuals.get(cKey);
        if (!cVis || cVis.value !== ct.value || cVis.theme !== tId) {
          if (cVis) {
            tokenGroup.remove(cVis.group);
            disposeObjectTree(cVis.group);
          }
          const group = buildTokenMesh(ct.value, pal, tId, maxAniso);
          tokenGroup.add(group);
          cVis = { group, value: ct.value, theme: tId };
          consumedVisuals.set(cKey, cVis);
        }
        const ctl = evaluateConsumedTokenTimeline(alpha);
        if (!ctl.visible) {
          cVis.group.visible = false;
          continue;
        }
        cVis.group.visible = true;
        let cx = 0;
        let cz = 0;
        let chop = 0;
        const mT = ctl.moveT;
        if (ct.rotatedFrom && mT < 1) {
          const rotEase = mT < 0.5 ? 4 * mT * mT * mT : 1 - Math.pow(-2 * mT + 2, 3) / 2;
          const pW = hexToWorld(ct.rotatedFrom.pivot);
          const sW = hexToWorld(ct.prevCoord);
          const dx = sW.x - pW.x;
          const dz = sW.z - pW.z;
          const rotAngle = -ct.rotatedFrom.angleDelta * rotEase;
          const cos = Math.cos(rotAngle);
          const sin = Math.sin(rotAngle);
          cx = pW.x + (dx * cos - dz * sin);
          cz = pW.z + (dx * sin + dz * cos);
          chop = Math.sin(mT * Math.PI) * 0.16;
        } else {
          const sW = hexToWorld(ct.prevCoord);
          const eW = hexToWorld(ct.coord);
          if (mT < 1) {
            const tCurve = mT < 0.5 ? 2 * mT * mT : 1 - Math.pow(-2 * mT + 2, 2) / 2;
            cx = THREE.MathUtils.lerp(sW.x, eW.x, tCurve);
            cz = THREE.MathUtils.lerp(sW.z, eW.z, tCurve);
            chop = Math.sin(mT * Math.PI) * 0.025;
          } else {
            cx = eW.x;
            cz = eW.z;
          }
        }
        let cScaleXZ = 1;
        let cScaleY = 1;
        let glowHex = 0xffe082;
        let cGlow = 0;
        if (ctl.absorbT > 0) {
          const ab = ctl.absorbT;
          chop += Math.sin(ab * Math.PI) * 0.24;
          const shrink = ab < 0.2 ? 1 + (ab / 0.2) * 0.22 : Math.max(0.02, 1.22 * (1 - (ab - 0.2) / 0.8));
          cScaleXZ = shrink;
          cScaleY = shrink;
          glowHex = ct.kind === 'deliver' ? 0x4ade80 : ct.kind === 'destroy' ? 0xf97316 : 0xfbbf24;
          cGlow = (1 - ab) * 1.25;
        }
        applyTokenGlow(cVis.group, glowHex, cGlow);
        cVis.group.position.set(cx, chop, cz);
        cVis.group.rotation.set(0, 0, 0);
        cVis.group.scale.set(cScaleXZ, cScaleY, cScaleXZ);
        tokenRenderPositions.set(ct.id, { x: cx, y: chop, z: cz });
      }
      for (const [cKey, cVis] of consumedVisuals.entries()) {
        if (!activeConsumedKeys.has(cKey)) {
          tokenGroup.remove(cVis.group);
          disposeObjectTree(cVis.group);
          consumedVisuals.delete(cKey);
        }
      }

      // Update rigid polymer bond rods (including consumed polymers riding onto sink/shredder)
      const consumedBonds = wSnap.consumedBonds ?? [];
      const totalBonds = wSnap.bonds.length + consumedBonds.length;
      while (bondMeshes.length < totalBonds) {
        const rod = buildBondRodMesh(pal);
        bondGroup.add(rod);
        bondMeshes.push(rod);
      }
      for (let i = 0; i < bondMeshes.length; i++) {
        const rod = bondMeshes[i];
        if (i >= totalBonds) {
          rod.visible = false;
          continue;
        }
        const edge =
          i < wSnap.bonds.length ? wSnap.bonds[i] : consumedBonds[i - wSnap.bonds.length];
        const pA = tokenRenderPositions.get(edge.a);
        const pB = tokenRenderPositions.get(edge.b);
        if (!pA || !pB) {
          rod.visible = false;
          continue;
        }
        rod.visible = true;
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const dz = pB.z - pA.z;
        const dist = Math.hypot(dx, dz);
        rod.position.set((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 + 0.24, (pA.z + pB.z) / 2);
        rod.rotation.y = -Math.atan2(dz, dx);
        rod.rotation.z = Math.atan2(dy, Math.max(0.01, dist));
        rod.scale.set(Math.max(0.2, Math.hypot(dist, dy) - 0.35), 1, 1);
      }

      animateMachines(machineMeshes, machineDropAge, wSnap, input.dragActive?.fromCoord ?? null, alpha, moveNorm, moveEase, elapsed, dt);
    }

    function tick() {
      const { dragActive, dragPending, hoveredCoord, keysDown } = input;
      if (disposed) return;
      const nowMs = performance.now();
      const rawDt = (nowMs - lastTimeMs) / 1000;
      const dt = Math.min(rawDt, 0.05);
      const fxDt = Math.min(rawDt, 0.14);
      lastTimeMs = nowMs;
      elapsed += dt;
      const {
        isTitleMode: titleMode,
        world: wSnap,
        selectedTool: tool,
        selectedDir: dir,
        rotatorMode: rotMode,
        theme: tId,
        highlightCoord: coachCoord,
        inspectedCoord: selCoord,
      } = propsRef.current;

      skyMat.uniforms.uTime.value = elapsed;
      skyDome.position.copy(camera.position);
      if (activeWaterMat) {
        activeWaterMat.uniforms.uTime.value = elapsed;
      }
      if (activeWaterfallMat) {
        activeWaterfallMat.uniforms.uTime.value = elapsed;
      }

      // Animate inlaid pathway channel pulses smoothly
      const targetChannelActive = propsRef.current.isSimPlaying ? 1.0 : 0.28;
      channelActiveBlend = THREE.MathUtils.lerp(channelActiveBlend, targetChannelActive, Math.min(1, dt * 6));
      if (activeChannelMat) {
        activeChannelMat.uniforms.uTime.value = elapsed;
        activeChannelMat.uniforms.uActive.value = channelActiveBlend;
      }

      // Gently drift sunlit dust motes across the diorama volume
      const dustAttr = dustGeo.getAttribute('position') as THREE.BufferAttribute;
      const dustArr = dustAttr.array as Float32Array;
      for (let i = 0; i < DUST_COUNT; i++) {
        const bx = dustSeeds[i * 3];
        const by = dustSeeds[i * 3 + 1];
        const ph = dustSeeds[i * 3 + 2];
        dustArr[i * 3] = bx + Math.sin(elapsed * 0.28 + ph) * 0.45;
        dustArr[i * 3 + 1] = by + Math.sin(elapsed * 0.42 + ph * 1.7) * 0.25;
      }
      dustAttr.needsUpdate = true;

      // Continuous Camera Choreography
      if (titleMode) {
        controls.enabled = false;
        const orbitAngle = elapsed * 0.12 + 0.25;
        _v2.set(-2.3, -0.3, 0.2);
        _v1.set(
          _v2.x + Math.sin(orbitAngle) * 24.5,
          14.8 + Math.sin(elapsed * 0.35) * 0.65,
          _v2.z + Math.cos(orbitAngle) * 24.5,
        );
        camera.position.lerp(_v1, 1 - Math.exp(-3.5 * dt));
        controls.target.lerp(_v2, 1 - Math.exp(-3.5 * dt));
        camera.lookAt(controls.target);
      } else {
        controls.enabled = !dragActive && !dragPending;
        const panSpeed = 9 * dt;
        let px = 0;
        let pz = 0;
        if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) pz -= panSpeed;
        if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) pz += panSpeed;
        if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) px -= panSpeed;
        if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) px += panSpeed;
        if (px !== 0 || pz !== 0) {
          autoFrameActive = false;
          if (propsRef.current.continuousCamera) {
            propsRef.current.onStopContinuousCamera?.();
          }
          camera.position.x += px;
          camera.position.z += pz;
          controls.target.x += px;
          controls.target.z += pz;
        } else if (autoFrameActive) {
          const k = 1 - Math.exp(-7.5 * dt);
          camera.position.lerp(autoCamPos, k);
          controls.target.lerp(autoCamTarget, k);
          if (
            camera.position.distanceTo(autoCamPos) < 0.03 &&
            controls.target.distanceTo(autoCamTarget) < 0.03
          ) {
            camera.position.copy(autoCamPos);
            controls.target.copy(autoCamTarget);
            autoFrameActive = false;
          }
        } else if (propsRef.current.continuousCamera && propsRef.current.isSimPlaying && !dragActive) {
          const dx = camera.position.x - controls.target.x;
          const dz = camera.position.z - controls.target.z;
          const stepAng = 0.18 * dt;
          const c = Math.cos(stepAng);
          const s = Math.sin(stepAng);
          camera.position.x = controls.target.x + dx * c - dz * s;
          camera.position.z = controls.target.z + dx * s + dz * c;
        }
        controls.update();
      }

      // Animate mini-islands, tethered shards, clouds, astrolabe rings, wind-vanes, pylons, mist & fireflies
      for (const child of animatedSceneryNodes) {
        const sAnim = child.userData.sceneryAnim;
        if (sAnim === 'miniIsland') {
          const baseY = (child.userData.baseY as number) ?? 0;
          const amp = (child.userData.amp as number) ?? 0.26;
          const ph = (child.userData.phase as number) ?? 0;
          child.position.y = baseY + Math.sin(elapsed * 0.8 + ph) * amp;
        } else if (sAnim === 'cloud') {
          const baseX = (child.userData.baseX as number) ?? 0;
          const speed = (child.userData.speed as number) ?? 0.3;
          const ph = (child.userData.phase as number) ?? 0;
          child.position.x = baseX + Math.sin(elapsed * speed * 0.45 + ph) * 3.2;
        } else if (sAnim === 'spinY') {
          const spinSpeed = (child.userData.spinSpeed as number) ?? 1.5;
          child.rotation.y += dt * spinSpeed;
        } else if (sAnim === 'spinZ') {
          const spinSpeed = (child.userData.spinSpeed as number) ?? 0.9;
          child.rotation.z += dt * spinSpeed;
        } else if (sAnim === 'bobSpin') {
          const baseY = (child.userData.baseY as number) ?? 0.88;
          const ph = (child.userData.phase as number) ?? 0;
          child.position.y = baseY + Math.sin(elapsed * 1.9 + ph) * 0.08;
          child.rotation.y += dt * 1.1;
        } else if (sAnim === 'mistPuff') {
          const baseY = (child.userData.baseY as number) ?? -3.9;
          const ph = (child.userData.phase as number) ?? 0;
          const cyc = (elapsed * 0.55 + ph * 0.25) % 1;
          child.position.y = baseY + cyc * 0.68;
          child.scale.setScalar(0.85 + Math.sin(cyc * Math.PI) * 0.45);
        } else if (sAnim === 'firefly') {
          const baseX = (child.userData.baseX as number) ?? 0;
          const baseY = (child.userData.baseY as number) ?? 0.8;
          const baseZ = (child.userData.baseZ as number) ?? 0;
          const ph = (child.userData.phase as number) ?? 0;
          child.position.x = baseX + Math.sin(elapsed * 0.9 + ph) * 0.28;
          child.position.y = baseY + Math.sin(elapsed * 1.5 + ph * 1.3) * 0.16;
          child.position.z = baseZ + Math.cos(elapsed * 0.8 + ph) * 0.28;
        } else if (sAnim === 'radarSweep') {
          const ph = (child.userData.phase as number) ?? 0;
          child.rotation.y = Math.sin(elapsed * 0.7 + ph) * 0.85;
        }
      }

      // Hover ring, Polymer Hover Highlight, Drag Preview, Ghost & Tactical 3D Field Overlay
      let hoveredPolyTokens: AxialCoord[] = [];
      let activeTacticalSpec: {
        coord: AxialCoord;
        mType: MachineType;
        dir: HexDir;
        altDir: HexDir;
        rotMode: RotatorMode;
      } | null = null;

      if (!titleMode && dragActive) {
        const dropCoord = dragActive.targetCoord;
        const dragged = dragActive.machine;
        const oldDir = dragged.config.dir;
        const deltaSteps = ((dragActive.currentDir - oldDir) % 6 + 6) % 6;
        const shiftedAltDir = rotateDir(
          dragged.config.altDir ?? rotateDir(oldDir, 1),
          deltaSteps,
        );
        const modeVal = dragged.config.rotMode ?? 'cw';

        if (dropCoord) {
          const dw = hexToWorld(dropCoord);
          const dKey = hexKey(dropCoord);
          const destMachine = wSnap.machines.get(dKey);
          const isValid =
            wSnap.platformHexes.has(dKey) &&
            !wSnap.narrowGapHexes.has(dKey) &&
            !wSnap.sinkFootprintHexes.has(dKey) &&
            !destMachine?.locked;

          hoverRingMat.color.setHex(isValid ? 0x26b557 : 0xff3b30);
          hoverRing.position.set(dw.x, 0.03, dw.z);
          hoverRing.visible = true;

          const nextGhostKey =
            dragged.type === 'conveyor'
              ? `drag:${dragged.id}:${dragged.type}:${dropCoord.q},${dropCoord.r}:${dragActive.currentDir}:${shiftedAltDir}:${modeVal}:${tId}:${wSnap.machines.size}`
              : `drag:${dragged.id}:${dragged.type}:${dragActive.currentDir}:${shiftedAltDir}:${modeVal}:${tId}`;
          if (ghostKey !== nextGhostKey) {
            clearGroup(ghostGroup);
            const dummyMachine: MachineInstance = {
              ...dragged,
              coord: dragged.type === 'conveyor' ? dropCoord : { q: 0, r: 0 },
              config: {
                ...dragged.config,
                dir: dragActive.currentDir,
                altDir: shiftedAltDir,
              },
            };
            const preview = buildMachineMesh(
              dummyMachine,
              PALETTES[tId],
              maxAniso,
              dragged.type === 'conveyor' ? wSnap.machines : undefined,
            );
            preview.traverse((obj) => {
              if ((obj as THREE.Mesh).isMesh && !obj.userData.isOutline) {
                const mat = (obj as THREE.Mesh).material as THREE.Material;
                if (mat) {
                  mat.transparent = true;
                  mat.opacity = 0.86;
                }
              }
            });
            ghostGroup.add(preview);
            ghostKey = nextGhostKey;
          }
          ghostGroup.position.set(dw.x, 0.24 + Math.sin(elapsed * 6) * 0.025, dw.z);
          ghostGroup.visible = isValid;

          if (isValid) {
            activeTacticalSpec = {
              coord: dropCoord,
              mType: dragged.type,
              dir: dragActive.currentDir,
              altDir: shiftedAltDir,
              rotMode: modeVal,
            };
          }
        } else {
          hoverRing.visible = false;
          ghostGroup.visible = false;
        }
      } else if (!titleMode && hoveredCoord && wSnap.platformHexes.has(hexKey(hoveredCoord))) {
        const hKey = hexKey(hoveredCoord);
        const isNarrowGap = wSnap.narrowGapHexes.has(hKey);
        const isSinkPad = wSnap.sinkFootprintHexes.has(hKey);
        const existing = wSnap.machines.get(hKey);
        const isBlockedTarget = isNarrowGap || isSinkPad || Boolean(existing?.locked);
        const hw = hexToWorld(hoveredCoord);
        const canPlaceTool =
          Boolean(tool && tool !== 'erase' && tool !== 'select') && !isBlockedTarget;
        hoverRingMat.color.setHex(
          isBlockedTarget && tool && tool !== 'erase' && tool !== 'select' ? 0xff3b30 : 0xffffff,
        );
        hoverRing.position.set(hw.x, 0.025, hw.z);
        hoverRing.visible = true;

        // Connected polymer highlight when hovering a bonded sphere
        const hoveredTok = Array.from(wSnap.tokens.values()).find((t) =>
          hexEqual(t.coord, hoveredCoord!),
        );
        if (hoveredTok) {
          const comps = getConnectedComponents(wSnap);
          const comp = comps.find((c) => c.tokenIds.includes(hoveredTok.id));
          if (comp && comp.tokenIds.length > 1) {
            hoveredPolyTokens = comp.tokenIds
              .map((id) => wSnap.tokens.get(id)?.coord)
              .filter((c): c is AxialCoord => Boolean(c));
          }
        }

        const sinkPadOwnerId = !existing && isSinkPad ? wSnap.sinkFootprintHexes.get(hKey) : undefined;
        const sinkPadOwner = sinkPadOwnerId
          ? Array.from(wSnap.machines.values()).find((m) => m.id === sinkPadOwnerId)
          : undefined;
        const tacticalMachine = existing ?? sinkPadOwner;
        if (tacticalMachine) {
          activeTacticalSpec = {
            coord: tacticalMachine.coord,
            mType: tacticalMachine.type,
            dir: tacticalMachine.config.dir,
            altDir: tacticalMachine.config.altDir ?? rotateDir(tacticalMachine.config.dir, 1),
            rotMode: tacticalMachine.config.rotMode ?? 'cw',
          };
        }

        if (canPlaceTool && tool && tool !== 'erase' && tool !== 'select') {
          const modeVal = rotMode ?? 'cw';
          const nextGhostKey =
            tool === 'conveyor'
              ? `${tool}:${hoveredCoord.q},${hoveredCoord.r}:${dir}:${modeVal}:${tId}:${wSnap.machines.size}`
              : `${tool}:${dir}:${modeVal}:${tId}`;
          if (ghostKey !== nextGhostKey) {
            clearGroup(ghostGroup);
            const dummyMachine: MachineInstance = {
              id: 'ghost',
              type: tool,
              coord: tool === 'conveyor' ? hoveredCoord : { q: 0, r: 0 },
              locked: false,
              config: { dir, rotMode: modeVal, filterRule: 'even', divisor: 2 },
              state: { spawnIndex: 0, cooldown: 0, memory: null, activeFlashTicks: 0, lastActionTick: -1 },
            };
            const preview = buildMachineMesh(
              dummyMachine,
              PALETTES[tId],
              maxAniso,
              tool === 'conveyor' ? wSnap.machines : undefined,
            );
            preview.traverse((obj) => {
              if ((obj as THREE.Mesh).isMesh && !obj.userData.isOutline) {
                const mat = (obj as THREE.Mesh).material as THREE.Material;
                if (mat) {
                  mat.transparent = true;
                  mat.opacity = 0.55;
                }
              }
            });
            ghostGroup.add(preview);
            ghostKey = nextGhostKey;
          }
          ghostGroup.position.set(hw.x, 0.02, hw.z);
          ghostGroup.visible = true;

          // When holding a placement tool, preview its outgoing ports/range over the hovered hex
          activeTacticalSpec = {
            coord: hoveredCoord,
            mType: tool,
            dir,
            altDir: rotateDir(dir, 1),
            rotMode: modeVal,
          };
        } else {
          ghostGroup.visible = false;
        }
      } else {
        hoverRing.visible = false;
        ghostGroup.visible = false;
      }

      if (activeTacticalSpec) {
        const nextTacKey = `${activeTacticalSpec.coord.q},${activeTacticalSpec.coord.r}:${activeTacticalSpec.mType}:${activeTacticalSpec.dir}:${activeTacticalSpec.altDir}:${activeTacticalSpec.rotMode}:${tId}`;
        if (tacticalKey !== nextTacKey) {
          rebuildTacticalOverlay(
            activeTacticalSpec.coord,
            activeTacticalSpec.mType,
            activeTacticalSpec.dir,
            activeTacticalSpec.altDir,
            activeTacticalSpec.rotMode,
            PALETTES[tId].ink,
          );
          tacticalKey = nextTacKey;
        }
        tacticalGroup.visible = true;
      } else {
        tacticalGroup.visible = false;
      }

      for (let i = 0; i < polymerRings.length; i++) {
        const ring = polymerRings[i];
        const pCoord = hoveredPolyTokens[i];
        if (pCoord) {
          const pw = hexToWorld(pCoord);
          ring.position.set(pw.x, 0.032, pw.z);
          const s = 1.02 + Math.sin(elapsed * 6) * 0.04;
          ring.scale.set(s, s, s);
          ring.visible = true;
        } else {
          ring.visible = false;
        }
      }

      // Onboarding coachmark ring
      if (coachCoord && !titleMode) {
        const cw = hexToWorld(coachCoord);
        coachRing.position.set(cw.x, 0.035, cw.z);
        const s = 1 + Math.sin(elapsed * 5) * 0.08;
        coachRing.scale.set(s, s, s);
        coachRing.visible = true;
      } else {
        coachRing.visible = false;
      }

      // Inspected machine ring
      if (selCoord && !titleMode && wSnap.machines.has(hexKey(selCoord))) {
        const sw = hexToWorld(selCoord);
        inspectedRing.position.set(sw.x, 0.038, sw.z);
        const s = 1.03 + Math.sin(elapsed * 4.5) * 0.04;
        inspectedRing.scale.set(s, s, s);
        inspectedRing.visible = true;
      } else {
        inspectedRing.visible = false;
      }

      // Error highlights
      for (let i = 0; i < errorRings.length; i++) {
        const errRing = errorRings[i];
        const errCoord = wSnap.errorHighlightHexes[i];
        if (errCoord) {
          const ew = hexToWorld(errCoord);
          errRing.position.set(ew.x, 0.045, ew.z);
          const s = 1 + Math.sin(elapsed * 9) * 0.1;
          errRing.scale.set(s, s, s);
          errRing.visible = true;
        } else {
          errRing.visible = false;
        }
      }

      // Update pooled Hex Shockwave Pulse Rings
      for (const pr of pulseRings) {
        if (!pr.active) continue;
        pr.life += fxDt;
        if (pr.life < 0) continue;
        pr.mesh.visible = true;
        if (pr.life >= pr.maxLife) {
          pr.active = false;
          pr.mesh.visible = false;
          continue;
        }
        const t = pr.life / pr.maxLife;
        const easeOut = 1 - Math.pow(1 - t, 3);
        const sc = 0.55 + (pr.maxScale - 0.55) * easeOut;
        pr.mesh.scale.setScalar(sc);
        pr.mat.opacity = 0.92 * (1 - t);
      }

      // Update pooled Floating Operation Badge Sprites
      for (const pop of opPopups) {
        if (!pop.active) continue;
        pop.life += fxDt;
        if (pop.life >= pop.maxLife) {
          pop.active = false;
          pop.sprite.visible = false;
          continue;
        }
        const t = pop.life / pop.maxLife;
        const rise = 1 - Math.pow(1 - t, 2.5);
        pop.sprite.position.y = pop.startY + rise * 0.72;
        const popScale = t < 0.18 ? 0.75 + (t / 0.18) * 0.35 : 1.1 - Math.min(0.12, (t - 0.18) * 0.15);
        pop.sprite.scale.set(1.22 * popScale, 0.5 * popScale, 1);
        pop.mat.opacity = t < 0.62 ? 1 : Math.max(0, 1 - (t - 0.62) / 0.38);
      }

      // Update pooled steam & spark particles
      for (const p of steamPuffs) {
        if (!p.active) continue;
        p.life += fxDt;
        if (p.life >= p.maxLife) {
          p.active = false;
          p.mesh.visible = false;
          continue;
        }
        const t = p.life / p.maxLife;
        p.mesh.position.x += p.vx * fxDt;
        p.mesh.position.y += p.vy * fxDt;
        p.mesh.position.z += p.vz * fxDt;
        const sc = t < 0.35 ? 0.5 + t * 2.2 : Math.max(0.01, 1.27 - (t - 0.35) * 1.9);
        p.mesh.scale.setScalar(sc);
      }

      for (const s of sparkPuffs) {
        if (!s.active) continue;
        s.life += fxDt;
        if (s.life >= s.maxLife) {
          s.active = false;
          s.mesh.visible = false;
          continue;
        }
        const t = s.life / s.maxLife;
        s.vy -= 5.8 * fxDt;
        s.mesh.position.x += s.vx * fxDt;
        s.mesh.position.y = Math.max(0.08, s.mesh.position.y + s.vy * fxDt);
        s.mesh.position.z += s.vz * fxDt;
        s.mesh.rotation.y += fxDt * 10;
        s.mesh.scale.setScalar(Math.max(0.01, 1 - t));
      }

      // Update tumbling falling-off-cliff tokens
      for (let i = fallingVisuals.length - 1; i >= 0; i--) {
        const fv = fallingVisuals[i];
        fv.life += fxDt;
        if (fv.life >= fv.maxLife) {
          fxGroup.remove(fv.group);
          disposeObjectTree(fv.group);
          fallingVisuals.splice(i, 1);
          continue;
        }
        fv.vy -= 12.5 * fxDt;
        fv.group.position.x += fv.vx * fxDt;
        fv.group.position.y += fv.vy * fxDt;
        fv.group.position.z += fv.vz * fxDt;
        fv.group.rotation.x += fv.rx * fxDt;
        fv.group.rotation.z += fv.rz * fxDt;
        const fadeScale = Math.max(0.05, 1 - fv.life / fv.maxLife);
        fv.group.scale.setScalar(fadeScale);
      }

      updateTokensAndBonds(elapsed, dt);

      // Apply decaying trauma micro-shake ONLY for render and restore immediately so OrbitControls never drifts
      let hasShake = false;
      if (!prefersReducedMotion && cameraTrauma > 0.001) {
        const mag = cameraTrauma * cameraTrauma * 0.24;
        _shakeOffset.set(
          Math.sin(elapsed * 57) * mag,
          Math.cos(elapsed * 63) * mag * 0.65,
          Math.sin(elapsed * 49 + 1.4) * mag,
        );
        camera.position.add(_shakeOffset);
        hasShake = true;
      }
      cameraTrauma = Math.max(0, cameraTrauma - fxDt * 2.0);

      renderer.render(scene, camera);

      if (hasShake) {
        camera.position.sub(_shakeOffset);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      input.dispose();
      resizeObs.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      clearFallingTokens();
      tokenVisuals.clear();
      consumedVisuals.clear();
      pendingVfxEvents.length = 0;
      clearGroup(gridGroup);
      clearGroup(cliffGroup);
      clearGroup(sceneryGroup);
      clearGroup(channelGroup);
      clearGroup(machineGroup);
      clearGroup(tokenGroup);
      clearGroup(bondGroup);
      clearGroup(ghostGroup);
      clearGroup(tacticalGroup);
      for (const tex of opTextureCache.values()) {
        tex.dispose();
      }
      opTextureCache.clear();
      for (const pop of opPopups) {
        pop.mat.map = null;
        pop.mat.dispose();
      }
      disposeObjectTree(fxGroup);
      disposeObjectTree(skyDome);
      dustGeo.dispose();
      dustMat.dispose();
      hoverRingGeo.dispose();
      pulseRingGeo.dispose();
      puffGeo.dispose();
      sparkGeo.dispose();
      hoverRingMat.dispose();
      coachRingMat.dispose();
      inspectedRingMat.dispose();
      polymerRingMat.dispose();
      errorRingMat.dispose();
      puffMat.dispose();
      sparkMat.dispose();

      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [tickProgressRef]);

  return (
    <div
      ref={mountRef}
      data-testid="hex-canvas-container"
      className="fixed inset-0 w-full h-full overflow-hidden"
    />
  );
}
