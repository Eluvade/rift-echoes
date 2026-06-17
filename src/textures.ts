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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function uploadTexture(
  gl: WebGL2RenderingContext,
  img: HTMLImageElement,
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
    loadImage(base + TEXTURE_FILES.noise),
    loadImage(base + TEXTURE_FILES.lightRing),
    loadImage(base + TEXTURE_FILES.glow2),
    loadImage(base + TEXTURE_FILES.cell1),
    loadImage(base + TEXTURE_FILES.loot),
    loadImage(base + TEXTURE_FILES.sphere),
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
