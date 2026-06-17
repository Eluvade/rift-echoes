// 12 floats per instance / 48 bytes:
//   [0,1]   pos (x,y)            — world pixels
//   [2,3]   size (w,h)           — sprite width/height in pixels
//   [4]     birthTime            — seconds
//   [5]     lifetime             — seconds; shader builds t = (now - birth) / lifetime
//   [6]     rotation             — initial rotation in radians; shader adds u_rotationRate * age
//   [7..10] color (r,g,b,a)
//   [11]    destroyTime          — 0 = not destroying

export const FLOATS_PER_INSTANCE = 12;
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
  const stride = INSTANCE_STRIDE;

  // location 1: a_position (vec2)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);

  // location 2: a_size (vec2)
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);

  // location 3: a_birthTime (float)
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(3, 1);

  // location 4: a_lifetime (float)
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 20);
  gl.vertexAttribDivisor(4, 1);

  // location 5: a_rotation (float)
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 24);
  gl.vertexAttribDivisor(5, 1);

  // location 6: a_color (vec4)
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 28);
  gl.vertexAttribDivisor(6, 1);

  // location 7: a_destroyTime (float)
  gl.enableVertexAttribArray(7);
  gl.vertexAttribPointer(7, 1, gl.FLOAT, false, stride, 44);
  gl.vertexAttribDivisor(7, 1);
}
