import * as THREE from 'three';

export type PaletteThemeId = 'emerald' | 'sky' | 'mono' | 'workshop';

export interface ThemePalette {
  id: PaletteThemeId;
  name: string;
  abyssBg: number;
  abyssDot: number;
  skyZenith: number;
  skyMid: number;
  skyHorizon: number;
  skyAbyss: number;
  fogColor: number;
  sunColor: number;
  sunGlow: number;
  hemiSky: number;
  hemiGround: number;
  cloudTop: number;
  cloudBottom: number;
  hexTop: number;
  hexSide: number;
  hexRim: number;
  hexGridLine: number;
  cliffTop: number;
  cliffSide: number;
  ink: number;
  accent: number;
  accentSecondary: number;
  machineBase: number;
  machineTop: number;
  sinkGlow: number;
  rodColor: number;
  channelColor: number;
  channelPulse: number;
  valleyCliff: number;
  valleyCliffTop: number;
  valleyGrass: number;
  valleyRiver: number;
  valleyRiverHighlight: number;
  valleyMountain: number;
  holoBg: string;
  holoBorder: string;
  holoText: string;
}

export const PALETTES: Record<PaletteThemeId, ThemePalette> = {
  emerald: {
    id: 'emerald',
    name: 'Изумруд',
    abyssBg: 0x102922,
    abyssDot: 0x0b1f19,
    skyZenith: 0x0b1f19,
    skyMid: 0x183d33,
    skyHorizon: 0x4b8570,
    skyAbyss: 0x0d241d,
    fogColor: 0x2f594b,
    sunColor: 0xfff0d4,
    sunGlow: 0xffdfad,
    hemiSky: 0xcffae8,
    hemiGround: 0x132b23,
    cloudTop: 0xbfe0d3,
    cloudBottom: 0x477362,
    hexTop: 0x19332a,
    hexSide: 0x0d1c17,
    hexRim: 0x326150,
    hexGridLine: 0x3b7862,
    cliffTop: 0x224539,
    cliffSide: 0x11241e,
    ink: 0x081410,
    accent: 0xf59e0b,
    accentSecondary: 0x2dd4bf,
    machineBase: 0x204035,
    machineTop: 0xa7ebc9,
    sinkGlow: 0xf0fbf5,
    rodColor: 0xf5b5ad,
    channelColor: 0x10b981,
    channelPulse: 0xa7f3d0,
    valleyCliff: 0x122922,
    valleyCliffTop: 0x1e3d33,
    valleyGrass: 0x2c5942,
    valleyRiver: 0x1e5e63,
    valleyRiverHighlight: 0x6ee7d8,
    valleyMountain: 0x2a4d42,
    holoBg: 'rgba(8, 24, 19, 0.88)',
    holoBorder: '#5eead4',
    holoText: '#ecfdf5',
  },
  sky: {
    id: 'sky',
    name: 'Лазурь',
    abyssBg: 0x182b4d,
    abyssDot: 0x111f38,
    skyZenith: 0x142852,
    skyMid: 0x2e5491,
    skyHorizon: 0x7aa3d6,
    skyAbyss: 0x17294a,
    fogColor: 0x4d71a3,
    sunColor: 0xfff7e8,
    sunGlow: 0xffe4bd,
    hemiSky: 0xe6f2ff,
    hemiGround: 0x203559,
    cloudTop: 0xd9e9fc,
    cloudBottom: 0x6b8eb8,
    hexTop: 0x1d2c47,
    hexSide: 0x101a2b,
    hexRim: 0x395480,
    hexGridLine: 0x476ca6,
    cliffTop: 0x283e61,
    cliffSide: 0x15233b,
    ink: 0x0a1221,
    accent: 0xa78bfa,
    accentSecondary: 0x38bdf8,
    machineBase: 0x2c4366,
    machineTop: 0xe2eeff,
    sinkGlow: 0xf8fcff,
    rodColor: 0xc9dcfa,
    channelColor: 0x38bdf8,
    channelPulse: 0xe0f2fe,
    valleyCliff: 0x1a2a47,
    valleyCliffTop: 0x294169,
    valleyGrass: 0x325457,
    valleyRiver: 0x2b62a6,
    valleyRiverHighlight: 0x94cbff,
    valleyMountain: 0x3d5c8a,
    holoBg: 'rgba(13, 28, 56, 0.88)',
    holoBorder: '#7dd3fc',
    holoText: '#f0f9ff',
  },
  mono: {
    id: 'mono',
    name: 'Графит',
    abyssBg: 0x1c212b,
    abyssDot: 0x13171f,
    skyZenith: 0x171c26,
    skyMid: 0x343d4d,
    skyHorizon: 0x7b8799,
    skyAbyss: 0x1a1f29,
    fogColor: 0x525d6e,
    sunColor: 0xfffaf0,
    sunGlow: 0xffe5c4,
    hemiSky: 0xf0f5fa,
    hemiGround: 0x29303b,
    cloudTop: 0xd6dce6,
    cloudBottom: 0x737e8f,
    hexTop: 0x20252e,
    hexSide: 0x12151a,
    hexRim: 0x3f4757,
    hexGridLine: 0x4b5566,
    cliffTop: 0x2e3540,
    cliffSide: 0x171b24,
    ink: 0x0b0e14,
    accent: 0x22c55e,
    accentSecondary: 0xf59e0b,
    machineBase: 0x323945,
    machineTop: 0xe2e8f0,
    sinkGlow: 0xfafbfd,
    rodColor: 0xe6ebf2,
    channelColor: 0x22c55e,
    channelPulse: 0xbbf7d0,
    valleyCliff: 0x1d232e,
    valleyCliffTop: 0x2d3542,
    valleyGrass: 0x374f45,
    valleyRiver: 0x2f5070,
    valleyRiverHighlight: 0x8cb3d4,
    valleyMountain: 0x424d5e,
    holoBg: 'rgba(16, 20, 28, 0.88)',
    holoBorder: '#4ade80',
    holoText: '#f8fafc',
  },
  workshop: {
    id: 'workshop',
    name: 'Мастерская',
    abyssBg: 0x162133,
    abyssDot: 0x20304a,
    skyZenith: 0x111c30,
    skyMid: 0x243b5e,
    skyHorizon: 0x6283ab,
    skyAbyss: 0x142033,
    fogColor: 0x3e587d,
    sunColor: 0xfff3db,
    sunGlow: 0xffd599,
    hemiSky: 0xd6ebff,
    hemiGround: 0x1c283b,
    cloudTop: 0xc9d8eb,
    cloudBottom: 0x577094,
    hexTop: 0x1b2433,
    hexSide: 0x0f151f,
    hexRim: 0x364863,
    hexGridLine: 0x405b80,
    cliffTop: 0x263447,
    cliffSide: 0x141c29,
    ink: 0x090f1a,
    accent: 0xf59e0b,
    accentSecondary: 0x0ea5e9,
    machineBase: 0x273347,
    machineTop: 0xe3ecf7,
    sinkGlow: 0xf7fcff,
    rodColor: 0x5eead4,
    channelColor: 0x0ea5e9,
    channelPulse: 0x7dd3fc,
    valleyCliff: 0x172233,
    valleyCliffTop: 0x26364f,
    valleyGrass: 0x315442,
    valleyRiver: 0x255387,
    valleyRiverHighlight: 0x7dbbff,
    valleyMountain: 0x354d70,
    holoBg: 'rgba(11, 19, 31, 0.88)',
    holoBorder: '#38bdf8',
    holoText: '#f0f9ff',
  },
};

export interface StylizedMaterialOptions {
  emissive?: number;
  emissiveIntensity?: number;
  map?: THREE.Texture;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

/**
 * Calibrated soft 3D diorama PBR material (Tunic / Monument Valley aesthetic):
 * tactile satin/matte surfaces with gentle environment bounce and optional emissive glow.
 */
export function createCelMaterial(
  color: number,
  options: StylizedMaterialOptions = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: options.map ? 0xffffff : color,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    map: options.map ?? null,
    roughness: options.roughness ?? 0.56,
    metalness: options.metalness ?? 0.06,
    envMapIntensity: options.envMapIntensity ?? 0.38,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  });
}

export function createOutlineShaderMaterial(
  inkColor: number,
  thickness = 0.011,
  opacity = 0.3,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(inkColor) },
      uThickness: { value: thickness },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      uniform float uThickness;
      void main() {
        vec3 pos = position + normal * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Delicate, non-jagged tonal rim accent (replaces heavy cartoon black borders).
 */
export function addInkOutline(
  mesh: THREE.Mesh,
  inkColor: number,
  thickness = 0.015,
): THREE.Mesh {
  const refinedThickness = Math.min(0.014, thickness * 0.45);
  const outlineMat = createOutlineShaderMaterial(inkColor, refinedThickness, 0.24);
  const outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.userData.isOutline = true;
  mesh.add(outline);
  return outline;
}

/**
 * Smooth atmospheric multi-stop sky-dome gradient shader with subtle solar bloom
 * and soft horizon haze (replaces noisy repeating polka-dot abyss).
 */
export function createSkyDomeMaterial(palette: ThemePalette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(palette.skyZenith) },
      uMid: { value: new THREE.Color(palette.skyMid) },
      uHorizon: { value: new THREE.Color(palette.skyHorizon) },
      uAbyss: { value: new THREE.Color(palette.skyAbyss) },
      uSunGlow: { value: new THREE.Color(palette.sunGlow) },
      uSunDir: { value: new THREE.Vector3(0.42, 0.58, -0.68).normalize() },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vLocalDir;
      void main() {
        vLocalDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uAbyss;
      uniform vec3 uSunGlow;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vLocalDir;

      void main() {
        float y = vLocalDir.y;

        // Smooth 4-stop vertical atmospheric sky gradient
        vec3 col = mix(uAbyss, uHorizon, smoothstep(-0.42, -0.02, y));
        col = mix(col, uMid, smoothstep(-0.02, 0.24, y));
        col = mix(col, uZenith, smoothstep(0.22, 0.82, y));

        // Soft warm atmospheric solar bloom in upper sky
        float sunAmt = max(0.0, dot(normalize(vLocalDir), uSunDir));
        float sunHalo = pow(sunAmt, 7.0) * 0.22 + pow(sunAmt, 42.0) * 0.25;
        col = mix(col, uSunGlow, clamp(sunHalo, 0.0, 0.45));

        // Very subtle drifting atmospheric horizon band
        float angle = atan(vLocalDir.z, vLocalDir.x);
        float horizonBand = exp(-pow((y + 0.03) * 7.5, 2.0));
        float wave = 0.5 + 0.5 * sin(angle * 3.0 + uTime * 0.08) * cos(angle * 5.0 - uTime * 0.05);
        col = mix(col, uHorizon * 1.03, horizonBand * wave * 0.16);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/**
 * Animated glowing inlaid pathway channel shader for connected tracks on the hex deck.
 * Uses a dark recessed trench outer edge framing a luminous animated core so it stays crisp on light tiles.
 */
export function createInlaidChannelMaterial(
  baseColor: number,
  pulseColor: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(baseColor) },
      uPulse: { value: new THREE.Color(pulseColor) },
      uGroove: { value: new THREE.Color(0x1f3547) },
      uTime: { value: 0 },
      uActive: { value: 0.28 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uBase;
      uniform vec3 uPulse;
      uniform vec3 uGroove;
      uniform float uTime;
      uniform float uActive;
      varying vec2 vUv;

      void main() {
        float centerDist = abs(vUv.y - 0.5) * 2.0;
        float trenchMask = 1.0 - smoothstep(0.62, 0.96, centerDist);
        float coreMask = 1.0 - smoothstep(0.12, 0.55, centerDist);

        float speed = mix(0.85, 2.6, uActive);
        float wave = 0.5 + 0.5 * sin((vUv.x * 11.0) - uTime * speed);
        float pulse = pow(wave, 2.6);

        vec3 coreCol = mix(uBase, uPulse, pulse * (0.35 + 0.65 * uActive));
        vec3 col = mix(uGroove, coreCol, coreMask);
        float alpha = trenchMask * mix(0.68, 0.92, uActive);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Stylized twilight canyon river shader with gentle flowing specular current bands.
 */
export function createRiverWaterMaterial(
  riverColor: number,
  highlightColor: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRiver: { value: new THREE.Color(riverColor) },
      uHighlight: { value: new THREE.Color(highlightColor) },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uRiver;
      uniform vec3 uHighlight;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        float flow = vUv.x * 24.0 - uTime * 0.55;
        float ripple1 = sin(flow + sin(vUv.y * 10.0 + uTime * 0.35) * 1.4);
        float ripple2 = cos(vUv.x * 13.0 - uTime * 0.32 + vUv.y * 7.0);
        float band = smoothstep(0.55, 0.96, ripple1 * 0.55 + ripple2 * 0.45);

        float edgeFoam = smoothstep(0.38, 0.495, abs(vUv.y - 0.5));
        float centerSheen = exp(-pow((vUv.y - 0.5) * 3.0, 2.0)) * 0.24;

        vec3 col = mix(uRiver * 0.86, uHighlight, band * 0.36 + centerSheen + edgeFoam * 0.22);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

let cachedContactShadowTex: THREE.CanvasTexture | null = null;

/**
 * Soft radial ambient-occlusion contact shadow texture for grounding spheres, machines & trees.
 */
export function getSoftContactShadowTexture(): THREE.CanvasTexture {
  if (cachedContactShadowTex) return cachedContactShadowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.06,
    size / 2,
    size / 2,
    size * 0.48,
  );
  grad.addColorStop(0, 'rgba(12, 24, 38, 0.42)');
  grad.addColorStop(0.55, 'rgba(12, 24, 38, 0.16)');
  grad.addColorStop(1, 'rgba(12, 24, 38, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData = { isShared: true };
  cachedContactShadowTex = tex;
  return tex;
}

let cachedDustMoteTex: THREE.CanvasTexture | null = null;

/**
 * Soft glowing sunlit dust mote sprite texture.
 */
export function getSoftGlowParticleTexture(): THREE.CanvasTexture {
  if (cachedDustMoteTex) return cachedDustMoteTex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size * 0.48);
  grad.addColorStop(0, 'rgba(255, 252, 240, 1)');
  grad.addColorStop(0.35, 'rgba(255, 246, 214, 0.65)');
  grad.addColorStop(1, 'rgba(255, 246, 214, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData = { isShared: true };
  cachedDustMoteTex = tex;
  return tex;
}

/**
 * High-DPI crisp CanvasTexture for machine symbol decals (+1, ×2, √x, Σ, etc.).
 */
export function createSymbolDecalTexture(
  symbol: string,
  bgColor: string,
  fgColor: string,
  inkColor: string,
  maxAniso: number,
  subLabel?: string,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  // Subtle concentric engraved dial ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.41, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = inkColor;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (symbol === 'WELD_ICON') {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(size * 0.3, size * 0.44);
    ctx.lineTo(size * 0.7, size * 0.44);
    ctx.stroke();

    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(size * 0.3, size * 0.44);
    ctx.lineTo(size * 0.7, size * 0.44);
    ctx.stroke();

    for (const cx of [size * 0.3, size * 0.7]) {
      ctx.beginPath();
      ctx.arc(cx, size * 0.44, 21, 0, Math.PI * 2);
      ctx.fillStyle = fgColor;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = inkColor;
      ctx.stroke();
    }
  } else {
    const fontSize =
      symbol.length >= 6
        ? 54
        : symbol.length >= 4
          ? 68
          : symbol.length === 3
            ? 80
            : symbol.length === 2
              ? 102
              : 122;
    ctx.font = `800 ${fontSize}px "JetBrains Mono", "Plus Jakarta Sans", monospace`;

    ctx.shadowColor = 'rgba(15, 23, 42, 0.24)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.lineWidth = symbol.length >= 5 ? 6 : 8;
    ctx.strokeStyle = inkColor;
    ctx.lineJoin = 'round';
    ctx.strokeText(symbol, size / 2, subLabel ? size * 0.45 : size * 0.52);

    ctx.shadowColor = 'transparent';
    ctx.fillStyle = fgColor;
    ctx.fillText(symbol, size / 2, subLabel ? size * 0.45 : size * 0.52);
  }

  if (subLabel) {
    ctx.font = `700 28px "JetBrains Mono", monospace`;
    ctx.fillStyle = inkColor;
    ctx.globalAlpha = 0.85;
    ctx.fillText(subLabel, size / 2, size * 0.78);
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createTokenNumberTexture(
  value: number,
  discColor: string,
  inkColor: string,
  maxAniso: number,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = new THREE.Color(discColor);
  const lighter = base.clone().lerp(new THREE.Color(0xffffff), 0.16);
  const darker = base.clone().lerp(new THREE.Color(0x000000), 0.12);

  const grad = ctx.createRadialGradient(
    size * 0.36,
    size * 0.34,
    size * 0.04,
    size * 0.5,
    size * 0.5,
    size * 0.52,
  );
  grad.addColorStop(0, `#${lighter.getHexString()}`);
  grad.addColorStop(0.62, `#${base.getHexString()}`);
  grad.addColorStop(1, `#${darker.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Soft glossy highlight arc
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.37, -Math.PI * 0.82, -Math.PI * 0.24);
  ctx.stroke();

  const text = String(value);
  const fontSize = text.length >= 4 ? 76 : text.length === 3 ? 92 : text.length === 2 ? 116 : 138;
  ctx.font = `800 ${fontSize}px "JetBrains Mono", "Plus Jakarta Sans", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(10, 18, 28, 0.38)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.lineWidth = 10;
  ctx.strokeStyle = inkColor;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, size / 2, size * 0.53);

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, size / 2, size * 0.53);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/**
 * Sleek translucent holographic badge texture with glowing corner brackets and subtle scanlines
 * (replaces opaque comic speech-bubble labels).
 */
export function createBillboardSignTexture(
  text: string,
  bgColor: string,
  fgColor: string,
  borderColor: string,
  maxAniso: number,
): THREE.CanvasTexture {
  const cw = 280;
  const ch = 112;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, cw, ch);
  const pad = 12;
  const rw = cw - pad * 2;
  const rh = ch - pad * 2 - 8;
  const rad = 16;

  // Translucent holographic plate
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(pad, pad, rw, rh, rad);
  ctx.fill();

  // Subtle horizontal scanlines inside badge
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, pad, rw, rh, rad);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  for (let y = pad; y < pad + rh; y += 6) {
    ctx.fillRect(pad, y, rw, 2);
  }
  ctx.restore();

  // Crisp glowing hairline border
  ctx.lineWidth = 3;
  ctx.strokeStyle = borderColor;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.roundRect(pad, pad, rw, rh, rad);
  ctx.stroke();

  // Illuminated corner brackets
  ctx.globalAlpha = 1;
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = borderColor;
  const blen = 14;
  const x0 = pad;
  const y0 = pad;
  const x1 = pad + rw;
  const y1 = pad + rh;

  const corners: Array<[number, number, number, number]> = [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * blen);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * blen, cy);
    ctx.stroke();
  }

  // Downward projection pointer notch
  ctx.fillStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(cw / 2 - 8, y1 + 1);
  ctx.lineTo(cw / 2 + 8, y1 + 1);
  ctx.lineTo(cw / 2, y1 + 9);
  ctx.closePath();
  ctx.fill();

  const fontSize = text.length >= 5 ? 38 : text.length >= 3 ? 46 : 54;
  ctx.font = `800 ${fontSize}px "JetBrains Mono", "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = borderColor;
  ctx.shadowBlur = 10;
  ctx.fillStyle = fgColor;
  ctx.fillText(text, cw / 2, pad + rh / 2 + 1);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function getTokenPaletteColor(value: number, theme: PaletteThemeId): string {
  if (theme === 'workshop') {
    if (value < 0) return '#e11d48';
    if (value === 0) return '#64748b';
    if (value === 1 || value === 2) return '#22b868';
    if (value === 3) return '#ef4444';
    if (value === 4) return '#f59e0b';
    if (value === 5) return '#3b82f6';
    if (value === 6) return '#fb923c';
    if (value === 7) return '#a855f7';
    if (value >= 10) return '#f59e0b';
    return '#06b6d4';
  }
  if (theme === 'mono') {
    if (value < 0) return '#e11d48';
    if (value === 0) return '#64748b';
    if (value === 1 || value === 2) return '#22b354';
    if (value === 4) return '#f28918';
    if (value === 6) return '#15a589';
    if (value >= 8) return '#e2e8f0';
    return '#3b82f6';
  }
  if (theme === 'sky') {
    if (value < 0) return '#f43f5e';
    if (value === 0) return '#94a3b8';
    if (value % 2 === 0) return '#818cf8';
    return '#c084fc';
  }
  // emerald
  if (value < 0) return '#e11d48';
  if (value === 0) return '#64748b';
  if (value === 1) return '#6ee7b7';
  if (value === 2 || value === 3) return '#34a875';
  if (value >= 5) return '#fbbf24';
  return '#fb7185';
}
