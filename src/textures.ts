// Builds every texture the loot-drop materials sample, fully procedurally —
// no network fetch, no external image files. Each entry below records which
// material consumed it back when these were loaded as commercial sprites:
//   noise      — M_Flash (two polar samples, REPEAT wrap)
//   lightRing  — legacy / M_Flash variants (CLAMP)
//   glow2      — M_Partic   (soft round emissive) — the only one a stock recipe uses
//   cell1      — M_Partic_2 (cellular dot pattern)
//   loot       — M_Partic_3 (loot-burst sprite)
//   sphere     — M_Sphere   (translucent glass orb)
// The commercial reference sprites were never redistributable, so the package
// always degraded to these procedural stand-ins anyway; generating them
// directly avoids six guaranteed-404 requests (and their console warnings) on
// every consumer that doesn't ship its own atlas.

export interface TextureSet {
  noise: WebGLTexture;
  lightRing: WebGLTexture;
  glow2: WebGLTexture;
  cell1: WebGLTexture;
  loot: WebGLTexture;
  sphere: WebGLTexture;
}

// Soft round emissive blob — the shape of the old T_glow_2 and a fine stand-in
// for any of the sprite textures. This is the body of every stock particle.
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

// Tiling grey value-noise — the REPEAT-wrapped noise source (unused by the
// current procedural recipes, but kept seam-tolerant for opt-in flash kinds).
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

// Generation is synchronous, but the signature stays Promise-returning so the
// renderer's `ready()` flow (and any consumer awaiting it) is unchanged.
export async function loadTextures(gl: WebGL2RenderingContext): Promise<TextureSet> {
  return {
    // Tiling cloud — REPEAT wrap so the polar UV pan never seams.
    noise: uploadTexture(gl, makeNoiseCanvas(), gl.REPEAT),
    // Centered radial / sprite-like — clamp so edges stay black.
    lightRing: uploadTexture(gl, makeGlowCanvas(), gl.CLAMP_TO_EDGE),
    glow2:     uploadTexture(gl, makeGlowCanvas(), gl.CLAMP_TO_EDGE),
    cell1:     uploadTexture(gl, makeGlowCanvas(), gl.CLAMP_TO_EDGE),
    loot:      uploadTexture(gl, makeGlowCanvas(), gl.CLAMP_TO_EDGE),
    sphere:    uploadTexture(gl, makeGlowCanvas(), gl.CLAMP_TO_EDGE),
  };
}
