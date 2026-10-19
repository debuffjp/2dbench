import { readPixel } from "../gl.js";
import { type Adapter, BACKGROUND, type FrameState, HEIGHT, SPRITE, WIDTH } from "../types.js";

/**
 * A hand-written WebGL2 instanced renderer: the parity reference, plus a simple baseline. One draw call;
 * per sprite 21 bytes (x, y, scale, rotation, colour, texture) from six separate buffers, uploaded straight
 * from the scene's arrays. No library and no features beyond what the scenes need. It isn't an upper
 * bound: on its first run, spryte's bulk path, which packs positions into one buffer, beat it at 200k.
 */
const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in float a_x;
layout(location=2) in float a_y;
layout(location=3) in float a_scale;
layout(location=4) in float a_rot;
layout(location=5) in uint a_color;
layout(location=6) in uint a_tex;
uniform vec2 u_view;
out vec2 v_uv;
out vec4 v_color;
flat out uint v_tex;
void main() {
  float c = cos(a_rot);
  float s = sin(a_rot);
  vec2 local = (a_corner - 0.5) * ${SPRITE}.0 * a_scale;
  vec2 p = vec2(c * local.x - s * local.y, s * local.x + c * local.y) + vec2(a_x, a_y);
  // Pixel art: unrotated sprites start on whole pixels (the same rule the libraries apply with rounding on).
  if (a_rot == 0.0) {
    vec2 origin = floor(vec2(a_x, a_y) - ${SPRITE / 2}.0 * a_scale + 0.5);
    p = origin + a_corner * ${SPRITE}.0 * a_scale;
  }
  gl_Position = vec4(p / u_view * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
  v_uv = a_corner;
  vec4 col = vec4(float(a_color >> 24u), float((a_color >> 16u) & 255u), float((a_color >> 8u) & 255u), float(a_color & 255u)) / 255.0;
  v_color = vec4(col.rgb * col.a, col.a);
  v_tex = a_tex;
}`;

const FRAG = `#version 300 es
precision mediump float;
in highp vec2 v_uv;
in vec4 v_color;
flat in uint v_tex;
uniform sampler2D u_tex[4];
out vec4 outColor;
void main() {
  vec4 t;
  if (v_tex == 0u) t = texture(u_tex[0], v_uv);
  else if (v_tex == 1u) t = texture(u_tex[1], v_uv);
  else if (v_tex == 2u) t = texture(u_tex[2], v_uv);
  else t = texture(u_tex[3], v_uv);
  outColor = t * v_color;
}`;

export const webgl2Baseline: Adapter = {
  id: "webgl2-baseline",
  label: "Hand-written WebGL2 (reference)",
  package: "",
  setup: "One instanced draw per frame; per-sprite arrays uploaded as is; premultiplied alpha; nearest filtering.",
  supports: () => true,
  async create(canvas, textures) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true }) as WebGL2RenderingContext;
    if (!gl) throw new Error("WebGL2 unavailable");
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "u_view"), WIDTH, HEIGHT);
    gl.uniform1iv(gl.getUniformLocation(program, "u_tex"), [0, 1, 2, 3]);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buffers = [1, 2, 3, 4, 5, 6].map((loc) => {
      const b = gl.createBuffer() as WebGLBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      if (loc === 5) gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_INT, 0, 0);
      else if (loc === 6) gl.vertexAttribIPointer(loc, 1, gl.UNSIGNED_BYTE, 0, 0);
      else gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
      return b;
    });
    textures.forEach((image, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, WIDTH, HEIGHT);
    const bg = BACKGROUND;
    gl.clearColor((bg >>> 24) / 255, ((bg >>> 16) & 255) / 255, ((bg >>> 8) & 255) / 255, 1);
    const upload = (i: number, data: ArrayBufferView, n: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i] as WebGLBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW, 0, n);
    };
    return {
      draw(s: FrameState) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        const n = s.count;
        upload(0, s.x, n);
        upload(1, s.y, n);
        upload(2, s.scale, n);
        upload(3, s.rotation, n);
        upload(4, s.color, n);
        upload(5, s.texture, n);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      },
      sync: () => readPixel(gl),
    };
  },
};
