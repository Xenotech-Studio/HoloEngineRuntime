# Exact depth sorting with SIMD

`depth-sort.wasm` is a checked-in binary, not a build-time dependency. Generate
it from the repository root of HoloEngineRuntime with Python 3 and WABT 1.0.39:

```sh
npm install --prefix /tmp/holo-wasm-tools --no-package-lock --ignore-scripts wabt@1.0.39
python3 tools/generate-depth-simd.py > /tmp/depth-sort.wat
/tmp/holo-wasm-tools/node_modules/.bin/wat2wasm /tmp/depth-sort.wat -o src/utils/depth-sort.wasm
node --test tests/*.test.mjs
```

The worker fetches the asset asynchronously and uses its original JS loop until
ready. A tiny f64x2 probe is validated before instantiation. Unsupported SIMD,
fetch/CSP/compile failures, and memory growth failures leave sorting on JS.
The asset URL is resolved by the bundler, including its configured base path.

Two independent gaussians occupy the two f64 lanes. Float32 decoded inputs are
widened exactly once into an AoSoA mirror. Every multiply/add/subtract has the
same binary64 rounding and parentheses as JS; there is no reassociation, f32
arithmetic, relaxed SIMD or FMA. NaN payload identity is not required: the JS
`|0` conversion maps all NaNs and infinities to zero, and retains modulo-2^32
wrapping for finite overflow. Both depth conversion and bucket conversion/clamp
remain in JS. Min/max, histogram, prefix sums and stable index scatter are
unchanged. Consequently the integer depths, buckets, and full original-buffer
indices agree, including ties and the maximum-depth clamp from 65536 to 65535.

With motion enabled, per gaussian there are 27 scalar floating arithmetic
operations for motion/projection and 2 for bucket quantization. These become
29 two-lane operations per pair (about 8.352 million scalar operations versus
4.176 million vector instructions for 288,000 gaussians). This is an arithmetic
instruction estimate, NOT a timing/speedup claim: conversions, histogram and
scatter remain scalar; SIMD adds memory passes and an approximately 112-byte
per-gaussian mirror/output allocation (~32.3 MB for 288,000). Static sorting has
only 6+2 arithmetic operations per gaussian and may benefit less or regress.
The mirror is repacked only on model replacement. Odd counts use a padding lane
that is never read by the sorter. The integration tests assert a real SIMD
backend is active rather than silently accepting fallback.

No GPU tests or benchmarks were run. Browser asset loading/CSP, mobile f64 SIMD
lowering, memory pressure, sustained frame rate and thermals require device
validation; Node equivalence tests do not establish a performance benefit.
