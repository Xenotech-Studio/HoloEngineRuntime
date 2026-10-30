# Native FreeTimeGS PLY input

`loadPlyFile(url)` / `usePlyLoader()` and HoloEngineRuntime load native
**`.ftgs.ply`** directly. No intermediate file or conversion command is required.
The URL pathname must end exactly in `.ftgs.ply` (case sensitive); signed query
parameters/fragments are allowed. Blob/proxy URLs that lose that filename do not
satisfy this input contract. Renaming FTGS data to ordinary `.ply` is rejected.

Representation is determined by content: `time`, `log_duration`, and all three
`velocity_*` properties identify FTGS. Partial sets are errors, including when
`use_velocity=0`. Ordinary PLY with no temporal fields/declaration continues
through the unchanged static decoder. A `.ftgs.ply` name alone never turns static
data into a temporal model. An FTGS declaration without its fields is an error.

Required FTGS comments: `ftgs_version 1`, `time_units normalized`, `sh_degree`
(0..3), `use_velocity` (0/1), positive `min_duration`, `opacity_floor` ([0,1]).
`n_frames` is optional and, if supplied, must be a positive integer. Duplicate or
unsupported declarations fail. The declared degree must match exactly
`3*((degree+1)^2-1)` contiguous `f_rest_*` values. No guessing degree or dropping
unknown attributes. Supported native input is scalar float32, binary little
endian PLY 1.0, one vertex element, exact payload size. All Gaussian fields must
be present and finite, with nonzero quaternion and positive activated scales.
Normals may be absent or have all three standard placeholder properties.

Source equations (FreeTimeGsVanilla):

```
dt = t - time
sigma = exp(log_duration)
mean(t) = mean + (use_velocity ? velocity*dt : 0)
opacity(t) = max(sigmoid(opacity_logit)*exp(-0.5*(dt/sigma)^2), opacity_floor)
scale = exp(log_scale)
rotation = static wxyz quaternion
```

`log_duration` is log temporal sigma, not log full window length. Frame time is
`frame/max(n_frames-1,1)`, not seconds. Learned centers may lie outside [0,1].
PLY contains training-space geometry, not a world restoration matrix or cameras.

FTGS f_dc is standard SH DC: RGB=0.5+0.28209479177387814*f_dc. It is **not**
STG's same-named RGB/decoder feature. The existing SH-capable 4D shader evaluates
both DC and f_rest by view; source coefficients are kept channel-major, all
float32, without RGB baking or half/uint8 quantization. Static PLY's existing SH
implementation is unchanged by this input addition.

HoloEngineRuntime keeps its existing extension inference, then selects the
actual render type after PLY parsing. FTGS is 4D even if the caller specified
`3dgs`; static PLY remains 3D. Explicit `4dgs` now accepts PLY input as well as
the existing .splatv/.kiriv inputs. For example:

```jsx
scene.addObject('ftgs', '/assets/model.ftgs.ply',
  [0, 0, 0], [0, 0, 0], [1, 1, 1], null, 'FreeTimeGS', '4dgs');
<HoloEngineRuntime sceneManager={scene} fourDGaussianTime={0.5} />
```

Use the existing `fourDGaussianTime` or `fourDGaussianTimeRef` in [0,1] to scrub
or play. The existing time value reaches shader and depth worker together.
`textureData.ftgsMetadata` and the scene/render object retain the typed comments.
The hook's vertexCount uses effective gaussianCount, excluding texture padding.
Custom low-level clients must choose `loadAndSetupSplatObject` for FTGS output
and `loadAndSetup3DGSObject` for static output, as the component does.

The direct decoder writes the existing 128-word float runtime record. Its
historical internal precision label is `kiriv_f32`, but `sourceFormat` is
`ftgs.ply`: no KiriV reader/writer/container is invoked. Existing shader, sorting
worker, .splatv/.kiriv loaders and converters are unchanged. The runtime width
is 4096 texels, 32 texels/Gaussian; storage is ~512 bytes/Gaussian. CPU allocation
above 1 GiB and hardware texture limits fail explicitly rather than truncating.

Validation (CPU only; run from this repository, with React/build dependencies
available from the parent ColmapUtil checkout):

```sh
node --test tests/ftgs-ply.test.mjs
python tests/ftgs-ply-cpu.py --input /absolute/model.ftgs.ply --out /tmp/new-ftgs-cpu-results
```

The second command requires NumPy/plyfile/Node and a fresh output directory.
It compares every Gaussian at t=0/.5/1 against the source equations, verifies
all SH coefficients, and reports float32 upload rounding separately from source
parameter preservation. It does not create a GPU context. Visual acceptance
still requires an available WebGL2 device and matching reference cameras.
