# image-to-3d

Local tool that turns a 2-D image into a 3-D GLB, straight into the game's
`public/models/generated/` folder where Babylon can `ImportMeshAsync` it.

Pipelines (selectable in the UI and CLI):

- **TripoSR** (MIT) — fast path, ~2 GB VRAM, ~15 s per image. Lower quality
  on busy / multi-subject inputs.
- **InstantMesh** (Apache 2.0) — middle path, ~6–8 GB VRAM peak, ~30–60 s
  per image. Multi-view fusion via Zero123++ + an LRM transformer.
  Vertex-colored output.
- **Trellis** (MIT) — quality path, runs on WSL only on Windows, ~33 min
  per image (texture-bake at 2048² dominates). Structured-latent diffusion
  + Gaussian-splat → mesh, with UV-mapped textures and a Marigold-Normals
  post-bake for tangent-space normal maps.

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

## Trellis setup

**Why this is different from TripoSR / InstantMesh:** Trellis pulls in
four CUDA-built extensions (`nvdiffrast`, `diffoctreerast`,
`diff-gaussian-rasterization`, `vox2seq`) plus `xformers` and `kaolin`,
none of which ship a Windows wheel for our `torch 2.5.1+cu121` stack.
Building them from source on Windows wants MSVC 2022 + Windows 10 SDK +
CUDA Toolkit 12.1 on PATH, plus a small mountain of build patches.
Instead, we run Trellis inside WSL and shell out to it from the
Windows-side pipeline. Everything else (Gradio UI, sidecar metadata,
Babylon dev server) stays Windows-native.

`tools/image-to-3d/pipelines/trellis.py` is the Windows wrapper;
`tools/image-to-3d/wsl/trellis_runner.py` is what runs inside WSL.

### One-time WSL setup

Inside WSL (Ubuntu, Python 3.10+):

```
# venv that the Windows wrapper expects at ~/trellis-venv
python3 -m venv ~/trellis-venv
~/trellis-venv/bin/pip install --upgrade pip wheel

# CUDA-matched torch first, before anything else pulls in cpu wheels
~/trellis-venv/bin/pip install torch==2.5.1 torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cu121

# Project deps (run from /mnt/c/<repo>/tools/image-to-3d/)
~/trellis-venv/bin/pip install -r requirements-trellis.txt
~/trellis-venv/bin/python install_trellis.py

# CUDA-built extensions — these need MSVC-equivalent toolchain in WSL
# (g++ + CUDA Toolkit 12.1). Build order matters; nvdiffrast first.
~/trellis-venv/bin/pip install external/TRELLIS-extensions/nvdiffrast
~/trellis-venv/bin/pip install external/TRELLIS-extensions/diffoctreerast
~/trellis-venv/bin/pip install \
    external/TRELLIS-extensions/mip-splatting/submodules/diff-gaussian-rasterization
~/trellis-venv/bin/pip install external/TRELLIS/extensions/vox2seq

# xformers + spconv-cu121 are deliberately NOT in requirements-trellis.txt:
# the former resolves to a torch-2.10+cpu build that nukes our cu121 pin;
# the latter pip-installs cleanly but errors at import without CUDA Toolkit
# on PATH. Install both manually after the toolkit is in place:
~/trellis-venv/bin/pip install xformers --index-url https://download.pytorch.org/whl/cu121
~/trellis-venv/bin/pip install spconv-cu121
```

Sanity check from WSL:

```
~/trellis-venv/bin/python -c "import torch, trellis; print(torch.cuda.is_available())"
```

Should print `True`.

### Running it

From the Windows side, no different from any other pipeline:

```
.venv/Scripts/python convert.py inputs/foo.png --pipeline trellis
```

The Windows process subprocess-spawns
`wsl bash -c '~/trellis-venv/bin/python wsl/trellis_runner.py …'`,
parses progress events from its stdout, then loads the result GLB back
into the host process for sidecar metadata + the Marigold normal-bake.

Output filename follows the convention `<stem>-trellis-<ts>.glb` — the
pipeline tag in the filename lets the Babylon loader auto-detect Trellis's
glTF-canonical Y-up orientation (TripoSR / InstantMesh export Z-up; see
`src/game/GameApp.ts` `loadGeneratedModel`).

### Timing on RTX 2000 Ada (8 GB)

| Step                        | Cost (default settings) |
| --------------------------- | ----------------------- |
| Pipeline load (cold)        | ~32 s                   |
| Inference (12/12 steps)     | ~50 s                   |
| Texture bake at 2048²       | ~30 min (dominant)      |
| Marigold normal-bake (warm) | ~3 s                    |
| **Total**                   | **~33 min**             |

Marigold weights (~3.5 GB) download into `~/.cache/huggingface/hub/` on
the **Windows host's** HF cache (not WSL), since Marigold runs in the
host process. One-time, ~3.5 min on first run.

Trellis weights (`microsoft/TRELLIS-image-large`, ~6 GB) download into
WSL's HF cache on first run.

### Quality knobs

Defaults are baked into `pipelines/trellis.py` and are the operating
point we recommend (`simplify=0.95, texture_size=2048, ss/slat=12/12`).
Only change them in code if you have a reason:

- **`simplify`** — fraction of faces *removed*. Lower keeps more geometry
  but exposes Trellis's marching-cubes noise on flat surfaces. Upstream
  caps the slider at `0.9` for that reason; we go further at `0.95` to
  hide noise entirely on the test characters. Going below `0.9` is not
  recommended.
- **`texture_size`** — UV-atlas resolution. `1024` halves the bake time
  (~15 min instead of ~30) at the cost of visibly softer detail; `2048`
  is the sharpness sweet spot. Upstream caps at `2048`.
- **`ss_steps` / `slat_steps`** — diffusion sampling steps for sparse
  structure / structured latent. Default `12` matches upstream; bumping
  to `50/50` (the upstream max) costs ~1 extra minute of inference but
  makes no visible difference once the texture-bake step runs — the
  inference upgrade gets washed out by the bake.

### Probe failed?

`python convert.py --probe-trellis` runs **on Windows** and will report
the native extensions as missing because of the wheel walls described
above — that's expected. The probe is a sanity check that the vendored
upstream tree exists; the actual runtime check is in WSL:

```
wsl ~/trellis-venv/bin/python -c "import trellis; print('OK')"
```

If the WSL `import trellis` works, the Windows pipeline will work.

## Game handoff

Vite serves the project's `public/` directory at the web root, so any GLB
this tool writes to `public/models/generated/` is reachable at
`http://localhost:5173/models/generated/<filename>.glb` while
`npm run dev` is running.

The Babylon `GameApp` exposes a dev-only loader for smoke-testing a fresh
mesh in the live scene without rebuilding the app. With the dev server
running, paste either of these into the browser devtools console:

```js
// Drop the mesh at the world origin.
await window.game.loadGeneratedModel('cartoon_girl-instantmesh-20260426-143302-896.glb');

// Or place it explicitly, with a scale override.
await window.game.loadGeneratedModel(
  'hero-trellis-20260428-124621-718.glb',
  { x: 0, y: 1, z: 0 },
  { scale: 0.5 },
);
```

The loader auto-detects glTF up-axis from the filename: GLBs with
`trellis` in the name are loaded as Y-up (Trellis's glTF-canonical
output), everything else is loaded as Z-up (TripoSR / InstantMesh).
Override with `{ upAxis: 'y' | 'z' }` if needed.

`window.game` is only attached under `import.meta.env.DEV`; production
builds drop the hook.
