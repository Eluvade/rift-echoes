// Per-instance GPU layout — the single source of truth for the attribute
// stream. Field order, sizes, and shader `location`s all live here; the stride,
// FLOATS_PER_INSTANCE, and every vertexAttribPointer offset are *derived* from
// it (no hand-counted byte offsets to keep in sync). The GLSL `in` block in
// shaders/common.ts and Emitter.pack()'s write order must match this list —
// they read the same fields by the same locations.
//
//   a_position   (x,y)   — world pixels
//   a_size       (w,h)   — sprite width/height in pixels
//   a_birthTime          — seconds; shader builds t = (now - birth) / lifetime
//   a_lifetime           — seconds
//   a_rotation           — initial rotation in radians; shader adds u_rotationRate * age
//   a_color      (r,g,b,a)
//   a_destroyTime        — 0 = not destroying
interface InstanceAttr {
  location: number; // GLSL layout(location=N); 0 is the static quad
  name: string;
  size: number;     // float components
}

const INSTANCE_LAYOUT: InstanceAttr[] = [
  { location: 1, name: 'a_position',    size: 2 },
  { location: 2, name: 'a_size',        size: 2 },
  { location: 3, name: 'a_birthTime',   size: 1 },
  { location: 4, name: 'a_lifetime',    size: 1 },
  { location: 5, name: 'a_rotation',    size: 1 },
  { location: 6, name: 'a_color',       size: 4 },
  { location: 7, name: 'a_destroyTime', size: 1 },
];

export const FLOATS_PER_INSTANCE = INSTANCE_LAYOUT.reduce((n, a) => n + a.size, 0); // 12
export const INSTANCE_STRIDE = FLOATS_PER_INSTANCE * 4; // 48 bytes

export function createQuadBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const positions = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  return vbo;
}

export function createInstanceBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, INSTANCE_STRIDE * 16, gl.DYNAMIC_DRAW);
  return buffer;
}

export function setupInstanceAttributes(gl: WebGL2RenderingContext, buffer: WebGLBuffer): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  // Walk the layout once, accumulating the byte offset as we go — every pointer
  // is packed tight at FLOATS_PER_INSTANCE stride, so offsets never need to be
  // written (or mis-written) by hand.
  let offsetBytes = 0;
  for (const attr of INSTANCE_LAYOUT) {
    gl.enableVertexAttribArray(attr.location);
    gl.vertexAttribPointer(attr.location, attr.size, gl.FLOAT, false, INSTANCE_STRIDE, offsetBytes);
    gl.vertexAttribDivisor(attr.location, 1);
    offsetBytes += attr.size * 4;
  }
}
