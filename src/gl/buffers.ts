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

export const INSTANCE_STRIDE = 40; // bytes: vec2 pos(8) + float size(4) + float phase(4) + vec4 color(16) + float destroyTime(4) + float breathes(4)

export function createInstanceBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, 256, gl.DYNAMIC_DRAW);
  return buffer;
}

export function setupInstanceAttributes(gl: WebGL2RenderingContext, buffer: WebGLBuffer): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  const stride = INSTANCE_STRIDE;

  // location 1: a_position (vec2)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);

  // location 2: a_size (float)
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);

  // location 3: a_phase (float)
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 12);
  gl.vertexAttribDivisor(3, 1);

  // location 4: a_color (vec4)
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(4, 1);

  // location 5: a_destroyTime (float) — 0 means not destroying
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 32);
  gl.vertexAttribDivisor(5, 1);

  // location 6: a_breathes (float) — 1.0 if breathes, 0.0 otherwise
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, 36);
  gl.vertexAttribDivisor(6, 1);
}
