# Image-to-3D Tool TODO

Ordered checklist for `tools/image-to-3d/`. Full spec in [image-to-3d-plan.md](./image-to-3d-plan.md).

## Phase 0 — Infrastructure

- [x] **0.1** Folder scaffolding + .gitignore
  - New dirs: `tools/image-to-3d/{inputs,outputs,pipelines,tests,tests/fixtures}`
  - Local `.gitignore`: `.venv/`, `inputs/`, `outputs/`, `__pycache__/`, `*.pyc`
  - Root `.gitignore` appends `public/models/generated/*.glb`
  - `public/models/generated/.gitkeep` committed
  - README stub
- [x] **0.2** Python 3.12 venv + CUDA 12.x PyTorch + GPU smoke test
  - Create venv via `C:\Users\ilham.jillani\AppData\Local\Programs\Python\Python312\python.exe -m venv .venv`
  - `requirements.txt` base: `torch`, `torchvision`, `transformers`, `trimesh`, `Pillow`, `numpy`, `rembg`, `huggingface_hub`, `gradio`, `pytest`
  - PyTorch index: `--extra-index-url https://download.pytorch.org/whl/cu121`
  - `python convert.py --probe` prints CUDA + GPU name

### Checkpoint 0
- [x] `python convert.py --probe` reports `NVIDIA RTX 2000 Ada Generation Laptop GPU`, ~8 GB VRAM
- [x] `git status` clean of anything that shouldn't be tracked

## Phase 1 — TripoSR vertical slice

- [x] **1.1** Preprocessing (`preprocessing.py`) — 27 fast tests including rembg-skipped path and rembg slow end-to-end. Square-pad, tight-crop, Lanczos resize.
- [x] **1.2** Pipeline ABC + TripoSR. Vendored upstream via `external/TripoSR/` (no PyPI setup.py). `torchmcubes` shim delegates to PyMCubes (pure-Python, no MSVC/CUDA build). RGBA→RGB composite against gray background before inference. 2 slow tests pass end-to-end.
- [x] **1.3** Output routing — `public/models/generated/<name>-<YYYYMMDD-HHMMSS-mmm>.glb` + `.meta.json` sidecar with source image, pipeline, timestamp, triangle/vertex counts, and pipeline-specific extras.
- [x] **1.4** CLI — positional input + `--pipeline` + `--output-dir` + `--no-bg-removal` + `--probe` + `--probe-trellis`. Trellis short-circuits before any preprocessing. Exit codes documented in module docstring.

### Checkpoint 1 — TripoSR MVP
- [x] `python convert.py inputs/smoke.png --no-bg-removal` writes valid GLB (3.1 MB, 155K triangles)
- [x] GLB has valid glTF magic bytes (unit test)
- [x] Total time ≈ 15 s on target hardware (under the 30 s budget)
- [ ] **Human review:** open a generated GLB in the running Babylon dev server (Task 3.1 Phase 3) — still pending since Phase 3 is game-integration, not Phase 1.

## Phase 2 — Gradio Web UI

- [x] **2.1** Scaffold (`app.py`) — Blocks layout, drag-drop image, pipeline radio, bg-removal toggle, Generate button, `gr.Model3D` preview, status + path textboxes. Stubbed handler echoed inputs. **Side effect:** had to bump `gradio` from 4.44 → 6.13 — 4.44 + Pydantic 2.13 hit a `gradio_client` JSON-schema bug and a flaky localhost-reachability check that blocked launch.
- [x] **2.2** Wire TripoSR — real pipeline call replaces the stub. `gr.Progress()` shows preprocess → load/inference → export → done. Exceptions surface via `raise gr.Error(...)`. `preprocessing.preprocess_image(pil, …)` split out of `load_and_prepare` so the UI can take Gradio's in-memory PIL image without writing to a temp file.
- [x] **2.3** Download + save controls — `gr.DownloadButton` (hidden until success) serves the GLB through the browser; output-path textbox is plain selectable text alongside the on-disk path.

### Checkpoint 2 — UI MVP
- [x] `python app.py` → localhost:7860 returns HTTP 200
- [ ] Drag-drop → GLB on disk + 3-D preview (interactive — needs a browser session)
- [ ] **Human review:** flow feels usable

## Phase 3 — Game integration

- [x] **3.1** Babylon smoke-test loader
  - `GameApp.loadGeneratedModel(filename, position)` — dev-only, returns the imported root mesh
  - `window.game = game` attached in `main.ts` behind `import.meta.env.DEV`; tree-shaken from production
  - `src/env.d.ts` references `vite/client` so `import.meta.env` is typed under the project's explicit `types` array
  - Manual browser invocation not driven this session (no Chrome DevTools MCP); framework wiring verified via `tsc --noEmit`, vitest 192/192, and Vite serving the GLB at `model/gltf-binary`
- [x] **3.2** README snippet — game handoff
  - `tools/image-to-3d/README.md` "Game handoff" section explains Vite's `/models/generated/` URL convention
  - Copy-paste devtools snippet for `window.game.loadGeneratedModel`

### Checkpoint 3 — End-to-end
- [ ] Image → Gradio → GLB → Babylon scene via devtools
- [ ] All offline after weights cached
- [ ] **Human review:** authoring loop is fast enough to iterate

## Phase 3.5 — InstantMesh pipeline (Apache 2.0, middle quality path)

Motivated by TripoSR producing a melted-blob mesh on a complex cyberpunk reference image. InstantMesh = multi-view fusion via Zero123++, vertex-color output, no `nvdiffrast` build chain on Windows.

- [x] **3.5.1** Vendor InstantMesh upstream + dep manifest
  - `install_instantmesh.py` clones `TencentARC/InstantMesh` to `external/InstantMesh/`, pinned to `08822c52`
  - `requirements-instantmesh.txt`: `diffusers>=0.27,<0.32`, `pytorch-lightning>=2.1,<3`, `torchmetrics>=1,<2`, `accelerate>=0.30`. Drops upstream's `gradio==3.41.2`, `transformers==4.34.1`, `diffusers==0.20.2` (we use newer base pins), `nvdiffrast` (vertex-color skips it), `bitsandbytes` / `plyfile` / `tensorboard` / `webdataset` (training-only or unused at inference)
  - `pip check` clean
  - Import probe `from src.utils.train_util import instantiate_from_config` exits cleanly
- [x] **3.5.2** Import probe + weight prefetch
  - `python convert.py --probe-instantmesh` checks 4 pip deps + vendored upstream import; exit 0 happy path, exit 1 with actionable message on missing tree (verified by hiding `external/InstantMesh`)
  - `--prefetch-weights instantmesh` calls `huggingface_hub.snapshot_download` for `TencentARC/InstantMesh` and `sudo-ai/zero123plus-v1.2` (not run end-to-end yet — 6.5 GB download deferred to user's first real session)
- [x] **3.5.3** Pipeline (`pipelines/instantmesh.py`) — code complete; runtime checks deferred to user's first GPU + 6.5 GB-weight session
  - Two stages: Zero123++ → 6 multi-view → InstantMesh transformer → vertex-colored mesh
  - FP16 diffusion + manual offload between stages (peak VRAM = larger stage, not sum)
  - Class-level cache for both diffusion pipeline and reconstruction model, keyed by `(config_name, device)`
  - Output `trimesh.Scene` with vertex colors populated; `use_texture_map=False` skips nvdiffrast
  - Slow/gpu-marked pytest covers: vertex-color presence, model caching across calls, peak VRAM under 8 GB
  - sys.path shim mirrors TripoSR's pattern — config + `instantiate_from_config` resolved cleanly via the import probe
  - Verified non-runtime: imports cleanly, instantiates on cpu, finds `instant-mesh-large.yaml` config
  - **Pending runtime verification (run pytest -m slow tests/test_instantmesh.py):** weight download + first inference + peak VRAM measurement
- [x] **3.5.4** UI + CLI route to InstantMesh
  - `app.py` PIPELINE_CHOICES now lists three options; `_generate()` dispatches by name
  - `convert.py` PIPELINE_CHOICES tuple gains `"instantmesh"`; `convert_image()` branches on pipeline name
  - Trellis stub message updated to point users at InstantMesh (verified: exit code 10 with new copy)
  - Staged progress wired via optional `progress_callback` constructor kwarg on `InstantMeshPipeline`. UI maps pipeline-internal 0..1 progress to UI band 0.20..0.85 with stage messages: "Loading Zero123++ pipeline" → "Generating multi-view (Zero123++)" → "Loading reconstruction model" → "Reconstructing mesh (LRM)" → "Mesh complete"
  - Sidecar `extra` carries InstantMesh-specific fields (config_name, diffusion_steps, scale, seed)
  - **Pending runtime verification:** a real `python app.py` browser session with the cyberpunk reference image, plus `python convert.py <img> --pipeline instantmesh`
- [x] **3.5.5** README InstantMesh section
  - Quickstart copy-paste (5 lines: pip install, install script, probe, prefetch, run)
  - Timing on target hardware (30–60 s, plus first-run download)
  - VRAM strategy explained (fp16 + manual offload between stages)
  - Vertex colors vs textured rationale + link to `future-specs/image-to-3d-instantmesh-textured.md`
  - Pinned upstream commit `08822c52` recorded with link to GitHub
  - "Probe failed?" troubleshooting maps onto the messages emitted by `--probe-instantmesh`
  - Updated top-of-README pipelines list to show 3 options with quality / speed / VRAM trade-offs

### Checkpoint 3.5 — InstantMesh quality alternative
- [ ] Cyberpunk reference image produces a recognisable mesh (the bar TripoSR failed)
- [ ] Generation under 60 s, peak VRAM under 8 GB
- [ ] **Human review:** quality lift over TripoSR is real, output renders in Babylon dev server

## Phase 4 — Trellis pipeline (quality path, optional — only if InstantMesh insufficient)

- [x] **4.1** Deps + import probe (cffb462)
  - Native install on Windows blocked by four CUDA-extension wheel walls
    (xformers, kaolin, nvdiffrast, diffoctreerast, diff-gaussian-rasterization,
    vox2seq) — runtime moved to WSL instead; see commit body
  - `python convert.py --probe-trellis` enumerates 11 pip modules + 5 native
    extensions + the vendored upstream tree
- [x] **4.2** Trellis pipeline (`pipelines/trellis.py`) — runs on WSL
  - Windows-side `TrellisPipeline` subprocess-shells to `wsl/trellis_runner.py`
    inside `~/trellis-venv` (the native install path is blocked by 4.1)
  - Defaults: `simplify=0.95, texture_size=2048, ss_steps=12, slat_steps=12`
    — operating point picked from the Phase 4.2 spike review (0.95 hides
    marching-cubes noise; 2048 is the sharpness keeper)
  - Optional Marigold-Normals post-bake (~8 s on Windows host) closes the
    "feels like polygons" PBR ceiling; standalone tool at
    `scripts/normal_bake.py` for ad-hoc baking on existing GLBs
  - **Deferred per scope decision:** auto-decimation to 15k tris (TRELLIS's
    own `simplify` parameter handles it); InstantMesh OOM-fallback (TRELLIS-WSL
    and InstantMesh-Windows are different runtimes — fallback adds real
    complexity; revisit only if OOMs actually happen in practice)
- [x] **4.3** UI + CLI picker routes to Trellis
  - convert.py `--pipeline trellis` runs end-to-end; sidecar meta records
    all pipeline-specific knobs
  - Gradio app pipes TRELLIS staged progress (load → bake → export →
    normal-bake) through the same band InstantMesh uses
- [x] **4.4** README Trellis section
  - WSL-only runtime + the wheel-walls reasoning, one-time setup
  - Timing table for default settings (~33 min total)
  - Quality-knobs section explaining why defaults are what they are
  - Probe-failure note (probe runs on Windows, will report extensions
    missing — that's expected; the actual runtime check is in WSL)

### Checkpoint 4 — Quality path
- [ ] ~~Trellis produces GLB in < 120 s~~ — original target untenable on
  this rig (texture-bake at 2048 is ~30 min). Quality bar passed instead;
  speed is now an explicit tradeoff, not a regression.
- [ ] Peak VRAM < 8 GB — not measured; runs without OOM on RTX 2000 Ada (8 GB)
- [ ] **Human review:** Trellis quality premium is worth the wait vs TripoSR
  — confirmed 2026-04-28 (with Marigold normal-bake closing the PBR gap)

## Phase 5 — Polish + docs

- [x] **5.1** Full README
  - Prerequisites (Python 3.12, CUDA 12.1+ driver, disk-space matrix per pipeline)
  - Quickstart (TripoSR, 4 commands)
  - Setup sections per pipeline (InstantMesh, Trellis already shipped)
  - Troubleshooting matrix (InstantMesh OOM, zero123plus 404, prefetch
    symlink, Trellis probe-missing, xformers cpu-torch upgrade, Trellis
    timing, rembg stall)
- [x] **5.2** Input validation + UI error surfacing
  - `validate_input_path` + `validate_input_image` in preprocessing.py
    (file size ≤ 50 MB, dimensions in [256, 4096])
  - CLI: invalid input → exit 11; pipeline failure → exit 12 with the
    friendly OOM hint per `errors.py`
  - UI: Generate button chain disables → runs → re-enables (works for
    success and error paths because `_generate` returns an error state
    instead of raising `gr.Error`)
- [x] **5.3** Batch-mode CLI
  - `--batch <DIR>` walks folder (non-recursive — predictable scope)
  - Per-file errors caught and logged; queue continues
  - Summary at end with success/failure counts + per-failure reasons
  - Exit 0 if all succeed, 13 if any failed, 11 if dir invalid / empty

### Checkpoint 5 — Ship-ready
- [ ] Fresh-clone setup from README alone
- [ ] Both pipelines working + documented
- [ ] UI errors graceful
- [ ] Batch mode works
- [ ] **Human review:** one real concept sketch round-trips into the game as a prop

---

## Future Specs (deliberately out of scope)

- [ ] `future-specs/image-to-3d-decimation.md` — auto-decimate Trellis's high-poly output for runtime game use
- [ ] `future-specs/image-to-3d-subfolders.md` — let the UI write to `creatures/` / `props/` / `buildings/` directly
- [ ] `future-specs/image-to-3d-sidecar-json.md` — record source image + pipeline + timestamp alongside each GLB
- [ ] `future-specs/image-to-3d-instantmesh-textured.md` — UV-mapped textured output for InstantMesh (requires `nvdiffrast`; vertex-color is the Phase 3.5 default)
- [ ] `future-specs/image-to-3d-instantmesh-vram.md` — fit InstantMesh stage 2 in 8 GB on-device (chunked triplane queries or `instant-mesh-base` config); today it peaks at ~20 GB and runs only via Windows WDDM oversubscription, paying ~4× wall-clock on stage 2
- [ ] `future-specs/image-to-3d-rigged-export.md` — rigged / animated mesh output (needs Blender scripting, not a candidate for the current tool)
