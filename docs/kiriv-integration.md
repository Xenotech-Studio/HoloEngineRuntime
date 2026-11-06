# Loading KiriV

The [version 2 format contract](kiriv-format.md) freezes KRV2/0x3256524B.
`useSplatLoader().loadSplatFile(url)` accepts either .splatv or .kiriv, including
proxy URLs without extensions. `loadAndSetupSplatObject` and HoloEngineRuntime
propagate representation, color, runtime stride and effective count automatically.
No GPU-specific converter, model decoder or per-Gaussian tag is required.

The file's representation selects polynomial STG or linear FTGS. Native FTGS
evaluates complete degree 0..3 SH; compact profiles explicitly bake DC RGB.
Standard/high also lose high-order SH. Raw STG full decoder PLY is rejected;
use a previously baked .splatv rather than pretending its features are SH.

Standalone CPU parsing is exported as `parseKiriV` from the package and
`holoengineruntime/utils/kiriv`. The returned `kirivHeader` preserves coordinate,
time, camera, source and loss metadata. Do not apply the legacy packed RGB filter
to float/SH records: the hook explicitly rejects that unsupported combination.

From the Kiri4DGS checkout (Python NumPy/plyfile + Node required):

```sh
python Utils/STG_to_SplaTV/convert_to_kiriv.py --input model.ftgs.ply --out model.kiriv --layout native
python Utils/STG_to_SplaTV/convert_to_kiriv.py --input iteration_5.splatv --out preview.kiriv --layout standard
```

The writer refuses overwrites, checks activated values and encoded values, then
calls the independent JS reader before atomically creating the output file.
Both existing .splatv converters retain their behavior. STG PLY input supports
only explicit three-component RGB, with no f_rest/f_t/decoder features.

Optional `--metadata metadata.json`:

```json
{
  "coordinates": {"space":"training","axis_convention":"unspecified","world_from_file":null},
  "time": {"units":"normalized","range":[0,1],"fps":null,"n_frames":10}
}
```

Supply known values only. PLY has no world restoration matrix or cameras; the
converter invents neither. `--cameras cameras.json` embeds file-space cameras.
World transforms are carried for scene integration and never automatically guessed.
Host playback remains normalized [0,1]; the reader maps the declared file time
range into that clock for shader and worker together.

ColmapUtil entry: `/colmaputil/index.html?embed=splatv&src=<URL-encoded .kiriv URL>`.
The STG_to_SplaTV viewer iframe uses the same entry and accepts a `.kiriv`
`history_url`. In HoloLab the `kiriv` output tag can reuse the `splatv` viewer kind;
its header probe must recognize both prefix layouts. Runtime changes alone do
not upgrade an older application's own header probe. The isolated integration
commit must also bump vendor/ColmapUtil -> src/HoloEngineRuntime recursively.

CPU checks (no WebGL context or CUDA):

```sh
KIRIV_LEGACY_FIXTURE=/absolute/path/iteration_5.splatv node --test tests/kiriv.test.mjs
node tests/validate-kiriv.mjs /absolute/path/model.kiriv
```

The runtime currently expands v2 to 512 bytes/Gaussian plus row padding; all
layouts share this GPU representation. Input or decoded textures exceeding the
implementation's 1 GiB limit fail explicitly. GPU records are uploaded as a
2D texture array with each layer bounded by the device's MAX_TEXTURE_SIZE.
The runtime also splits records into separate texture objects, initially capped
at 512 MiB each. ANGLE's `Caps.h` documents a 1280 MiB per-texture cap (formerly
1024 MiB); legal width/height/layers alone do not guarantee a legal allocation.
An INVALID_OPERATION during allocation deletes the partial plan and halves the
budget, up to four attempts. Successful budgets are cached per WebGL context.
OUT_OF_MEMORY and context loss fail explicitly. No records or precision are reduced.

Each attribute set supports at most eight texture objects, additionally bounded
by vertex/fragment/combined sampler limits with two units reserved. PLY and SH
share that unit budget. A 25,430,016-point lite model uses four textures at 512 MiB
(three full 4096x8192x1 slabs and one 4096x258x1 slab), or seven at 256 MiB
(six 4096x4096x1 slabs and one 4096x258x1 slab), on either 8192 or 16384 hardware.
If a driver requires 128 MiB, that model needs 13 samplers and fails explicitly
rather than dropping points. Single-object textures retain the one-sampler shader;
multi-object shaders are compiled lazily with literal sampler-selection branches.
The pre-existing ordinary PLY SH evaluation remains a stub; this change preserves
its rendering behavior while making SH storage and fetch addressing slab-aware.

Full payload and sort-worker memory costs still apply, and a simultaneous thumbnail
preview uses a separate context and model allocation. Texture splitting addresses
per-object allocation caps, not exhaustion of total system/GPU memory.
No active-set optimization, compressed transport or chunk streaming is claimed.
CPU formula/SH validation and offline GLSL compilation are not pixel validation;
visual acceptance needs an available WebGL2 device and matching reference cameras.
