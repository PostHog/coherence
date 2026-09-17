# Local embeddings on Apple Silicon — survey summary (2026-09-17)

Measured on this machine (M4 Pro, macOS 26, Node 22) by a research agent; the
full report with sources and per-model tables is in the session task output and
should be moved here in full when usage allows.

**Pick: node-llama-cpp 3.21.1, in-process.** 68 MB of node_modules (one Metal
prebuilt fetched as an optional dependency), 0.5–4 ms per short-string
embedding, bitwise-identical output run to run and process to process, about
250–350 ms from process start to first embedding. MIT. Monthly releases.

**Do not force `gpu: false`** on Apple Silicon: it triggers a 36 s source build
and grows node_modules to 428 MB. Keep the Metal prebuilt with
`build: "never"` and pass `gpuLayers: 0` at model load; output is bitwise
identical to the CPU build and faster than Metal for short strings.

**MLX loses for this use:** a Python sidecar is slower per short string
(1.7–2.8 ms), 751 MB venv, 1–3.5 s import, ~1 s first-call JIT, and
mlx-embeddings is GPL-3. A Swift sidecar needs the full Xcode toolchain or a
40–80 MB shipped binary. MLX only wins on batched throughput, which we do not need.

**ONNX via transformers.js** ties on latency but costs 480 MB of install.

**Model:** bge-small-en-v1.5 Q8_0 (37 MB, MIT, CLS pooling, no prefixes) for
near-synonym detection over short terms; nomic-embed-text-v1.5 Q8_0 (146 MB,
768-d, needs `clustering:` prefixes) if overload clustering wants more room.
Pooling comes from the GGUF metadata; node-llama-cpp exposes no override.

**Determinism rules:** pick one backend and never mix (Metal and CPU vectors
differ by up to 0.12); fix batchSize and threads; serialize calls; pin the exact
package version; normalize vectors yourself; store model path and GGUF SHA
beside any cached vectors. Seed is irrelevant (no sampling).
