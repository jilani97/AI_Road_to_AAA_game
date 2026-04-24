# Image-to-3D Tool TODO

Ordered checklist for `tools/image-to-3d/`. Full spec in [image-to-3d-plan.md](./image-to-3d-plan.md).

## Phase 0 — Infrastructure

- [ ] **0.1** Folder scaffolding + .gitignore
  - New dirs: `tools/image-to-3d/{inputs,outputs,pipelines,tests,tests/fixtures}`
  - Local `.gitignore`: `.venv/`, `inputs/`, `outputs/`, `__pycache__/`, `*.pyc`
  - Root `.gitignore` appends `public/models/generated/*.glb`
  - `public/models/generated/.gitkeep` committed
  - README stub
- [ ] **0.2** Python 3.11 venv + CUDA 12.x PyTorch + GPU smoke test
  - Create venv via `C:\ProgramData\chocolatey\bin\python3.11.exe -m venv .venv`
  - `requirements.txt` base: `torch`, `torchvision`, `transformers`, `trimesh`, `Pillow`, `numpy`, `rembg`, `huggingface_hub`, `gradio`, `pytest`
  - PyTorch index: `--extra-index-url https://download.pytorch.org/whl/cu121`
  - `python convert.py --probe` prints CUDA + GPU name

### Checkpoint 0
- [ ] `python convert.py --probe` reports `NVIDIA RTX 2000 Ada Generation Laptop GPU`, ~8 GB VRAM
- [ ] `git status` clean of anything that shouldn't be tracked

## Phase 1 — TripoSR vertical slice

- [ ] **1.1** Preprocessing (`preprocessing.py`)
  - `load_and_prepare(path, target_size=512, remove_background=True) -> PIL.Image`
  - Square-pad (not stretch) + rembg + RGBA
  - 2 fixture images + pytest
- [ ] **1.2** Pipeline ABC + TripoSR (`pipelines/base.py`, `pipelines/triposr.py`)
  - `Pipeline.generate(image) -> trimesh.Scene`
  - TripoSR loads once, caches model on class
  - Install via `pip install git+https://github.com/VAST-AI-Research/TripoSR.git`
  - Test: triangle count > 1 000, VRAM < 4 GB
- [ ] **1.3** Output routing (`output.py`)
  - `resolve_output_path(base_filename)` → `<repo>/public/models/generated/<name>-<timestamp>.glb`
  - `export_scene_to_glb(scene, path)` wraps `trimesh.Scene.export`
  - Millisecond precision to avoid collisions
  - **Sidecar JSON:** writes `<name>-<timestamp>.meta.json` alongside with source image, pipeline, timestamp, triangle/vertex count
- [ ] **1.4** CLI (`convert.py`)
  - Args: input path, `--pipeline`, `--output-dir`, `--no-bg-removal`, `--probe`, `--probe-trellis` (Phase 4)
  - Trellis stub errors out until Phase 4
  - Prints output path + elapsed seconds

### Checkpoint 1 — TripoSR MVP
- [ ] `python convert.py tests/fixtures/with_bg.jpg` writes valid GLB
- [ ] GLB passes gltf-validator
- [ ] Total time < 30 s on target hardware
- [ ] **Human review:** mesh looks like the input subject

## Phase 2 — Gradio Web UI

- [ ] **2.1** Scaffold (`app.py`)
  - Gradio Blocks: image upload, radio (triposr/trellis), Generate button, `gr.Model3D` preview, status line
  - Stubbed generate: echo inputs, no model call
- [ ] **2.2** Wire TripoSR
  - Real pipeline call + `gr.Progress()`
  - Errors caught → `gr.Error` toast, no stack traces
- [ ] **2.3** Download + save controls
  - Download GLB button serves file through browser
  - On-disk path displayed as selectable text

### Checkpoint 2 — UI MVP
- [ ] `python app.py` → localhost:7860 works
- [ ] Drag-drop → GLB on disk + 3-D preview
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
  - Prerequisites (Python 3.11 path, CUDA driver, disk space)
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
