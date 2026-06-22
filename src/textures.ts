// Loads every reference texture used by the loot-drop materials.
//   T_NOISE       — M_Flash (two polar samples, REPEAT wrap)
//   T_Light_Ring  — legacy / M_Flash variants (CLAMP)
//   T_glow_2      — M_Partic   (soft round emissive)
//   T_Cell_1      — M_Partic_2 (cellular dot pattern)
//   T_Loot        — M_Partic_3 (loot-burst sprite)
// All four M_Partic_N HLSL files are mathematically identical; they differ
// only by which texture is bound to Texture2D_0. Selecting via shader (and
// thus per-emitter program) avoids a runtime sampler bind.

export interface TextureSet {
  noise: WebGLTexture;
  lightRing: WebGLTexture;
  glow2: WebGLTexture;
  cell1: WebGLTexture;
  loot: WebGLTexture;
  sphere: WebGLTexture;
}

const TEXTURE_FILES = {
  noise: 'T_NOISE.PNG',
  lightRing: 'T_Light_Ring.PNG',
  glow2: 'T_glow_2.PNG',
  cell1: 'T_Cell_1.PNG',
  loot: 'T_Loot.PNG',
  // Hand-shaded translucent glass orb — the literal body of every drop.
  // The procedural M_Sphere annulus can't reproduce its rim light / internal
  // gradient, so we render it as an additive sprite (the 'orb' layer).
  sphere: 'T_SPHERE_texture.PNG',
} as const;

// Soft round emissive blob — the shape of T_glow_2 and a fine stand-in for any
// of the sprite textures. Used as the procedural fallback so the published demo
// renders even though the commercial reference/ textures aren't redistributed.
function makeGlowCanvas(size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// Tiling grey value-noise — the REPEAT-wrapped T_NOISE fallback (unused by the
// current procedural recipes, but kept seam-tolerant just in case).
function makeNoiseCanvas(size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Resolve with the loaded image, or — if it 404s / errors — a procedural
// fallback, so a missing texture set degrades gracefully instead of rejecting
// the whole renderer (which would leave the demo a blank canvas).
function loadImage(src: string, fallback: () => TexImageSource): Promise<TexImageSource> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[rift-echoes] texture ${src} failed to load — using procedural fallback`);
      resolve(fallback());
    };
    img.src = src;
  });
}

function uploadTexture(
  gl: WebGL2RenderingContext,
  img: TexImageSource,
  wrap: number,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

export async function loadTextures(
  gl: WebGL2RenderingContext,
  basePath: string,
): Promise<TextureSet> {
  const base = basePath.endsWith('/') ? basePath : basePath + '/';
  const [noiseImg, ringImg, glow2Img, cell1Img, lootImg, sphereImg] = await Promise.all([
    loadImage(base + TEXTURE_FILES.noise, makeNoiseCanvas),
    loadImage(base + TEXTURE_FILES.lightRing, makeGlowCanvas),
    loadImage(base + TEXTURE_FILES.glow2, makeGlowCanvas),
    loadImage(base + TEXTURE_FILES.cell1, makeGlowCanvas),
    loadImage(base + TEXTURE_FILES.loot, makeGlowCanvas),
    loadImage(base + TEXTURE_FILES.sphere, makeGlowCanvas),
  ]);
  return {
    // T_NOISE is a tiling cloud — REPEAT wrap so the polar UV pan never seams.
    noise: uploadTexture(gl, noiseImg, gl.REPEAT),
    // Centered radial / sprite-like — clamp so edges stay black.
    lightRing: uploadTexture(gl, ringImg, gl.CLAMP_TO_EDGE),
    glow2:     uploadTexture(gl, glow2Img, gl.CLAMP_TO_EDGE),
    cell1:     uploadTexture(gl, cell1Img, gl.CLAMP_TO_EDGE),
    loot:      uploadTexture(gl, lootImg, gl.CLAMP_TO_EDGE),
    sphere:    uploadTexture(gl, sphereImg, gl.CLAMP_TO_EDGE),
  };
}
