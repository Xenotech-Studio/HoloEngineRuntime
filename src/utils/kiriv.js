/** KiriV v2 CPU reader. File contract: ../../docs/kiriv-format.md. No GPU required. */
export const KIRIV_MAGIC = 0x3256524b;
export const LEGACY_MAGIC = 0x674b;
export const KIRIV_LAYOUTS = Object.freeze({ preview: 56, standard: 64, high: 128, native: null });
const fail = (message) => { throw new Error(`KiriV: ${message}`); };
const integer = (x, min = 0) => Number.isSafeInteger(x) && x >= min;
const finiteArray = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const sigmoid = (x) => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));

export function halfToFloat(h) {
  const sign = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 31, f = h & 1023;
  return e === 0 ? sign * 2 ** -14 * f / 1024 : e === 31 ? (f ? NaN : sign * Infinity) : sign * 2 ** (e - 15) * (1 + f / 1024);
}

export function validateKiriVHeader(h) {
  if (!h || Array.isArray(h) || typeof h !== 'object') fail('header must be an object');
  if (!['stg', 'freetimegs'].includes(h.representations)) fail('unknown representations');
  if (!Object.hasOwn(KIRIV_LAYOUTS, h.payload_layout)) fail('unknown payload_layout');
  if (!integer(h.gaussian_count) || !integer(h.record_bytes, 1) || !integer(h.size)) fail('invalid count/size');
  if (!integer(h.sh_degree) || h.sh_degree > 3) fail('unsupported SH degree');
  if (!['rgb', 'sh'].includes(h.color_encoding)) fail('unknown color_encoding');
  if (h.color_encoding === 'rgb' && h.sh_degree !== 0) fail('RGB requires degree 0');
  if (h.color_encoding === 'sh' && (h.payload_layout !== 'native' || h.representations !== 'freetimegs')) fail('SH requires native FTGS');
  const colors = h.color_encoding === 'sh' ? 3 * (h.sh_degree + 1) ** 2 : 3;
  const stride = h.payload_layout === 'native' ? 104 + colors * 4 : KIRIV_LAYOUTS[h.payload_layout];
  if (stride !== h.record_bytes || !Number.isSafeInteger(stride * h.gaussian_count) || stride * h.gaussian_count !== h.size) fail('record/payload size mismatch');
  if (!Array.isArray(h.losses) || !h.losses.every(x => typeof x === 'string')) fail('losses must be string array');
  const t = h.time;
  if (!t || !['normalized', 'seconds', 'frames', 'unspecified'].includes(t.units) || !finiteArray(t.range, 2) || !(t.range[1] > t.range[0]) || !Number.isFinite(t.range[1] - t.range[0])) fail('invalid timeline');
  if (!(t.fps === null || Number.isFinite(t.fps) && t.fps > 0) || !(t.n_frames === null || integer(t.n_frames, 1))) fail('invalid fps/n_frames');
  const c = h.coordinates;
  if (!c || !['training', 'world'].includes(c.space) || typeof c.axis_convention !== 'string' || !c.axis_convention.length) fail('invalid coordinates');
  if (c.world_from_file !== null) {
    const m = c.world_from_file;
    if (!finiteArray(m, 16) || m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1) fail('invalid affine world_from_file');
    const det = m[0]*(m[5]*m[10]-m[6]*m[9])-m[1]*(m[4]*m[10]-m[6]*m[8])+m[2]*(m[4]*m[9]-m[5]*m[8]);
    if (!Number.isFinite(det) || det === 0) fail('singular world_from_file');
  }
  if (h.cameras !== undefined) {
    if (!Array.isArray(h.cameras)) fail('cameras must be array');
    for (const c of h.cameras) {
      if (!c || !integer(c.width, 1) || !integer(c.height, 1) || !finiteArray(c.position, 3) || !Array.isArray(c.rotation) || c.rotation.length !== 3 || !c.rotation.every(r => finiteArray(r, 3)) || !Number.isFinite(c.fx) || c.fx <= 0 || !Number.isFinite(c.fy) || c.fy <= 0 || (c.cx !== undefined && !Number.isFinite(c.cx)) || (c.cy !== undefined && !Number.isFinite(c.cy))) fail('invalid camera');
    }
  }
  if (h.representations === 'stg' ? h.render_profile !== 'stg_legacy' : h.render_profile !== 'ftgs' || !Number.isFinite(h.opacity_floor) || h.opacity_floor < 0 || h.opacity_floor > 1) fail('invalid render profile/floor');
  if (h.payload_layout === 'preview') {
    const q = h.quantization;
    if (!q || !finiteArray(q.offset, 25) || !finiteArray(q.scale, 25) || q.scale.some(s => s < 0)) fail('invalid quantization table');
  }
  return { colors, stride };
}

function checkRecord(a, h, row) {
  if (!a.every(Number.isFinite)) fail(`nonfinite attribute at record ${row}`);
  if (Math.hypot(...a.slice(3, 7)) === 0) fail(`zero quaternion at ${row}`);
  if (a.slice(7, 10).some(s => s <= 0) || a[12] <= 0 || a[10] < 0 || a[10] > 1) fail(`invalid scale/width/opacity at ${row}`);
  if (h.representations === 'freetimegs' && a.slice(16, 26).some(x => x !== 0)) fail(`nonlinear FTGS at ${row}`);
}

export function parseKiriV(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 12) fail('truncated prefix');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== KIRIV_MAGIC) fail('unknown magic');
  if (dv.getUint16(4, true) !== 2) fail('unknown version');
  if (dv.getUint16(6, true) !== 0) fail('unknown flags');
  const length = dv.getUint32(8, true);
  if (length === 0 || length > 16777216 || length > bytes.length - 12) fail('invalid/truncated JSON length');
  if (bytes[12] === 0xef && bytes[13] === 0xbb && bytes[14] === 0xbf) fail('JSON BOM forbidden');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + length)));
  const { colors, stride } = validateKiriVHeader(header);
  const start = Math.ceil((12 + length) / 16) * 16;
  if (start > bytes.length || bytes.length - start !== header.size) fail('truncated/trailing/out-of-bounds payload');
  for (let i = 12 + length; i < start; i++) if (bytes[i] !== 0) fail('nonzero alignment padding');
  const width = 4096, height = Math.max(1, Math.ceil(header.gaussian_count * 32 / width));
  // Explicit CPU memory budget, not silent partial loading.
  if (width * height * 16 > 1073741824) fail('decoded runtime texture exceeds 1 GiB limit');
  const runtime = new Float32Array(width * height * 4);
  const delta = header.time.range[1] - header.time.range[0];
  const a = new Float32Array(26 + colors);
  for (let row = 0; row < header.gaussian_count; row++) {
    const b = start + row * stride;
    const f = (o) => dv.getFloat32(b + o, true);
    const half = (o) => halfToFloat(dv.getUint16(b + o, true));
    const zero = (lo, hi) => { for (let k = lo; k < hi; k++) if (bytes[b + k]) fail(`nonzero reserved bytes at ${row}`); };
    if (header.payload_layout === 'native') {
      for (let k = 0; k < a.length; k++) a[k] = f(k * 4);
      // Validate raw fields before exp/sigmoid (which can hide infinity).
      if (!a.every(Number.isFinite)) fail(`nonfinite native attribute at ${row}`);
      for (let k = 7; k < 10; k++) a[k] = Math.exp(a[k]);
      a[10] = sigmoid(a[10]);
      a[12] = Math.exp(a[12]) * (header.representations === 'freetimegs' ? Math.SQRT2 : 1);
    } else if (header.payload_layout === 'preview') {
      const q = new Float32Array(25);
      for (let k = 0; k < 25; k++) q[k] = header.quantization.offset[k] + header.quantization.scale[k] * dv.getUint16(b + 2*k, true);
      a.set(q.subarray(0, 10)); a.set(q.subarray(10, 12), 11); a.set(q.subarray(12), 13);
      a[10] = bytes[b + 53] / 255;
      for (let k = 0; k < 3; k++) a[26+k] = bytes[b+50+k] / 255;
      zero(54, 56);
    } else {
      for (let k = 0; k < 3; k++) a[k] = f(4*k);
      for (let k = 0; k < 4; k++) a[3+k] = half(12+2*k);
      for (let k = 0; k < 3; k++) a[7+k] = half(20+2*k);
      a[10] = bytes[b+31]/255; a[11] = half(60); a[12] = half(62);
      for (let k = 0; k < 9; k++) a[13+k] = half(32+2*k);
      for (let k = 0; k < 4; k++) a[22+k] = half(52+2*k);
      for (let k = 0; k < 3; k++) a[26+k] = bytes[b+28+k]/255;
      zero(26, 28); zero(50, 52);
      if (header.payload_layout === 'high') {
        for (let k = 0; k < 4; k++) a[3+k] = f(64+4*k);
        for (let k = 0; k < 3; k++) a[7+k] = f(80+4*k);
        zero(92, 128);
      }
    }
    checkRecord(a, header, row);
    // Normalize file clock once; shader and depth worker receive identical fp32.
    a[11] = (a[11] - header.time.range[0]) / delta;
    a[12] /= delta;
    for (let k = 0; k < 9; k++) a[13+k] *= delta ** (1 + Math.floor(k/3));
    for (let k = 0; k < 4; k++) a[22+k] *= delta;
    checkRecord(a, header, row);
    runtime.set(a, row * 128);
  }
  return {
    data: new Uint32Array(runtime.buffer), buffer: runtime, width, height,
    gaussianCount: header.gaussian_count, gaussStridePixels: 32,
    precisionVariant: 'kiriv_f32', representation: header.representations,
    colorEncoding: header.color_encoding, shDegree: header.sh_degree,
    opacityFloor: header.opacity_floor ?? 0, cameras: header.cameras ?? null,
    kirivHeader: header,
  };
}

/** Legacy metadata validation; valid legacy bytes/count/arithmetic stay untouched. */
export function validateLegacyChunk(chunk) {
  if (chunk.format_version !== undefined && chunk.format_version !== 1) fail('unknown legacy format_version');
  if (chunk.representation !== undefined && chunk.representations !== undefined && chunk.representation !== chunk.representations) fail('conflicting legacy representation tags');
  const rep = chunk.representations ?? chunk.representation ?? 'stg';
  if (rep !== 'stg') fail('legacy magic supports STG only');
  const precision = chunk.precision_variant ?? 'lite';
  if (!['lite', 'hp_scale_rot'].includes(precision)) fail('unknown legacy precision_variant');
  const stride = precision === 'hp_scale_rot' ? 8 : 4;
  if ((chunk.gauss_stride_pixels ?? stride) !== stride) fail('legacy stride mismatch');
  if (chunk.payload_layout !== undefined && chunk.payload_layout !== (stride === 8 ? 'high' : 'standard')) fail('unknown/inconsistent legacy payload_layout');
  if (!integer(chunk.texwidth, 1) || !integer(chunk.texheight, 1) || !integer(chunk.size, 1) || chunk.size !== chunk.texwidth*chunk.texheight*16 || chunk.size % (stride*16)) fail('legacy texture size mismatch');
  return { representation: 'stg', precisionVariant: precision, gaussStridePixels: stride };
}

/** CPU formula oracle using the very same runtime slots consumed by shader/worker. */
export function evaluateKiriVRecord(a, representation, t, opacityFloor = 0) {
  if (!['stg', 'freetimegs'].includes(representation)) fail('unknown representation');
  const dt = t-a[11];
  const position = [0,1,2].map(k => a[k]+a[13+k]*dt+(representation === 'stg' ? a[16+k]*dt*dt+a[19+k]*dt*dt*dt : 0));
  const q = [0,1,2,3].map(k => a[3+k]+(representation === 'stg' ? a[22+k]*dt : 0));
  const norm = Math.hypot(...q);
  const weight = Math.exp(-((dt/a[12])**2));
  return { position, rotation: q.map(x=>x/norm), weight, opacity: representation === 'freetimegs' ? Math.max(a[10]*weight, opacityFloor) : a[10]*weight };
}
