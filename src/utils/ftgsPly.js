/** Native FreeTimeGS PLY input. No .kiriv serialization or converter involved.
 * Runtime uses the already-supported 128-word float 4D/SH texture interface.
 * The historical precisionVariant name `kiriv_f32` identifies that memory
 * interface, not the source file format. Its shader/worker remain unchanged.
 */
const fail = message => { throw new Error(`FTGS PLY: ${message}`); };
const temporalFields = ['time', 'log_duration', 'velocity_0', 'velocity_1', 'velocity_2'];
const commentKeys = ['ftgs_version', 'time_units', 'sh_degree', 'use_velocity', 'min_duration', 'opacity_floor', 'n_frames'];

function pathname(url) {
  if (typeof url !== 'string') return '';
  try { return decodeURIComponent(new URL(url, 'https://holo.invalid/').pathname); }
  catch { fail('invalid source URL'); }
}

export const isPlyUrl = url => /\.ply$/i.test(pathname(url));
export const isFtgsPlyUrl = url => pathname(url).endsWith('.ftgs.ply');

/** Content wins over the requested render type, after PLY parsing. */
export function plyRenderType(textureData) {
  return textureData.representation === 'freetimegs' ? '4dgs' : '3dgs';
}

function headerLines(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const lines = [];
  let begin = 0;
  for (let end = 0; end < Math.min(bytes.length, 16777216); end++) {
    if (bytes[end] !== 10) continue;
    const line = decoder.decode(bytes.subarray(begin, end)).replace(/\r$/, '');
    lines.push(line); begin = end + 1;
    if (line === 'end_header') return { lines, headerBytes: begin };
  }
  fail('missing end_header newline or header exceeds 16 MiB');
}

function uintComment(comments, name, optional = false) {
  const text = comments[name];
  if (optional && text === undefined) return null;
  if (typeof text !== 'string' || !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) fail(`invalid/missing comment ${name}`);
  return Number(text);
}

/** Return null for ordinary static PLY; partial/inconsistent FTGS never falls back. */
export function parseFtgsPly(input, url) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { lines, headerBytes } = headerLines(bytes);
  const fields = [], elements = [], rawComments = [], comments = Object.create(null), duplicateComments = [];
  let inVertex = false, format = null;
  for (const line of lines) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'comment') {
      rawComments.push(line.slice(line.indexOf('comment') + 7).trim());
      if (commentKeys.includes(words[1])) {
        if (Object.hasOwn(comments, words[1])) duplicateComments.push(words[1]);
        comments[words[1]] = words.slice(2).join(' ');
      }
    } else if (words[0] === 'format') {
      if (format !== null) format = 'duplicate'; else format = words.slice(1).join(' ');
    } else if (words[0] === 'element') {
      elements.push({ name: words[1], count: words[2] });
      inVertex = words[1] === 'vertex';
    } else if (words[0] === 'property' && inVertex) {
      fields.push({ name: words.at(-1), type: words[1], declaration: words });
    }
  }
  const names = fields.map(f => f.name);
  const hasTemporalField = names.some(n => temporalFields.includes(n) || n.startsWith('velocity_'));
  const hasFtgsDeclaration = ['ftgs_version', 'time_units', 'use_velocity', 'min_duration'].some(key => comments[key] !== undefined);
  if (!hasTemporalField && !hasFtgsDeclaration) return null;
  const missing = temporalFields.filter(n => !names.includes(n));
  if (missing.length) fail(`incomplete temporal fields; missing ${missing.join(', ')}`);
  if (!isFtgsPlyUrl(url)) fail('FTGS content requires source pathname ending exactly .ftgs.ply');
  if (lines[0] !== 'ply' || format !== 'binary_little_endian 1.0') fail('expected binary_little_endian PLY 1.0');
  if (duplicateComments.length) fail(`duplicate comment ${duplicateComments.join(', ')}`);
  if (new Set(names).size !== names.length) fail('duplicate vertex property');
  if (elements.length !== 1 || elements[0].name !== 'vertex' || !/^\d+$/.test(elements[0].count)) fail('expected one vertex element');
  const count = Number(elements[0].count);
  if (!Number.isSafeInteger(count)) fail('invalid vertex count');
  if (fields.some(f => !['float', 'float32'].includes(f.type) || f.declaration.length !== 3)) fail('all FTGS vertex properties must be scalar float32');
  if (uintComment(comments, 'ftgs_version') !== 1) fail('unsupported ftgs_version');
  if (comments.time_units !== 'normalized') fail('unsupported time_units (expected normalized)');
  const degree = uintComment(comments, 'sh_degree');
  if (degree > 3) fail('unsupported sh_degree (supported 0..3)');
  const useVelocity = uintComment(comments, 'use_velocity');
  if (useVelocity !== 0 && useVelocity !== 1) fail('use_velocity must be 0 or 1');
  const minDuration = Number(comments.min_duration), floor = Number(comments.opacity_floor);
  if (!comments.min_duration || !Number.isFinite(minDuration) || minDuration <= 0) fail('invalid/missing min_duration');
  if (!comments.opacity_floor || !Number.isFinite(floor) || floor < 0 || floor > 1) fail('invalid/missing opacity_floor');
  const nFrames = uintComment(comments, 'n_frames', true);
  if (nFrames !== null && nFrames < 1) fail('n_frames must be positive');
  const bases = (degree + 1) ** 2, restCount = 3 * (bases - 1);
  const expectedRest = Array.from({ length: restCount }, (_, i) => `f_rest_${i}`);
  const actualRest = names.filter(n => n.startsWith('f_rest_'));
  if (actualRest.length !== restCount || expectedRest.some(n => !names.includes(n))) fail(`sh_degree=${degree} requires exactly f_rest_0..${restCount-1} (${restCount} fields)`);
  const required = ['x','y','z','opacity', ...temporalFields,
    ...Array.from({ length: 3 }, (_, i) => `scale_${i}`),
    ...Array.from({ length: 4 }, (_, i) => `rot_${i}`),
    ...Array.from({ length: 3 }, (_, i) => `f_dc_${i}`), ...expectedRest];
  const missingBase = required.filter(n => !names.includes(n));
  if (missingBase.length) fail(`missing Gaussian fields ${missingBase.join(', ')}`);
  const normals = ['nx','ny','nz'].filter(n => names.includes(n));
  if (normals.length !== 0 && normals.length !== 3) fail('incomplete normal placeholders');
  const known = new Set([...required, 'nx','ny','nz']);
  if (names.some(n => !known.has(n))) fail(`unknown vertex properties ${names.filter(n => !known.has(n)).join(', ')}`);
  const stride = fields.length * 4, payloadBytes = count * stride;
  if (!Number.isSafeInteger(payloadBytes) || bytes.length - headerBytes !== payloadBytes) fail('truncated/trailing payload or vertex count/stride mismatch');

  const width = 4096, height = Math.max(1, Math.ceil(count * 32 / width));
  if (width * height * 16 > 1073741824) fail('runtime texture exceeds 1 GiB limit');
  const runtime = new Float32Array(width * height * 4);
  const offsets = Object.fromEntries(fields.map((f, i) => [f.name, i * 4]));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Export clamps the log-domain parameter then stores float32; compare in
  // that same domain/precision, rather than adding an arbitrary epsilon.
  const minLogDuration = Math.fround(Math.log(minDuration));
  for (let row = 0; row < count; row++) {
    const start = headerBytes + row * stride, base = row * 128;
    const read = name => dv.getFloat32(start + offsets[name], true);
    for (const field of fields) if (!Number.isFinite(read(field.name))) fail(`nonfinite ${field.name} at vertex ${row}`);
    runtime.set([read('x'),read('y'),read('z')], base);
    const q = [0,1,2,3].map(i => read(`rot_${i}`));
    if (Math.hypot(...q) === 0) fail(`zero quaternion at vertex ${row}`);
    runtime.set(q, base + 3);
    for (let i = 0; i < 3; i++) runtime[base + 7 + i] = Math.exp(read(`scale_${i}`));
    const logit = read('opacity');
    runtime[base + 10] = logit >= 0 ? 1/(1+Math.exp(-logit)) : Math.exp(logit)/(1+Math.exp(logit));
    runtime[base + 11] = read('time');
    const logDuration = read('log_duration');
    if (logDuration < minLogDuration) fail(`log_duration below declared min_duration at vertex ${row}`);
    // log_duration = log(sigma_t), not log(window length). Existing 4D shader
    // uses exp(-(dt/s)^2), so common width s=sqrt(2)*sigma_t is exact in math.
    runtime[base + 12] = Math.SQRT2 * Math.exp(logDuration);
    for (let i = 0; i < 3; i++) runtime[base + 13 + i] = useVelocity ? read(`velocity_${i}`) : 0;
    // FTGS f_dc is standard SH DC (RGB=0.5+0.28209479177387814*f_dc),
    // unlike STG's same-named decoder features. Preserve coefficients here;
    // the existing 4D SH shader evaluates DC AND f_rest per view, without baking.
    for (let ch = 0; ch < 3; ch++) {
      runtime[base + 26 + ch * bases] = read(`f_dc_${ch}`);
      for (let j = 1; j < bases; j++) runtime[base + 26 + ch * bases + j] = read(`f_rest_${ch * (bases-1) + j-1}`);
    }
    for (let i = 7; i < 10; i++) if (!(runtime[base+i] > 0) || !Number.isFinite(runtime[base+i])) fail(`invalid activated scale at vertex ${row}`);
    if (!(runtime[base+12] > 0) || !Number.isFinite(runtime[base+12])) fail(`invalid activated temporal sigma at vertex ${row}`);
  }
  return {
    data: new Uint32Array(runtime.buffer), buffer: runtime, width, height,
    gaussianCount: count, gaussStridePixels: 32, precisionVariant: 'kiriv_f32',
    representation: 'freetimegs', sourceFormat: 'ftgs.ply', renderType: '4dgs',
    colorEncoding: 'sh', shDegree: degree, sphericalHarmonicsDegree: degree, opacityFloor: floor,
    ftgsMetadata: { ftgs_version: 1, time_units: 'normalized', sh_degree: degree,
      use_velocity: useVelocity === 1, min_duration: minDuration, opacity_floor: floor,
      n_frames: nFrames, comments: rawComments },
  };
}

/** CPU evaluation of the GPU-ready record (includes float32 upload rounding). */
export function evaluateFtgsRecord(texture, row, time) {
  if (texture.representation !== 'freetimegs' || !Number.isInteger(row) || row < 0 || row >= texture.gaussianCount || !Number.isFinite(time)) fail('invalid evaluation input');
  const a = texture.buffer, b = row * 128, dt = time - a[b+11];
  const weight = Math.exp(-((dt/a[b+12])**2));
  return { position: [0,1,2].map(k => a[b+k] + a[b+13+k]*dt),
    opacity: Math.max(a[b+10]*weight, texture.opacityFloor) };
}
