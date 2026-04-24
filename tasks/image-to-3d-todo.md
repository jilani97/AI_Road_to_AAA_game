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

- [ ] **3.1** Babylon smoke-test loader
  - `GameApp.loadGeneratedModel(filename, position)` — dev-only
  - `window.game = this` behind `import.meta.env.DEV`
  - Manual devtools invocation loads mesh
- [ ] **3.2** README snippet — game handoff
  - How Vite serves `/models/generated/`
  - Runnable devtools snippet

### Checkpoint 3 — End-to-end
- [ ] Image → Gradio → GLB → Babylon scene via devtools
- [ ] All offline after weights cached
- [ ] **Human review:** authoring loop is fast enough to iterate

## Phase 4 — Trellis pipeline (quality path, risky)

- [ ] **4.1** Deps + import probe
  - `requirements-trellis.txt`: `torch-scatter`, `xformers`, `diff-gaussian-rasterization`, `nvdiffrast`
  - `python convert.py --probe-trellis` checks imports
  - Windows wheel sources documented in README
- [ ] **4.2** Trellis pipeline (`pipelines/trellis.py`)
  - FP16 + attention slicing + sequential CPU offload
  - 512×512 input (not 1024) for VRAM budget
  - **Auto-decimate** output to ~15 000 triangles via `trimesh.simplify.simplify_quadratic_decimation`; keep `<name>-source.glb` alongside for reference
  - **Fallback:** swap to InstantMesh if VRAM ceiling hit — see Plan §Risks
- [ ] **4.3** UI + CLI picker routes to Trellis
  - Remove "not implemented" stub
  - Staged progress bar (multi-view → mesh → texture)
- [ ] **4.4** README Trellis section
  - Timing expectations, OOM guidance, Windows wheel notes

### Checkpoint 4 — Quality path
- [ ] Trellis produces GLB in < 120 s
- [ ] Peak VRAM < 8 GB
- [ ] **Human review:** Trellis quality premium is worth the wait vs TripoSR

## Phase 5 — Polish + docs

- [ ] **5.1** Full README
  - Prerequisites (Python 3.12 path, CUDA driver, disk space)
  - Quickstart (TripoSR only, ≤ 10 commands)
  - Full setup (Trellis, separate section)
  - Troubleshooting matrix (OOM, CUDA mismatch, nvdiffrast, rembg, HF cache)
- [ ] **5.2** Input validation + UI error surfacing
  - Size / format / filesize guards pre-model-load
  - `OutOfMemoryError` → "Try TripoSR or smaller input"
  - Disable Generate button during inference
- [ ] **5.3** Batch-mode CLI
  - `--batch <dir>` walks folder
  - Continues on per-file errors
  - Final summary with counts

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
- [ ] `future-specs/image-to-3d-instantmesh.md` — add InstantMesh as a third pipeline option (the Trellis fallback, promoted to first-class)
- [ ] `future-specs/image-to-3d-rigged-export.md` — rigged / animated mesh output (needs Blender scripting, not a candidate for the current tool)
