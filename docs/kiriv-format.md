# KiriV version 2 (.kiriv)

Status: implemented contract, 2026-10-30. All integers and floating point payloads
are little endian. Magic **0x3256524B**, bytes **4B 52 56 32** (`KRV2`), is frozen.
This document defines storage, not pixel equivalence with a training rasterizer.

## Container

| Byte offset | Size | Meaning |
| --- | --- | --- |
| 0 | 4 | uint32 magic 0x3256524B |
| 4 | 2 | uint16 version, exactly 2 |
| 6 | 2 | uint16 flags, exactly 0 |
| 8 | 4 | uint32 UTF-8 JSON byte length L, 1..16777216 |
| 12 | L | strict UTF-8 JSON object, no BOM |
| 12+L | P | zero padding, P=(-(12+L)) mod 16 |
| 12+L+P | size | one record-array payload |

No trailing bytes, compression, external buffers or implicit texture padding.
V2 supports exactly one homogeneous chunk. Multiple objects use multiple files;
future heterogeneous chunks require a new container version, not an ignored tag.
`representations` is a **single string**, despite the plural key: `stg` or
`freetimegs`. V2 has no default. No per-Gaussian representation tag is needed.

Required JSON keys: `representations`, `payload_layout`, `gaussian_count`
(integer >=0), `record_bytes`, `size` (=count*record_bytes), `color_encoding`,
`sh_degree`, `time`, `coordinates`, `render_profile`, `losses` (string array).
Optional `cameras` (array), `source` (provenance object), `quantization`.
Unknown metadata keys may be retained/ignored; unknown semantic enum values,
version, flags or layout MUST fail. JSON duplicate keys are forbidden to writers.
Readers validate known values before allocation/upload. Extension metadata cannot
override field semantics. New layouts extend the table and reader dispatch below;
they do not reuse a known tag with different offsets.

## Representation, color and rendering

Let dt=t-center. `stg`: p=p0+m1*dt+m2*dt²+m3*dt³,
q=normalize(q0+omega*dt), w=exp(-(dt/s)²).
`freetimegs`: p=p0+v*dt, q=normalize(q0),
w=exp(-0.5*(dt/sigma)²), alpha=max(sigmoid(logit)*w, opacity_floor).
FTGS records MUST have motion[3:9]=0 and omega[0:4]=0.
Native FTGS stores log(sigma); compact layouts store common width s=sqrt(2)*sigma.
Thus geometry/time can share STG's polynomial with zero higher coefficients.
This mapping **does not cover color**.

STG lite PLY `f_dc_0..2` is already RGB in the old exporter, quantized as
clamp(round(f_dc[:3]*255),0,255). STG full's six f_dc and three f_t are
decoder features, **not standard SH**. FTGS `f_dc` is SH DC:
RGB=0.5+**0.28209479177387814** * f_dc. Same names, different meanings:
cross-representation color requires explicit conversion or rejection. Never copy
STG decoder features into SH slots. Full STG PLY without an explicit baked RGB
export is rejected; an existing baked .splatv can be imported, recording prior loss.

`color_encoding=rgb`, degree=0: three linear RGB values. Compact layouts always
use RGB uint8; negative/HDR values are clipped and loss is declared.
`color_encoding=sh`, degree=0..3: native only, FTGS only; 3*(degree+1)² float32
coefficients, **channel-major**: all R bases, all G bases, all B bases. Within each
channel ordering is real SH l=0..degree, m=-l..l (3DGS/gsplat convention).
PLY channel-major f_rest is interleaved with its channel's DC when writing native.
SH evaluates in file space with direction normalize(evolved_mean-camera_origin),
RGB=max(0,0.5+sum(SH*basis)); no upper clamp for native. Zero view direction uses
+Z. Quaternion order is always **wxyz**, not the misleading old hp comment xyzw.

`render_profile=stg_legacy` is required for STG: temporal threshold .02,
depthEff, gaussian-scale interpolation and screen kernel retain legacy behavior.
`render_profile=ftgs` is required for FTGS: required `opacity_floor` in [0,1],
no .02 temporal cull, static rotation, linear motion, SH or explicit DC RGB;
alpha floor is applied **after** temporal multiplication, before screen kernel.
This viewer shares the existing screen covariance/kernel/blend and optional
depth-write pass: it does not promise training-rasterizer pixel equivalence.

## Layout registry (offsets are bytes within a record)

| Tag | Bytes | Fields |
| --- | --- | --- |
| preview | 56 | uint16 affine quantization for 25 scalars, RGB/A uint8, 2 zero bytes |
| standard | 64 | existing lite texture record, DC RGB only |
| high | 128 | existing hp_scale_rot record, DC RGB only |
| native | 104+12*(degree+1)² for SH; 116 for RGB | all float32, full SH or RGB |

All fields below are mandatory; reserved bytes MUST be zero in v2.
Neither standard nor high preserves high-order SH. A higher layout cannot recover
information already absent from an input .splatv; provenance/losses must say so.

### standard (64), high (128)

| Offset | Encoding | Meaning |
| --- | --- | --- |
| 0..11 | 3 float32 | xyz |
| 12..19 | 4 binary16 | rotation wxyz |
| 20..25 | 3 binary16 | activated scale=exp(log_scale) |
| 26..27 | 0 | pad |
| 28..30 | 3 uint8 UNORM | RGB, decode /255 |
| 31 | uint8 UNORM | activated sigmoid(opacity), decode /255 |
| 32..49 | 9 binary16 | motion, linear xyz then quadratic xyz then cubic xyz |
| 50..51 | 0 | pad |
| 52..59 | 4 binary16 | omega wxyz |
| 60..61 | binary16 | time center |
| 62..63 | binary16 | positive common width s |
| high:64..79 | 4 float32 | authoritative rotation wxyz |
| high:80..91 | 3 float32 | authoritative activated scale |
| high:92..127 | 0 | reserved |

Half2 first value occupies low 16 bits, matching GLSL unpackHalf2x16. There is
**no file-level scale/offset** in legacy lite/high. Existing converters use a custom
`float_to_half` bit truncation algorithm (including its subnormal behavior), not
IEEE round-to-nearest-even. V2 compact writers retain that algorithm; readers decode
IEEE binary16. Reject nonfinite decoded values or nonpositive scale/width rather
than overflow/underflow silently. High's first 64 bytes retain the legacy fallback;
its float32 extension is authoritative. RGBA round is ties-to-even then clamp;
opacity uses sigmoid before quantization. xyz remains float32.

### preview (56)

| Offset | Encoding | Meaning / quantization vector indices |
| --- | --- | --- |
| 0..5 | 3 uint16 | xyz, 0..2 |
| 6..13 | 4 uint16 | quaternion wxyz, 3..6 |
| 14..19 | 3 uint16 | activated scale, 7..9 |
| 20..21 | uint16 | center, 10 |
| 22..23 | uint16 | common width s, 11 |
| 24..41 | 9 uint16 | motion, 12..20 |
| 42..49 | 4 uint16 | omega, 21..24 |
| 50..52 | 3 uint8 UNORM | RGB |
| 53 | uint8 UNORM | opacity |
| 54..55 | 0 | reserved |

Required `quantization={offset:[25 numbers],scale:[25 nonnegative numbers]}`.
Per component offset=min(source), scale=(max-min)/65535 (zero for constants).
For empty input both arrays are zero. Encode clamp(round((x-offset)/scale),0,65535)
with ties-to-even; constant encodes 0. Decode offset+scale*q, cast float32.
Parameters MUST be stored, finite; never inferred from renderer or hardcoded scene
bounds. Reject quantization that yields zero quaternion or nonpositive scale/width.

### native

| Offset | Encoding | Meaning |
| --- | --- | --- |
| 0..11 | 3 float32 | xyz |
| 12..27 | 4 float32 | quaternion wxyz |
| 28..39 | 3 float32 | log_scale (not activated) |
| 40..43 | float32 | opacity logit (not activated) |
| 44..47 | float32 | center (FTGS time) |
| 48..51 | float32 | STG log(s), FTGS log_duration=log(sigma) |
| 52..87 | 9 float32 | motion (FTGS velocity then six zeros) |
| 88..103 | 4 float32 | omega (FTGS four zeros) |
| 104..end | float32 array | RGB3 or full channel-major SH |

No texture padding in file. Runtime decodes all v2 layouts into an internal
32-texel RGBA32UI float-bit record (128 words; not a file contract). Runtime slots
0..25 have native field ordering but activated scale/opacity/common width; SH/RGB
start at 26. This enables float motion sorting and full SH without losing native
precision to the old half layout. GPU storage can exceed file size substantially.

## Coordinates, cameras and time

`coordinates={space:"training",axis_convention:"unspecified",world_from_file:null}`
is the honest default: PLY exports training-space geometry, not known metric world
coordinates. `space` may be `training` or `world`; `axis_convention` is a descriptive
string. Optional `world_from_file` is a finite, invertible affine row-major 4x4
matrix (last row 0,0,0,1), mapping file positions to world. It is carried as metadata;
runtime renders file space and does **not** guess/apply this matrix automatically.
An integrating scene can apply it to object and cameras together; velocity uses
its linear part, covariance A*Sigma*A^T. Unknown is null, never guessed identity.

Optional cameras are in **file space**, schema inherited from cameras.json:
id, img_name, positive width/height, position[3], rotation[3][3] camera-to-file,
positive fx/fy; optional cx/cy (default image center). They accompany the file,
but host controls whether to initialize from them. No synthetic camera is invented.
Converter `--metadata metadata.json` supplies `coordinates`, `time`, `cameras`;
`--cameras cameras.json` supplies cameras separately (conflicts rejected).

`time={units:"normalized"|"seconds"|"frames"|"unspecified",range:[a,b],fps:null|positive,
n_frames:null|positive_integer}`; finite a<b. Center may lie outside range.
FTGS defaults units=normalized, range=[0,1], n_frames from PLY, fps=null; an STG
input without evidence defaults units=unspecified, range=[0,1]. No claim that this
is seconds or actual frame rate. Units/axis conventions from user metadata are
declarations, not inference from PLY. `range` defines viewer playback mapping:
t_file=a+(b-a)*t_viewer, t_viewer in [0,1]. Reader transforms center, width and
motion coefficients to that clock before shader/worker use. fps does not change
coefficients or establish a duration unless supplied with units/frame provenance.
The bundled converter rejects metadata contradicting a FTGS PLY's known
normalized [0,1] clock, training-space positions, or exported n_frames. It does
not relabel those fields as seconds/world without transforming the attributes.

## Legacy compatibility and validation

Legacy .splatv remains `[0x674B u32][L u32][JSON chunk array][payloads]`, no version
and no alignment. Old magic **alone** defaults missing representations to `stg`;
old missing precision_variant defaults lite, mapping lite->standard,
hp_scale_rot->high. Existing texture padding and inferred count remain legacy
behavior, including static 3DGS zero time width. A known legacy file's texture bytes,
count, shader arithmetic and motion sorting must remain unchanged.
Legacy files declaring non-STG, unknown layout/precision or incompatible stride
are rejected. Explicit legacy format_version must be 1; conflicting singular
and plural representation tags fail. The converter removes only an all-zero
suffix of legacy texture records (recording its count in losses); interior invalid
records are rejected, never skipped. New readers accept both magic values. Old reader's explicit
`magic!==0x674B` check rejects KRV2; renaming extensions cannot bypass it.

V2 checks version/flags/tags, metadata types, integer multiplication and exact
payload size, padding zeros, field count/record stride, SH degree/encoding,
finite attributes, nonzero quaternion, positive activated scale/width, opacity
range, FTGS zero coefficients, and required floor/profile before GPU use.
Headers exceeding 16 MiB, unsafe sizes, truncated prefix/JSON/payload, trailing
bytes, unknown tags and out-of-bounds records fail explicitly. No fallback to
STG/lite or DC on an unknown tag. Implementations may reject assets exceeding
their texture/memory limits with an explicit error; no partial model rendering.
Zero-count files are valid and render zero instances. Effective gaussian_count
must reach objects **and worker**; texture padding must never increase v2 count.
