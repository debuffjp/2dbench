const pixel = new Uint8Array(4);

/** Block until the GPU has finished all submitted work: a 1-pixel readback is a full pipeline sync. */
export function readPixel(gl: WebGL2RenderingContext | WebGLRenderingContext): void {
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

/** For Canvas 2D: createImageBitmap flushes the canvas while keeping it on the GPU (getImageData would not). */
export function syncCanvas(canvas: HTMLCanvasElement): Promise<void> {
  return createImageBitmap(canvas).then((bitmap) => bitmap.close());
}
