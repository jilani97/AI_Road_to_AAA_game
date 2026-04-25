# image-to-3d

Local tool that turns a 2-D image into a 3-D GLB, straight into the game's
`public/models/generated/` folder where Babylon can `ImportMeshAsync` it.

Pipelines (selectable in the UI and CLI):

- **TripoSR** (MIT) — fast path, ~2 GB VRAM, ~15 s per image. Lower quality
  on busy / multi-subject inputs.
- **InstantMesh** (Apache 2.0) — middle path, ~6–8 GB VRAM peak, ~30–60 s
  per image. Multi-view fusion via Zero123++ + an LRM transformer.
- **Trellis** (MIT) — quality path, ~8–12 GB VRAM, ~60 s per image.
  **Phase 4, not yet implemented.**

Fully offline after the first weight download.

Planning docs live in `tasks/image-to-3d-plan.md` and
`tasks/image-to-3d-todo.md`. Full setup + troubleshooting are added in
Task 5.1; until then this is a stub.

## InstantMesh setup

Quickstart (assumes the base venv from Phase 0 is already set up):

```
.venv/Scripts/pip install -r requirements-instantmesh.txt
.venv/Scripts/python install_instantmesh.py
.venv/Scripts/python convert.py --probe-instantmesh
.venv/Scripts/python convert.py --prefetch-weights instantmesh   # ~6.5 GB, one-off
.venv/Scripts/python convert.py inputs/foo.png --pipeline instantmesh
```

**Vendored upstream:** `external/InstantMesh/`, pinned to commit
[`08822c52`](https://github.com/TencentARC/InstantMesh/commit/08822c52fdc399b93ea00e4fa9e596344ed52ccc)
by `install_instantmesh.py`. Re-run the install script to update.

**Weights** (~6.5 GB total, downloaded into `~/.cache/huggingface/hub/`):

- `TencentARC/InstantMesh` — UNet checkpoint + LRM model (`instant_mesh_large.ckpt`).
- `sudo-ai/zero123plus-v1.2` — base diffusion model.

**Timing on the target RTX 2000 Ada (8 GB):**

- First call: 30–60 s of inference + the one-off ~6.5 GB download (or pay
  it upfront with `--prefetch-weights instantmesh`).
- Subsequent calls in the same Python process: 30–60 s (model cache hit).
- Subsequent calls in fresh processes: 30–60 s + ~10 s weight load from disk.

**VRAM strategy:** the diffusion pipeline runs at fp16 and is moved off
GPU between stage 1 (multi-view) and stage 2 (LRM reconstruction), so
peak VRAM is the larger of the two stages, not the sum.

**Vertex colors vs textured (UV-mapped):** the pipeline always exports
vertex-colored meshes. The textured/UV-mapped path in InstantMesh's
upstream goes through `nvdiffrast`, which on Windows usually means
building a CUDA + MSVC native extension. Vertex colors are good enough
for the in-game prop scale we render at, and they ship as plain GLB
attributes — no separate texture file. UV-mapped output is tracked as a
future spec (`tasks/future-specs/image-to-3d-instantmesh-textured.md`).

**Why InstantMesh over TripoSR for complex inputs:** TripoSR is a
single-pass model that struggles with multi-subject or busy reference
images (the failure mode that motivated this phase). InstantMesh
synthesizes 6 consistent novel views first, then fuses them — much more
robust on out-of-distribution inputs.

**Probe failed?** `python convert.py --probe-instantmesh` reports each
missing piece. The two common cases:

- *`external/InstantMesh MISSING`* → run `python install_instantmesh.py`.
- *`diffusers MISSING`* (or any other pip dep) → run
  `pip install -r requirements-instantmesh.txt` inside the venv.
