/** Linear RGBA records, tiled without changing CPU records or sorted indices. */
export function dataTextureLayout(texels, preferredWidth, maxSize, maxLayers) {
  if (![texels, preferredWidth, maxSize, maxLayers].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Invalid data texture dimensions or WebGL limits');
  }
  const width = Math.min(preferredWidth, maxSize);
  const rows = Math.ceil(texels / width);
  const layers = Math.ceil(rows / maxSize);
  // Balance rows across equal-sized layers to avoid nearly doubling VRAM
  // when the model exceeds a single layer by only one row.
  const height = Math.ceil(rows / layers);
  if (layers > maxLayers) {
    throw new Error(`Data texture requires ${layers} layers; GPU supports ${maxLayers} (${width}x${height}, ${texels} texels). Full-fidelity model cannot fit.`);
  }
  return { width, height, layers };
}

// ANGLE Caps.h currently caps textures at 1280 MiB (formerly 1024 MiB).
// 512 MiB leaves margin; this is a starting budget, not a portable guarantee.
// https://chromium.googlesource.com/angle/angle/+/HEAD/src/libANGLE/Caps.h
export const DEFAULT_TEXTURE_BUDGET = 512 * 1024 * 1024;
export const MAX_DATA_TEXTURES = 8;
const sets = new WeakMap();
const budgets = new WeakMap(); // Per context: reset naturally after context recreation.
export const getDataTextureSet = texture => sets.get(texture);
export function deleteDataTexture(gl, texture) {
  if (!texture) return;
  const set = sets.get(texture);
  for (const item of set?.textures || [texture]) gl.deleteTexture(item);
  sets.delete(texture);
}
export function dataTextureUnits(gl) {
  return Math.max(0, Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)) - 2);
}

export function dataTextureSlabs(texels, preferredWidth, maxSize, maxLayers, budget, stride = 4, maxTextures = 8) {
  if (![texels,preferredWidth,maxSize,maxLayers,budget,stride,maxTextures].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Invalid data texture dimensions, budget, stride or sampler capacity');
  }
  const width = Math.min(preferredWidth, maxSize);
  const rowsBudget = Math.floor(budget / 16 / width);
  const layers = Math.min(maxLayers, Math.max(1, Math.ceil(rowsBudget / maxSize)));
  const height = Math.min(maxSize, Math.floor(rowsBudget / layers));
  const pointsPerSlab = Math.floor(width * height * layers / stride);
  if (!pointsPerSlab) throw new Error('Data texture budget cannot hold one record');
  const slabTexels = pointsPerSlab * stride;
  const count = Math.ceil(texels / slabTexels);
  if (count > maxTextures) throw new Error(`Full-fidelity data needs ${count} textures at ${budget} bytes each; only ${maxTextures} sampler slots available`);
  const slabs = [];
  for (let start = 0; start < texels; start += slabTexels) {
    const length = Math.min(slabTexels, texels - start);
    // Keep full slabs rectangular within budget; the last slab can be smaller.
    const layout = length === slabTexels ? {width,height,layers} : dataTextureLayout(length, width, maxSize, maxLayers);
    // Balanced layers can round up. Fall back to the already bounded rectangle.
    if (layout.width * layout.height * layout.layers * 16 > budget) Object.assign(layout,{width,height,layers});
    slabs.push({...layout,start,length});
  }
  return {pointsPerSlab, stride, slabs};
}

export function createDataTextureArray(gl, data, preferredWidth, float = false, options = {}) {
  if (!(data instanceof (float ? Float32Array : Uint32Array)) || data.length % 4) throw new Error('Data texture requires complete RGBA records');
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  const maxTextures = Math.min(MAX_DATA_TEXTURES, dataTextureUnits(gl), options.maxTextures ?? MAX_DATA_TEXTURES);
  let budget = Math.min(options.budget ?? DEFAULT_TEXTURE_BUDGET, budgets.get(gl) ?? DEFAULT_TEXTURE_BUDGET);
  const target = gl.TEXTURE_2D_ARRAY;
  const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
  try {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (let attempt = 0; attempt < 4; attempt++, budget = Math.floor(budget / 2)) {
      const plan = dataTextureSlabs(data.length / 4, preferredWidth, maxSize, maxLayers, budget, options.stride ?? 4, maxTextures);
      const textures = [];
      let allocationError = 0;
      try {
        // Allocate the entire plan before uploading; retries never copy/upload
        // the payload twice and always release every partially allocated object.
        for (const slab of plan.slabs) {
          const texture = gl.createTexture();
          if (!texture) throw new Error('Unable to create data texture');
          textures.push(texture);
          gl.bindTexture(target, texture);
          gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texStorage3D(target, 1, float ? gl.RGBA32F : gl.RGBA32UI, slab.width, slab.height, slab.layers);
          allocationError = gl.getError();
          if (allocationError !== gl.NO_ERROR) throw new Error(`Data texture allocation failed: WebGL ${allocationError} (${slab.width}x${slab.height}x${slab.layers}, budget ${budget})`);
        }
        const format = float ? gl.RGBA : gl.RGBA_INTEGER;
        const type = float ? gl.FLOAT : gl.UNSIGNED_INT;
        plan.slabs.forEach((slab, i) => {
          gl.bindTexture(target, textures[i]);
          const {width,height,start,length} = slab;
          const end = (start + length) * 4;
          for (let layer = 0, offset = start * 4; offset < end; layer++) {
            const elements = Math.min(width * height * 4, end - offset);
            const rows = Math.floor(elements / (width * 4));
            if (rows) gl.texSubImage3D(target, 0, 0, 0, layer, width, rows, 1, format, type, data.subarray(offset, offset + rows * width * 4));
            const tail = elements - rows * width * 4;
            if (tail) gl.texSubImage3D(target, 0, 0, rows, layer, tail / 4, 1, 1, format, type, data.subarray(offset + rows * width * 4, offset + elements));
            offset += elements;
          }
          const error = gl.getError();
          if (error !== gl.NO_ERROR) throw new Error(`Data texture upload failed: WebGL ${error}`);
        });
        budgets.set(gl, budget);
        sets.set(textures[0], {...plan, textures, budget});
        if (textures.length > 1 || attempt > 0) console.info('[DataTexture]', {
          textureCount: textures.length, budgetMiB: budget / 1048576,
          pointsPerSlab: plan.pointsPerSlab, sourceTexels: data.length / 4,
          maxTextureSize: maxSize,
        });
        // Preserve the public single-WebGLTexture handle; metadata owns siblings.
        return textures[0];
      } catch (error) {
        textures.forEach(texture => gl.deleteTexture(texture));
        if (allocationError !== gl.INVALID_OPERATION || attempt === 3 || gl.isContextLost?.()) throw error;
      }
    }
  } finally {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
  }
}
