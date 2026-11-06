// Literal sampler names: GLSL ES 3.00 forbids non-constant sampler-array indexing.
// Generate exactly the number needed. The ordinary variant has one sampler and
// no slab division/branch. Both integer attributes and float SH keep 32-bit data.
export function dataTextureShader(name, count = 1, float = false) {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Invalid data sampler count');
  const sampler = float ? 'sampler2DArray' : 'usampler2DArray';
  const vector = float ? 'vec4' : 'uvec4';
  const names = Array.from({length:count}, (_,i) => i ? `${name}${i}` : name);
  return `${names.map(n => `uniform highp ${sampler} ${n};`).join('\n')}
${count > 1 ? `uniform uint ${name}PointsPerSlab;` : ''}
ivec3 coord_${name}(uint pixel, ivec3 dimensions) {
  uint width = uint(dimensions.x), height = uint(dimensions.y);
  uint row = pixel / width;
  return ivec3(int(pixel % width), int(row % height), int(row / height));
}
${vector} fetch_${name}(uint point, uint subPixel, uint stride) {
  ${count > 1 ? `uint slab = point / ${name}PointsPerSlab; point %= ${name}PointsPerSlab;` : ''}
  uint pixel = point * stride + subPixel;
  ${names.map((n,i) => `${i < count-1 ? `if (slab == ${i}u) ` : ''}return texelFetch(${n}, coord_${name}(pixel, textureSize(${n}, 0)), 0);`).join('\n  ')}
}`;
}
