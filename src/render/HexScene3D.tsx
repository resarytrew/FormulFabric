import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getConnectedComponents } from '../engine/hex-engine';
import {
  dirToWorldYaw,
  HEX_SIZE,
  hexDistance,
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

export interface HexSceneProps {
  world: SimulationWorld;
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

function disposeObjectTree(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const anyChild = child as THREE.Mesh & THREE.LineSegments;
    if (anyChild.geometry && !anyChild.geometry.userData?.isShared) {
      anyChild.geometry.dispose();
    }
    const mat = anyChild.material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const mAny = m as THREE.MeshBasicMaterial & THREE.MeshToonMaterial;
        if (mAny.map) {
          mAny.map.dispose();
        }
        m.dispose();
      }
    }
  });
}

export function HexScene3D({
  world,
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
  } | null>(null);

  // Sync grid when platform hex set changes
  const platformSig = Array.from(world.platformHexes).sort().join(';');
  useEffect(() => {
    sceneApiRef.current?.rebuildGrid();
    if (!propsRef.current.isTitleMode) {
      sceneApiRef.current?.resetCamera();
    }
  }, [platformSig]);

  // Auto-frame camera smoothly when leaving Title mode into active gameplay
  const prevTitleModeRef = useRef(isTitleMode);
  useEffect(() => {
    if (prevTitleModeRef.current && !isTitleMode) {
      sceneApiRef.current?.resetCamera();
    }
    prevTitleModeRef.current = isTitleMode;
  }, [isTitleMode]);

  // Sync theme palette
  useEffect(() => {
    sceneApiRef.current?.syncTheme();
    sceneApiRef.current?.rebuildGrid();
    sceneApiRef.current?.syncMachines();
  }, [theme]);

  // Sync machines whenever machine map, config, or memory changes
  const machineSig = Array.from(world.machines.values())
    .map(
      (m) =>
        `${m.id}:${m.type}:${m.coord.q},${m.coord.r}:${m.config.dir}:${m.config.altDir ?? ''}:${m.config.rotMode ?? ''}:${m.config.filterRule ?? ''}:${m.config.divisor ?? ''}:${m.config.spawnInterval ?? ''}:${m.config.loopSequence ? 1 : 0}:${m.config.sequence?.join(',') ?? ''}:${m.state.memory ?? ''}`,
    )
    .join('|');
  useEffect(() => {
    sceneApiRef.current?.syncMachines();
  }, [machineSig]);

  // Reactive 3D VFX bursts, pulse rings, floating operation badges, & camera micro-shake
  const lastEventIdxRef = useRef(0);
  useEffect(() => {
    if (world.events.length < lastEventIdxRef.current) {
      lastEventIdxRef.current = 0;
    }
    const newEvents = world.events.slice(lastEventIdxRef.current);
    lastEventIdxRef.current = world.events.length;
    for (const ev of newEvents) {
      const w = hexToWorld(ev.coord);
      if (ev.type === 'deliver' || ev.type === 'weld' || ev.type === 'spawn' || ev.type === 'cut') {
        const burstCount = ev.type === 'deliver' ? 8 : ev.type === 'cut' ? 4 : 3;
        sceneApiRef.current?.spawnSteamBurst(w.x, w.z, burstCount);
      }
      if (ev.type === 'weld' || ev.type === 'cut' || ev.type === 'transform' || ev.type === 'destroy') {
        sceneApiRef.current?.spawnSparkBurst(w.x, w.z, ev.type === 'transform' ? 4 : 8);
      }
      if (ev.type === 'deliver') {
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0x26b557, 1.9);
        sceneApiRef.current?.addTrauma(0.16);
      } else if (ev.type === 'weld') {
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0xfbbf24, 1.65);
        sceneApiRef.current?.addTrauma(0.14);
      } else if (ev.type === 'cut') {
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0x38bdf8, 1.65);
        sceneApiRef.current?.addTrauma(0.14);
      } else if (ev.type === 'destroy') {
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0xf97316, 1.75);
        sceneApiRef.current?.addTrauma(0.14);
      } else if (ev.type === 'transform' || ev.type === 'store') {
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0xfde047, 1.45);
      } else if (ev.type === 'collision' || ev.type === 'error') {
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0xff3b30, 1.95, 0);
        sceneApiRef.current?.spawnPulseRing(w.x, w.z, 0xff3b30, 2.25, 0.11);
        sceneApiRef.current?.addTrauma(0.55);
      }
      if (ev.badge && !propsRef.current.isTitleMode) {
        sceneApiRef.current?.spawnOpPopup(w.x, w.z, ev.badge, ev.severity);
      }
    }
  }, [world.events.length]);

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
    if (cameraResetTrigger > 0) {
      sceneApiRef.current?.resetCamera();
    }
  }, [cameraResetTrigger]);

  useEffect(() => {
    if (focusCoordTrigger) {
      sceneApiRef.current?.focusCoord(focusCoordTrigger.coord);
    }
  }, [focusCoordTrigger]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
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
    const defaultCamPos = new THREE.Vector3(0, 14.5, 12.5);
    const defaultTarget = new THREE.Vector3(0, 0, 0.3);
    camera.position.copy(defaultCamPos);
    camera.lookAt(defaultTarget);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.target.copy(defaultTarget);
    controls.minDistance = 7;
    controls.maxDistance = 28;
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
    keyLight.shadow.camera.left = -13;
    keyLight.shadow.camera.right = 13;
    keyLight.shadow.camera.top = 13;
    keyLight.shadow.camera.bottom = -13;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 48;
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
      pop.maxLife = 0.62;
      pop.startY = 0.74;
      pop.mat.map = getOpBadgeTexture(label, severity);
      pop.mat.opacity = 1;
      pop.mat.needsUpdate = true;
      pop.sprite.position.set(x, pop.startY, z);
      pop.sprite.scale.set(1.22, 0.5, 1);
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
    const prevMachineIds = new Map<HexKey, string>();
    const machineDropAge = new Map<HexKey, number>();
    const tokenVisuals = new Map<
      string,
      { group: THREE.Group; value: number; theme: PaletteThemeId; popAge: number }
    >();
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
      clearGroup(sceneryGroup);
      interactableHexes = [];

      const pal = PALETTES[propsRef.current.theme];
      const worldSnap = propsRef.current.world;
      const tileGeo = getSharedHexTileGeometry();
      const hitGeo = getSharedHexHitGeometry();

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

      let maxR = 2;
      const playableCoords: AxialCoord[] = [];
      for (const k of worldSnap.platformHexes) {
        const c = parseHexKey(k);
        playableCoords.push(c);
        maxR = Math.max(maxR, hexDistance(c, { q: 0, r: 0 }));
      }

      // Per-hex instanced recessed dark seam sub-plinths (clean grout lines without outer plate overhang)
      const count = playableCoords.length;
      const seamGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.992, HEX_SIZE * 0.96, 0.34, 6);
      const seamMat = createCelMaterial(pal.ink, { roughness: 0.95, metalness: 0 });
      const seamInst = new THREE.InstancedMesh(seamGeo, seamMat, count);

      // Instanced beveled playable hex tiles with subtle per-tile tonal variation
      const tileInst = new THREE.InstancedMesh(tileGeo, [topMat, sideMat], count);
      tileInst.receiveShadow = !isSoftwareGl;
      tileInst.castShadow = !isSoftwareGl;
      const baseTopColor = new THREE.Color(pal.hexTop);

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
      const gridRingInst = new THREE.InstancedMesh(gridRingGeo, gridRingMat, count);

      const fullDiskCount = 1 + 3 * maxR * (maxR + 1);
      const hasChasm = count < fullDiskCount;

      playableCoords.forEach((c, idx) => {
        const w = hexToWorld(c);
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
        tileInst.setColorAt(idx, _tileColor);

        // Invisible hit mesh for raycasting
        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.position.set(w.x, -0.1, w.z);
        hit.userData.coord = c;
        gridGroup.add(hit);
        interactableHexes.push(hit);
      });
      if (tileInst.instanceColor) tileInst.instanceColor.needsUpdate = true;
      tileInst.computeBoundingSphere();
      gridRingInst.computeBoundingSphere();
      seamInst.computeBoundingSphere();
      gridGroup.add(seamInst, tileInst, gridRingInst);

      // Terraced outer rocky cliff hexes (clean Tunic matte stone without polka dots or wireframe lines)
      const cliffTopMat = createCelMaterial(0xffffff, { roughness: 0.84, metalness: 0.03 });
      const cliffSideMat = createCelMaterial(pal.cliffSide, { roughness: 0.88, metalness: 0.04 });
      const cliffCoords: Array<{ c: AxialCoord; y: number }> = [];
      const outerR = maxR + 1;
      for (let q = -outerR; q <= outerR; q++) {
        const r1 = Math.max(-outerR, -q - outerR);
        const r2 = Math.min(outerR, -q + outerR);
        for (let r = r1; r <= r2; r++) {
          const c = { q, r };
          const k = hexKey(c);
          if (worldSnap.platformHexes.has(k)) continue;
          const dist = hexDistance(c, { q: 0, r: 0 });
          if (dist <= maxR || dist > outerR) continue;
          const hash = Math.abs((q * 73856093) ^ (r * 19349663)) % 10;
          if (hash < 2) continue;
          const elev = hash >= 8 ? 0.3 : -0.34 - (hash % 3) * 0.14;
          cliffCoords.push({ c, y: elev });
        }
      }

      if (cliffCoords.length > 0) {
        const cliffInst = new THREE.InstancedMesh(
          tileGeo,
          [cliffTopMat, cliffSideMat],
          cliffCoords.length,
        );
        cliffInst.receiveShadow = !isSoftwareGl;
        cliffInst.castShadow = !isSoftwareGl;
        const baseCliffTop = new THREE.Color(pal.cliffTop);

        cliffCoords.forEach(({ c, y }, idx) => {
          const w = hexToWorld(c);
          _dummy.position.set(w.x, y, w.z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 2.6, 1);
          _dummy.updateMatrix();
          cliffInst.setMatrixAt(idx, _dummy.matrix);

          const hash = Math.abs((c.q * 19349663) ^ (c.r * 83492791)) % 100;
          const shade = 0.92 + (hash / 100) * 0.12;
          _tileColor.copy(baseCliffTop).multiplyScalar(shade);
          cliffInst.setColorAt(idx, _tileColor);
        });
        if (cliffInst.instanceColor) cliffInst.instanceColor.needsUpdate = true;
        cliffInst.computeBoundingSphere();
        cliffGroup.add(cliffInst);

        // Place up to 4 sculpted miniature bonsai trees + 3 architectural beacon posts on raised outer cliff hexes
        const treeSpots = cliffCoords
          .slice()
          .sort((a, b) => b.y - a.y)
          .slice(0, Math.min(10, cliffCoords.length));
        const usedSpots = new Set<number>();
        const step = Math.max(1, Math.floor(treeSpots.length / 4));
        for (let t = 0; t < 4 && t * step < treeSpots.length; t++) {
          const idxSpot = t * step;
          usedSpots.add(idxSpot);
          const spot = treeSpots[idxSpot];
          const tw = hexToWorld(spot.c);
          const bonsai = buildBonsaiTreeGroup(pal, t);
          bonsai.position.set(tw.x, spot.y, tw.z);
          sceneryGroup.add(bonsai);
        }
        let beaconsPlaced = 0;
        for (let b = 0; b < treeSpots.length && beaconsPlaced < 3; b++) {
          if (usedSpots.has(b)) continue;
          const spot = treeSpots[b];
          const bw = hexToWorld(spot.c);
          const post = buildPlatformBeaconPost(pal);
          post.position.set(bw.x, spot.y, bw.z);
          sceneryGroup.add(post);
          beaconsPlaced++;
        }
      }

      // Rich stylized 3D canyon valley vista below & around the floating citadel
      const valley = buildScenicValleyEnvironment(pal);
      activeWaterMat = valley.waterMaterial;
      sceneryGroup.add(valley.group);

      // Multi-tiered rocky underbelly + hanging cables beneath the floating hex platform
      const underbelly = buildIslandUnderbellyAndCables(maxR, pal, hasChasm);
      sceneryGroup.add(underbelly);

      // Distant Monument Valley floating terrace mini-islands framed cleanly in sky
      const safeOuterWorldR = (maxR + 1.8) * HEX_SIZE * 1.75;
      const miniAngles = [-Math.PI * 0.78, -Math.PI * 0.21, Math.PI * 0.18];
      for (let m = 0; m < miniAngles.length; m++) {
        const ang = miniAngles[m];
        const dist = safeOuterWorldR + 3.4 + (m % 2) * 1.8;
        const mini = buildFloatingMiniIsland(pal, m);
        mini.position.set(Math.cos(ang) * dist, 0.55 - m * 0.45, Math.sin(ang) * dist);
        mini.scale.setScalar(m === 2 ? 0.78 : 0.95);
        mini.userData.sceneryAnim = 'miniIsland';
        mini.userData.baseY = mini.position.y;
        mini.userData.phase = m * 2.1;
        sceneryGroup.add(mini);
      }

      // 4 soft distant twilight clouds framed along the upper horizon without blocking valley landmarks
      const cloudAngles = [-2.35, -1.75, -1.15, -0.58];
      for (let cl = 0; cl < cloudAngles.length; cl++) {
        const cloud = buildStylizedCloudGroup(pal, cl);
        const ang = cloudAngles[cl];
        const rad = safeOuterWorldR + 6.4 + (cl % 2) * 2.2;
        const cx = Math.cos(ang) * rad;
        const cz = Math.sin(ang) * rad;
        const cy = -1.6 + (cl % 2) * 1.1;
        cloud.position.set(cx, cy, cz);
        cloud.scale.setScalar(0.88 + (cl % 2) * 0.22);
        cloud.userData.sceneryAnim = 'cloud';
        cloud.userData.baseX = cx;
        cloud.userData.speed = 0.14 + (cl % 2) * 0.06;
        cloud.userData.phase = cl * 1.4;
        sceneryGroup.add(cloud);
      }
    }

    function syncMachines() {
      clearGroup(machineGroup);
      clearGroup(channelGroup);
      activeChannelMat = null;
      machineMeshes.clear();
      const pal = PALETTES[propsRef.current.theme];
      const nextIds = new Map<HexKey, string>();
      for (const [k, machine] of propsRef.current.world.machines.entries()) {
        const sig = `${machine.id}:${machine.type}`;
        nextIds.set(k, sig);
        if (prevMachineIds.size > 0 && prevMachineIds.get(k) !== sig) {
          machineDropAge.set(k, 0);
        }
        const mesh = buildMachineMesh(machine, pal, maxAniso);
        const w = hexToWorld(machine.coord);
        mesh.position.set(w.x, 0, w.z);
        machineGroup.add(mesh);
        machineMeshes.set(k, mesh);
      }
      // Seamless conveyor track junction couplers
      const connectors = buildConveyorConnectorGroup(propsRef.current.world.machines, pal);
      machineGroup.add(connectors);

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
      const shaftLen = HEX_SIZE * 0.85 * lenScale;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(shaftLen, 0.04, 0.12), mat);
      shaft.position.set(HEX_SIZE * 0.48 + shaftLen * 0.5, 0, 0);
      addInkOutline(shaft, inkColor, 0.02);

      const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 4), mat);
      head.rotation.z = -Math.PI / 2;
      head.rotation.x = Math.PI / 4;
      head.position.set(HEX_SIZE * 0.48 + shaftLen + 0.1, 0, 0);
      addInkOutline(head, inkColor, 0.02);

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
      } else if (mType === 'filter' || mType === 'divmod' || mType === 'dup' || mType === 'splitter') {
        addTacticalArrow(coord, dir, 0x26b557, inkColor, 0.9);
        addTacticalHexRing(hexNeighbor(coord, dir), 0x86efac, 0.055);
        const secColor = mType === 'dup' || mType === 'splitter' ? 0x38bdf8 : 0xf59e0b;
        addTacticalArrow(coord, altDir, secColor, inkColor, 0.82, 0.09);
        addTacticalHexRing(hexNeighbor(coord, altDir), secColor, 0.058);
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
      } else if (mType === 'sink') {
        addTacticalHexRing(coord, 0x26b557, 0.065);
      }
    }

    // Raycaster & Drag-and-Drop Pointer State
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
      const hits = raycaster.intersectObjects(interactableHexes, false);
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
          const validDrop =
            wSnap.platformHexes.has(dKey) &&
            !destMachine?.locked &&
            (!hexEqual(dropCoord, active.fromCoord) ||
              active.currentDir !== active.machine.config.dir);
          if (validDrop) {
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
        ghostKey = '';
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

    // ResizeObserver for clean responsive sizing
    const resizeObs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
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
      const halfX = (maxX - minX) * 0.5 + HEX_SIZE * 1.45;
      const halfZ = (maxZ - minZ) * 0.5 + HEX_SIZE * 1.45;

      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      const tanHalfV = Math.tan(vFovRad * 0.5);
      const aspect = Math.max(0.55, camera.aspect || 1.6);
      const distV = (halfZ * 1.54) / tanHalfV;
      const distH = (halfX * 1.66) / (tanHalfV * aspect);
      const dist = THREE.MathUtils.clamp(Math.max(distV, distH, 13.8), 13.8, 30.0);
      const hudOffsetX = halfX > 5.0 ? 1.85 : 0.75;

      autoCamTarget.set(cx + hudOffsetX, -0.05, cz + 0.35);
      autoCamPos.set(cx + hudOffsetX, dist * 0.69, cz + 0.35 + dist * 0.75);
      autoFrameActive = true;
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

    function updateTokensAndBonds(elapsed: number, dt: number) {
      const { world: wSnap, theme: tId } = propsRef.current;
      const pal = PALETTES[tId];
      const alpha = THREE.MathUtils.clamp(tickProgressRef.current, 0, 1);
      // Smooth cubic ease for tactile mechanical glide
      const ease = alpha < 0.5 ? 4 * alpha * alpha * alpha : 1 - Math.pow(-2 * alpha + 2, 3) / 2;

      // Remove stale token visuals & dispose GPU resources
      for (const [id, vis] of tokenVisuals.entries()) {
        if (!wSnap.tokens.has(id)) {
          tokenGroup.remove(vis.group);
          disposeObjectTree(vis.group);
          tokenVisuals.delete(id);
        }
      }

      // Position tokens with per-moveSource physical motion curves & elastic squash-stretch
      const tokenRenderPositions = new Map<string, { x: number; y: number; z: number }>();
      for (const tok of wSnap.tokens.values()) {
        let vis = tokenVisuals.get(tok.id);
        if (!vis || vis.value !== tok.value || vis.theme !== tId) {
          const isTransform = Boolean(vis && vis.value !== tok.value);
          if (vis) {
            tokenGroup.remove(vis.group);
            disposeObjectTree(vis.group);
          }
          const group = buildTokenMesh(tok.value, pal, tId, maxAniso);
          tokenGroup.add(group);
          vis = { group, value: tok.value, theme: tId, popAge: isTransform ? 0 : 0.35 };
          tokenVisuals.set(tok.id, vis);
        }
        vis.popAge = Math.min(1, vis.popAge + dt * 3.8);

        let wx = 0;
        let wz = 0;
        let hop = 0;
        let pitchX = 0;
        let pitchZ = 0;
        let stretchXZ = 1;
        let stretchY = 1;

        const isMoving =
          Boolean(tok.rotatedFrom) ||
          tok.prevCoord.q !== tok.coord.q ||
          tok.prevCoord.r !== tok.coord.r;

        if (tok.rotatedFrom && alpha < 1) {
          const rotEase =
            alpha < 0.5 ? 4 * alpha * alpha * alpha : 1 - Math.pow(-2 * alpha + 2, 3) / 2;
          const pW = hexToWorld(tok.rotatedFrom.pivot);
          const sW = hexToWorld(tok.prevCoord);
          const dx = sW.x - pW.x;
          const dz = sW.z - pW.z;
          const rotAngle = -tok.rotatedFrom.angleDelta * rotEase;
          const cos = Math.cos(rotAngle);
          const sin = Math.sin(rotAngle);
          wx = pW.x + (dx * cos - dz * sin);
          wz = pW.z + (dx * sin + dz * cos);
          hop = Math.sin(alpha * Math.PI) * 0.16;
          pitchZ = Math.sin(alpha * Math.PI) * 0.08 * Math.sign(tok.rotatedFrom.angleDelta);
        } else {
          const sW = hexToWorld(tok.prevCoord);
          const eW = hexToWorld(tok.coord);
          if (isMoving && alpha < 1) {
            const src = tok.moveSource ?? 'conveyor';
            let tCurve = alpha;
            if (src === 'pusher') {
              const p = Math.min(1, alpha / 0.38);
              const ballistic = 1 - Math.pow(1 - p, 3);
              const recoil =
                alpha > 0.38
                  ? Math.sin((alpha - 0.38) * Math.PI * 2.2) *
                    Math.exp(-(alpha - 0.38) * 5.2) *
                    0.03
                  : 0;
              tCurve = ballistic + recoil;
              hop = Math.sin(Math.min(1, alpha / 0.55) * Math.PI) * 0.085;
              const sq =
                alpha < 0.38
                  ? Math.sin((alpha / 0.38) * Math.PI) * 0.14
                  : -Math.sin(Math.min(1, (alpha - 0.38) / 0.35) * Math.PI) * 0.08;
              stretchXZ = 1 + sq * 0.65;
              stretchY = 1 - sq;
            } else if (src === 'magnet') {
              tCurve =
                alpha < 0.45
                  ? 0.22 * Math.pow(alpha / 0.45, 2)
                  : 0.22 + 0.78 * (1 - Math.pow(1 - (alpha - 0.45) / 0.55, 2.4));
              hop = Math.sin(alpha * Math.PI) * 0.19;
            } else if (src === 'spawner') {
              tCurve = 1 - Math.pow(1 - alpha, 2.2);
              hop = Math.abs(Math.sin(alpha * Math.PI * 1.6)) * (1 - alpha) * 0.17;
            } else if (src === 'split') {
              tCurve = 1 - Math.pow(1 - alpha, 2.4);
              hop = Math.sin(alpha * Math.PI) * 0.15;
            } else {
              // Conveyor steady traction glide
              tCurve =
                alpha < 0.5
                  ? 2 * alpha * alpha
                  : 1 - Math.pow(-2 * alpha + 2, 2) / 2;
              hop = Math.sin(alpha * Math.PI) * 0.022;
            }
            wx = THREE.MathUtils.lerp(sW.x, eW.x, tCurve);
            wz = THREE.MathUtils.lerp(sW.z, eW.z, tCurve);

            const dx = eW.x - sW.x;
            const dz = eW.z - sW.z;
            const dist = Math.hypot(dx, dz) || 1;
            const tiltMag = src === 'pusher' ? 0.14 : 0.08;
            const tiltEnv = Math.sin(alpha * Math.PI) * tiltMag;
            pitchX = (dz / dist) * tiltEnv;
            pitchZ = -(dx / dist) * tiltEnv;
          } else {
            wx = eW.x;
            wz = eW.z;
          }
        }

        if (vis.popAge < 1) {
          const popWave = Math.sin(vis.popAge * Math.PI * 1.5) * (1 - vis.popAge) * 0.2;
          stretchXZ *= 1 + popWave;
          stretchY *= 1 / Math.sqrt(Math.max(0.65, 1 + popWave));
        }

        const bob = Math.sin(elapsed * 2.5 + tok.spawnOrder) * 0.014;
        const wy = bob + hop;
        vis.group.position.set(wx, wy, wz);
        vis.group.rotation.set(pitchX, 0, pitchZ);
        vis.group.scale.set(stretchXZ, stretchY, stretchXZ);
        tokenRenderPositions.set(tok.id, { x: wx, y: wy, z: wz });
      }

      // Update rigid polymer bond rods
      while (bondMeshes.length < wSnap.bonds.length) {
        const rod = buildBondRodMesh(pal);
        bondGroup.add(rod);
        bondMeshes.push(rod);
      }
      for (let i = 0; i < bondMeshes.length; i++) {
        const rod = bondMeshes[i];
        if (i >= wSnap.bonds.length) {
          rod.visible = false;
          continue;
        }
        const edge = wSnap.bonds[i];
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

      // Animate all 3D industrial mechanism sub-parts smoothly with accumulated phase velocity
      for (const [k, mGroup] of machineMeshes.entries()) {
        // Hide original machine while it is lifted & dragged across the board
        const isBeingDragged = Boolean(dragActive && hexKey(dragActive.fromCoord) === k);
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
        const flashArc = isFlashing ? Math.sin(alpha * Math.PI) : 0;
        // Snappy industrial power stroke (fast extend 0..0.35, hydraulic cushion return 0.35..1.0)
        const stroke = isFlashing
          ? alpha < 0.32
            ? Math.sin((alpha / 0.32) * (Math.PI / 2))
            : Math.cos(((alpha - 0.32) / 0.68) * (Math.PI / 2))
          : 0;

        mGroup.traverse((child) => {
          const anim = child.userData.animType;
          if (!anim) return;

          if (anim === 'conveyorRoller') {
            const ph = ((child.userData.phase as number) ?? 0) + dt * (5.2 + flashArc * 5.0);
            child.userData.phase = ph;
            child.rotation.z = -ph;
          } else if (anim === 'conveyorGear') {
            const sign = (child.userData.gearSign as number) ?? -1;
            const ph = ((child.userData.phase as number) ?? 0) + dt * (4.0 + flashArc * 4.0);
            child.userData.phase = ph;
            child.rotation.z = sign * ph;
          } else if (anim === 'conveyorTread') {
            const idx = (child.userData.treadIdx as number) ?? 0;
            const count = (child.userData.treadCount as number) ?? 6;
            const beltPhase = ((child.userData.beltPhase as number) ?? 0) + dt * (0.95 + flashArc * 0.65);
            child.userData.beltPhase = beltPhase;
            const phase = ((beltPhase + idx / count) % 1 + 1) % 1;
            // Wraps around front & rear stadium belt drums at +/- 0.57
            child.position.x = -0.57 + phase * 1.14;
            if (phase < 0.13) {
              const t = phase / 0.13;
              child.position.y = 0.078 + t * 0.074;
              child.rotation.z = (1 - t) * 0.92;
              child.scale.set(0.35 + t * 0.65, 1, 0.72 + t * 0.28);
            } else if (phase > 0.87) {
              const t = (1 - phase) / 0.13;
              child.position.y = 0.078 + t * 0.074;
              child.rotation.z = -(1 - t) * 0.92;
              child.scale.set(0.35 + t * 0.65, 1, 0.72 + t * 0.28);
            } else {
              child.position.y = 0.152;
              child.rotation.z = 0;
              child.scale.set(1, 1, 1);
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
            if (isFlashing && alpha < 1) {
              const dirSign = child.userData.cw ? -1 : 1;
              child.rotation.y = dirSign * (Math.PI / 3) * (1 - ease);
              child.position.y = Math.sin(alpha * Math.PI) * 0.08;
            } else {
              child.rotation.y = 0;
              child.position.y = 0;
            }
          } else if (anim === 'rotatorBoom') {
            child.position.x = isFlashing ? Math.sin(alpha * Math.PI) * 0.05 : 0;
          } else if (anim === 'rotatorClaw') {
            const side = (child.userData.side as number) ?? 1;
            const grip = isFlashing ? -0.15 : Math.sin(elapsed * 2.4) * 0.05;
            child.rotation.y = side * (-0.32 + grip);
          } else if (anim === 'pusher') {
            child.position.x = stroke * 0.56;
          } else if (anim === 'pusherCoil') {
            child.scale.x = 1 + stroke * 1.5;
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
            const ph = ((child.userData.phase as number) ?? 0) + dt * (2.6 + flashArc * 5.2) * ratio;
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

    function tick() {
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
        const orbitAngle = elapsed * 0.12 + 0.35;
        _v2.set(-2.3, 0, 0.2);
        _v1.set(
          _v2.x + Math.sin(orbitAngle) * 13.5,
          12.0 + Math.sin(elapsed * 0.35) * 0.6,
          _v2.z + Math.cos(orbitAngle) * 13.5,
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

      // Gently animate distant floating mini-islands & drifting sky clouds
      for (const child of sceneryGroup.children) {
        const sAnim = child.userData.sceneryAnim;
        if (sAnim === 'miniIsland') {
          const baseY = (child.userData.baseY as number) ?? 0;
          const ph = (child.userData.phase as number) ?? 0;
          child.position.y = baseY + Math.sin(elapsed * 0.8 + ph) * 0.26;
        } else if (sAnim === 'cloud') {
          const baseX = (child.userData.baseX as number) ?? 0;
          const speed = (child.userData.speed as number) ?? 0.3;
          const ph = (child.userData.phase as number) ?? 0;
          child.position.x = baseX + Math.sin(elapsed * speed * 0.45 + ph) * 3.2;
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
          const isValid = wSnap.platformHexes.has(dKey) && !destMachine?.locked;

          hoverRingMat.color.setHex(isValid ? 0x26b557 : 0xff3b30);
          hoverRing.position.set(dw.x, 0.03, dw.z);
          hoverRing.visible = true;

          const nextGhostKey = `drag:${dragged.id}:${dragged.type}:${dragActive.currentDir}:${shiftedAltDir}:${modeVal}:${tId}`;
          if (ghostKey !== nextGhostKey) {
            clearGroup(ghostGroup);
            const dummyMachine: MachineInstance = {
              ...dragged,
              coord: { q: 0, r: 0 },
              config: {
                ...dragged.config,
                dir: dragActive.currentDir,
                altDir: shiftedAltDir,
              },
            };
            const preview = buildMachineMesh(dummyMachine, PALETTES[tId], maxAniso);
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
          ghostGroup.visible = true;

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
        const hw = hexToWorld(hoveredCoord);
        hoverRingMat.color.setHex(0xffffff);
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

        const existing = wSnap.machines.get(hexKey(hoveredCoord));
        if (existing) {
          activeTacticalSpec = {
            coord: hoveredCoord,
            mType: existing.type,
            dir: existing.config.dir,
            altDir: existing.config.altDir ?? rotateDir(existing.config.dir, 1),
            rotMode: existing.config.rotMode ?? 'cw',
          };
        }

        if (tool && tool !== 'erase' && tool !== 'select' && !existing?.locked) {
          const modeVal = rotMode ?? 'cw';
          const nextGhostKey = `${tool}:${dir}:${modeVal}:${tId}`;
          if (ghostKey !== nextGhostKey) {
            clearGroup(ghostGroup);
            const dummyMachine: MachineInstance = {
              id: 'ghost',
              type: tool,
              coord: { q: 0, r: 0 },
              locked: false,
              config: { dir, rotMode: modeVal, filterRule: 'even', divisor: 2 },
              state: { spawnIndex: 0, cooldown: 0, memory: null, activeFlashTicks: 0, lastActionTick: -1 },
            };
            const preview = buildMachineMesh(dummyMachine, PALETTES[tId], maxAniso);
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
      cancelActiveDrag();
      resizeObs.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', cancelActiveDrag);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);

      clearFallingTokens();
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
