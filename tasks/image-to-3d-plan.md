# Implementation Plan: Local Image-to-3D Tool

## Overview

A separate Python tool living at `tools/image-to-3d/`, siblinged to the game's `src/`. It accepts a 2-D image (concept art / sketch / reference photo) and produces a GLB in `public/models/generated/` that the Babylon game can `ImportMeshAsync` directly. The tool runs **fully offline** after weights are cached, uses a **Gradio web UI** for drag-and-drop authoring, and exposes a **CLI** for scripted / batch use.

Two pipelines are selectable from the UI:

- **TripoSR** (MIT) — fast path, ~2 GB VRAM, seconds per image, lower quality.
- **Trellis** (MIT) — quality path, ~8–12 GB VRAM, ~60 s per image, high quality.

The full decision rationale lives in [`image-to-3d-decisions.md`](./image-to-3d-decisions.md) (written alongside implementation, not upfront).

## Target Hardware

Confirmed via `nvidia-smi`:

- CPU: Intel Core i9
- GPU: **NVIDIA RTX 2000 Ada Generation Laptop — 8 188 MiB VRAM** (8 GB, not the desktop card's 16 GB)
- RAM: 64 GB
- Driver: 581.95

**Key implication:** the 8 GB VRAM ceiling makes Trellis *tight*. The plan assumes Trellis runs with FP16 + attention slicing + sequential CPU offloading; if that still OOMs on real inputs, Phase 4 falls back to **InstantMesh** (Apache 2.0, typically ~6–8 GB VRAM with similar quality).

## Architecture Decisions

- **Separate Python project, not embedded in the Vite app.** Game stays TypeScript-only; tool stays Python-only. Shared contract is a filesystem directory.
- **Single shared filesystem contract:** generated GLBs land in `public/models/generated/`. `public/` is already Vite's static serve root — nothing else needs to change for the game to load them.
- **Pipeline strategy pattern.** Each pipeline is a subclass of a `Pipeline` ABC with `prepare(image) -> tensor` and `generate(tensor) -> trimesh.Scene`. The UI and CLI pick a pipeline by name and stay ignorant of weights / internals.
- **Pre-trained weights only.** No training. HuggingFace hub handles the one-time download and local cache (`~/.cache/huggingface/hub/` by default).
- **Python 3.12 venv, not 3.13.** PyTorch + nvdiffrast + xformers ecosystems still have patchy 3.13 wheels. Context7 (ComfyUI 3D Pack support matrix) lists Python 3.10 / 3.11 / 3.12 and recommends 3.12 as the Windows happy path. Anchor: `C:\Users\ilham.jillani\AppData\Local\Programs\Python\Python312\python.exe` (Python 3.12.10, python.org installer).
- **CUDA 12.x PyTorch wheels** via the PyTorch index URL (`cu121` or `cu124`). No user-managed CUDA Toolkit installation needed.
- **rembg for background removal** — both pipelines expect an RGBA image with the subject isolated. rembg is a small, MIT-licensed runtime that uses ONNX u²net; fits VRAM easily alongside the main models.
- **Gradio, not a bespoke web UI.** Drag-drop, pipeline picker, progress bar, download all come for free. Listens on localhost only.
- **Tool is stateless on disk.** Inputs and outputs live in directories; no database, no config file beyond `requirements.txt`.

## Repo Layout

```
AI_Road_to_AAA_game/
├── src/                          # Babylon game (unchanged)
├── public/
│   └── models/
│       └── generated/            # NEW — runtime drop zone for GLBs
├── tasks/
│   ├── plan.md                   # existing game plan
│   ├── decisions.md              # existing game decisions
│   ├── todo.md                   # existing game TODO
│   ├── image-to-3d-plan.md       # THIS FILE
│   └── image-to-3d-todo.md       # companion checklist
└── tools/
    └── image-to-3d/              # NEW sibling project
        ├── .gitignore            # venv, outputs, caches
        ├── .python-version       # 3.11 marker
        ├── README.md             # setup + first-run + troubleshooting
        ├── requirements.txt      # pinned Python deps
        ├── app.py                # Gradio entry
        ├── convert.py            # CLI entry
        ├── preprocessing.py      # bg removal + resize
        ├── output.py             # target-path resolution + uniq filenames
        ├── inputs/               # drop-zone for reference images (gitignored)
        ├── outputs/              # staging; canonical output is public/models/generated/
        └── pipelines/
            ├── __init__.py
            ├── base.py           # Pipeline ABC
            ├── triposr.py        # TripoSR implementation
            └── trellis.py        # Trellis implementation (Phase 4)
```

## Dependency Graph

```
Phase 0 — Infrastructure (scaffolding + venv + torch+cuda)
    │
    ├── Task 0.1: Folder scaffolding + .gitignore
    └── Task 0.2: Python 3.12 venv + CUDA 12.x PyTorch + GPU smoke test

Phase 1 — TripoSR vertical slice (MVP, CLI-only)
    │
    ├── Task 1.1: Preprocessing (bg removal + square crop + RGBA)
    ├── Task 1.2: Pipeline ABC + TripoSR implementation
    ├── Task 1.3: Output routing → public/models/generated/
    └── Task 1.4: convert.py CLI

Checkpoint 1: `python convert.py inputs/test.jpg` writes a valid GLB.

Phase 2 — Gradio web UI
    │
    ├── Task 2.1: Basic Gradio scaffold (image drop, pipeline picker stub)
    ├── Task 2.2: Wire TripoSR pipeline with progress + error surfacing
    └── Task 2.3: Download + "save to game" controls

Checkpoint 2: `python app.py` opens localhost:7860, drag-drop produces a GLB
              visible in the UI's output gallery and written to public/models/generated/.

Phase 3 — Game integration smoke test
    │
    ├── Task 3.1: Babylon helper to import generated/*.glb dynamically
    └── Task 3.2: README snippet: how the game picks up new GLBs

Checkpoint 3: Generated GLB from Phase 2 renders in the running dev server.

Phase 4 — Trellis pipeline (quality path)
    │
    ├── Task 4.1: Trellis deps install + import smoke test
    ├── Task 4.2: Trellis pipeline module with VRAM-safe config
    ├── Task 4.3: UI pipeline picker routes to Trellis
    └── Task 4.4: README Trellis section + Windows troubleshooting

Checkpoint 4: Selecting Trellis in the UI produces a high-quality GLB within 120 s
              on a representative image, staying under 8 GB VRAM.

Phase 5 — Polish + docs
    │
    ├── Task 5.1: Full README (setup, first-run, weight cache, troubleshooting)
    ├── Task 5.2: Error handling + UI-side error toasts
    └── Task 5.3: Batch-mode CLI (convert a folder of images in one call)

Checkpoint 5: Fresh-clone setup works end-to-end following only the README.
```

## Scope Decisions (what we're NOT doing this pass)

- ❌ Training custom models — all models are pre-trained, weights downloaded from HuggingFace.
- ❌ Rigged / animated mesh output — both pipelines produce static meshes. Characters with skeletons stay a Meshy/Blender job.
- ❌ In-game authoring UI — the tool is dev-time only, not exposed at runtime.
- ❌ Cloud fallback — if the local pipelines fail, the user uses the Meshy web UI manually.
- ❌ Mesh decimation / cleanup — Trellis outputs high-poly meshes; if performance bites in-game, we add decimation later (out of scope for this pass).
- ❌ PBR texture rebaking — pipelines emit GLBs with whatever textures they generate; no re-authoring.
- ❌ Training telemetry / model tuning knobs — pipelines run at their authors' defaults unless VRAM forces an override.

---

## Task List

### Phase 0 — Infrastructure

#### Task 0.1: Folder scaffolding + .gitignore

**Description:** Create the `tools/image-to-3d/` directory structure, a local `.gitignore` (venv, inputs, outputs, HF cache, `__pycache__`, `*.pyc`), and an empty README stub. Also create `public/models/generated/` with a `.gitkeep` so the directory exists pre-first-run, and add an entry to the game's root `.gitignore` to skip `public/models/generated/*.glb` from version control.

**Acceptance criteria:**
- [ ] `tools/image-to-3d/` exists with empty subdirs `inputs/`, `outputs/`, `pipelines/`
- [ ] `.gitignore` at `tools/image-to-3d/.gitignore` skips `.venv/`, `inputs/`, `outputs/`, `__pycache__/`, `*.pyc`
- [ ] Root `.gitignore` adds `public/models/generated/*.glb` (but keeps `.gitkeep`)
- [ ] `public/models/generated/.gitkeep` committed

**Verification:**
- [ ] `git status` shows only the new directories / stubs + `.gitignore` changes, nothing noisy

**Dependencies:** None.

**Files likely touched:**
- `tools/image-to-3d/.gitignore`
- `tools/image-to-3d/README.md` (stub)
- `tools/image-to-3d/pipelines/__init__.py` (empty)
- `public/models/generated/.gitkeep`
- `.gitignore` (append)

**Estimated scope:** XS (1 new file + two dir creations).

---

#### Task 0.2: Python 3.12 venv + CUDA 12.x PyTorch + GPU smoke test

**Description:** Create a Python 3.12 virtual environment using `C:\Users\ilham.jillani\AppData\Local\Programs\Python\Python312\python.exe` (Python 3.12.10). Write `requirements.txt` pinning the base deps: PyTorch with CUDA 12.1 wheels, torchvision, transformers, trimesh, Pillow, numpy, rembg, huggingface_hub, gradio. Document the install command in the README (not a setup script — Windows users benefit from running the commands themselves). Write a one-line smoke test in `convert.py --probe` that prints `torch.__version__`, `torch.cuda.is_available()`, and the GPU name.

**Acceptance criteria:**
- [ ] `tools/image-to-3d/requirements.txt` pins PyTorch ≥2.4 with `--extra-index-url https://download.pytorch.org/whl/cu121`
- [ ] `tools/image-to-3d/.venv/` created via `C:\ProgramData\chocolatey\bin\python3.11.exe -m venv .venv`
- [ ] `pip install -r requirements.txt` completes without error inside the venv
- [ ] `python convert.py --probe` prints `cuda.is_available() = True` and the GPU name

**Verification:**
- [ ] Smoke test output matches: `NVIDIA RTX 2000 Ada Generation Laptop GPU`
- [ ] `torch.cuda.get_device_properties(0).total_memory` reports ~8 GB

**Dependencies:** 0.1.

**Files likely touched:**
- `tools/image-to-3d/requirements.txt`
- `tools/image-to-3d/convert.py` (with only the `--probe` branch at this stage)
- `tools/image-to-3d/README.md` (install command)

**Estimated scope:** S.

**Risk:** first-time PyTorch CUDA install is ~3 GB of wheels. Slow on bad networks. Known.

---

### Checkpoint 0 (Infrastructure)

- [ ] `tools/image-to-3d/.venv/python --version` prints `Python 3.12.x`
- [ ] `python convert.py --probe` reports CUDA available
- [ ] Nothing generated or committed that shouldn't be (check `git status`)

---

### Phase 1 — TripoSR vertical slice

Goal: drop an image on the command line, get a GLB at `public/models/generated/<name>.glb`. Zero UI at this stage — that's Phase 2.

#### Task 1.1: Preprocessing utilities (background removal + RGBA + resize)

**Description:** Module `preprocessing.py` with `load_and_prepare(path: Path, target_size: int = 512) -> PIL.Image.Image`. Steps: load any common format (JPG/PNG/WEBP), run rembg to isolate subject on a transparent background, centre the subject in a square canvas, resize to `target_size`. Return an RGBA `PIL.Image`. Both pipelines consume this. Keep a `remove_background: bool = True` flag so users who already have transparent PNGs can skip rembg (it costs a few seconds and quality is better on clean inputs).

**Acceptance criteria:**
- [ ] Accepts at least JPG, PNG, WEBP inputs
- [ ] Returns an RGBA PIL.Image at `target_size × target_size`
- [ ] `remove_background=False` preserves an existing alpha channel
- [ ] Handles landscape / portrait / square inputs without distortion (pad, don't stretch)

**Verification:**
- [ ] Unit test (pytest) with two fixture images (one with bg, one already transparent)
- [ ] Output is always 512×512 RGBA

**Dependencies:** 0.2.

**Files likely touched:**
- `tools/image-to-3d/preprocessing.py`
- `tools/image-to-3d/tests/test_preprocessing.py`
- `tools/image-to-3d/tests/fixtures/with_bg.jpg` (a small CC0 sample)
- `tools/image-to-3d/tests/fixtures/transparent.png`

**Estimated scope:** S.

---

#### Task 1.2: Pipeline ABC + TripoSR implementation

**Description:** Define a `Pipeline` ABC in `pipelines/base.py` with:
```python
class Pipeline(ABC):
    name: str
    @abstractmethod
    def generate(self, image: PIL.Image.Image) -> trimesh.Scene: ...
```
Implement `TripoSRPipeline` in `pipelines/triposr.py` using the `tsr` package from `stabilityai/TripoSR`. Load once via HuggingFace hub, cache model instance on the class so repeated calls don't reload. Convert the TripoSR scene output to a `trimesh.Scene` ready for GLB export.

**Acceptance criteria:**
- [ ] `Pipeline.generate(image)` returns a `trimesh.Scene` with at least one mesh
- [ ] The mesh has watertight-ish geometry (≥ 1 000 triangles, non-empty)
- [ ] Model weights auto-download on first run and cache under `~/.cache/huggingface/`
- [ ] Second call within the same process does not re-load weights

**Verification:**
- [ ] Unit test: pass a 512×512 fixture RGBA image, assert `len(scene.geometry) > 0` and `sum(m.faces.shape[0] for m in scene.geometry.values()) > 1000`
- [ ] Manually watch `nvidia-smi` during generation: VRAM usage stays < 4 GB

**Dependencies:** 1.1.

**Files likely touched:**
- `tools/image-to-3d/pipelines/base.py`
- `tools/image-to-3d/pipelines/triposr.py`
- `tools/image-to-3d/requirements.txt` (add `triposr` / upstream wheel)
- `tools/image-to-3d/tests/test_triposr.py` (marked slow/gpu — skipped on CI)

**Estimated scope:** M.

**Risk:** TripoSR upstream is distributed via git rather than PyPI. `pip install git+https://github.com/VAST-AI-Research/TripoSR.git` is the canonical path; document that in the README.

---

#### Task 1.3: Output routing — `public/models/generated/`

**Description:** `output.py` exposes `resolve_output_path(base_filename: str, out_dir: Path | None = None) -> Path`. Default `out_dir` is the game's `public/models/generated/` directory, resolved from the tool's filesystem location (`Path(__file__).parents[2] / 'public' / 'models' / 'generated'`). Ensure the directory exists. Append `-YYYYMMDD-HHMMSS` to the filename so repeated runs don't overwrite a prior GLB. Return the full `Path` to write to. Also expose `export_scene_to_glb(scene, path)` that wraps `trimesh.Scene.export`.

**Acceptance criteria:**
- [ ] Default target is `<repo>/public/models/generated/<name>-<timestamp>.glb`
- [ ] Created intermediary directories if missing
- [ ] Override via `out_dir` argument writes to an arbitrary path
- [ ] Timestamp collisions impossible under 1 Hz of generation (use millisecond precision if needed)
- [ ] `<name>-<timestamp>.meta.json` sidecar written alongside the GLB with `{source_image, pipeline, generated_at, mesh_stats: {triangles, vertices}}`

**Verification:**
- [ ] Unit test: call `resolve_output_path('dragon')` twice in quick succession; both paths land under `public/models/generated/` and differ

**Dependencies:** 1.2.

**Files likely touched:**
- `tools/image-to-3d/output.py`
- `tools/image-to-3d/tests/test_output.py`

**Estimated scope:** S.

---

#### Task 1.4: `convert.py` CLI

**Description:** `python convert.py <input_image>` produces a GLB in `public/models/generated/`. Flags: `--pipeline {triposr,trellis}` (default triposr; trellis stub errors out with "not implemented yet" until Phase 4), `--output-dir <path>` (overrides default), `--no-bg-removal` (skips rembg), `--probe` (from 0.2, lists GPU + torch status and exits). Print the final output path and total elapsed seconds.

**Acceptance criteria:**
- [ ] `python convert.py tests/fixtures/with_bg.jpg` writes a valid GLB
- [ ] `python convert.py tests/fixtures/with_bg.jpg --output-dir /tmp/t` writes to `/tmp/t/`
- [ ] `python convert.py tests/fixtures/with_bg.jpg --pipeline trellis` exits with a clear "not yet implemented" error before any model load
- [ ] Exit code is 0 on success, non-zero on any error

**Verification:**
- [ ] `python convert.py tests/fixtures/with_bg.jpg` end-to-end: dropped file at `public/models/generated/with_bg-<timestamp>.glb` opens in an online GLB viewer or gltf-validator without errors
- [ ] `python convert.py --probe` still works (0.2 flow preserved)

**Dependencies:** 1.1, 1.2, 1.3.

**Files likely touched:**
- `tools/image-to-3d/convert.py` (expanded from 0.2's probe-only stub)

**Estimated scope:** S.

---

### Checkpoint 1 — TripoSR MVP

- [ ] `python convert.py tests/fixtures/with_bg.jpg` produces a valid GLB in `public/models/generated/`
- [ ] GLB opens in https://gltf-viewer.donmccurdy.com/ (or equivalent) without validation errors
- [ ] Whole process under 30 s on the target hardware
- [ ] **Human review:** visually inspect the mesh, confirm it's recognisable as the input subject

---

### Phase 2 — Gradio Web UI

#### Task 2.1: Basic Gradio scaffold

**Description:** `app.py` with a Gradio Blocks layout: image upload (drag-and-drop), radio picker for `triposr` / `trellis`, "Generate" button, a 3-D preview via `gr.Model3D`, and a download link for the GLB. Pipeline is stubbed — clicking Generate just echoes which pipeline was picked and confirms the image was received. No real model inference wired yet.

**Acceptance criteria:**
- [ ] `python app.py` opens a Gradio server on `localhost:7860`
- [ ] Drag-drop an image; it appears in the preview area
- [ ] Radio picker shows both pipelines
- [ ] "Generate" click fires the stub and updates a status line

**Verification:**
- [ ] Open `localhost:7860` in a browser; drag a fixture image; click Generate; see stub output

**Dependencies:** 0.2 (needs gradio from requirements).

**Files likely touched:**
- `tools/image-to-3d/app.py`

**Estimated scope:** S.

---

#### Task 2.2: Wire TripoSR through the UI

**Description:** Replace the stub with a real pipeline call. When Generate fires: preprocess → pipeline.generate → export to `public/models/generated/`. Surface progress (Gradio `gr.Progress()`), show total elapsed seconds, and render the output GLB in the `gr.Model3D` viewer. Errors are caught and displayed as a Gradio `gr.Error`.

**Acceptance criteria:**
- [ ] Dropping a valid JPG produces a visible 3-D preview within the UI
- [ ] The same GLB also lives at `public/models/generated/<name>-<ts>.glb`
- [ ] An invalid input (e.g. a text file renamed to `.jpg`) surfaces a friendly error, not a stack trace

**Verification:**
- [ ] UI run with fixture: preview appears, file on disk, no console errors
- [ ] UI run with `requirements.txt` renamed to `.png`: error toast, no crash

**Dependencies:** 2.1, 1.2, 1.3.

**Files likely touched:**
- `tools/image-to-3d/app.py`

**Estimated scope:** S.

---

#### Task 2.3: Download + save controls

**Description:** A "Download GLB" button that serves the just-generated file to the browser, plus a status line that shows the on-disk path (`public/models/generated/<filename>`). This lets the user copy the path into game code or just know where it went.

**Acceptance criteria:**
- [ ] Download button saves the GLB through the browser
- [ ] On-disk path is rendered alongside the preview
- [ ] Path is click-selectable text (easy to copy)

**Verification:**
- [ ] Download produces a byte-identical file compared to the on-disk version

**Dependencies:** 2.2.

**Files likely touched:**
- `tools/image-to-3d/app.py`

**Estimated scope:** S.

---

### Checkpoint 2 — UI MVP

- [ ] `python app.py` → localhost UI
- [ ] Drag-drop image → GLB on disk + 3-D preview in browser
- [ ] Download button works
- [ ] **Human review:** the overall UI flow feels usable, no obvious friction

---

### Phase 3 — Game integration

#### Task 3.1: Babylon smoke-test loader

**Description:** Extend `GameApp` with a dev-only helper `public async loadGeneratedModel(filename: string, position: Vector3): Promise<void>` that calls `SceneLoader.ImportMeshAsync('', '/models/generated/', filename, this.scene)` and parents the returned meshes to a new `TransformNode` at `position`. The method is not called by default; it's invoked manually from the browser devtools console (`window.game?.loadGeneratedModel('dragon.glb', new BABYLON.Vector3(5, 1, 0))`). Exposes `window.game = this` in dev mode only.

**Acceptance criteria:**
- [ ] A generated GLB from Phase 2 loads into the running scene via devtools
- [ ] The model is visible, correctly oriented (not 90° off), and roughly the intended scale
- [ ] Production build doesn't expose `window.game` (gated on `import.meta.env.DEV`)

**Verification:**
- [ ] In the dev server, generate a GLB; open devtools; run the load call; see the mesh appear

**Dependencies:** 2.3 (needs a real GLB to test with).

**Files likely touched:**
- `src/game/GameApp.ts` (small addition)
- `src/main.ts` (conditional `window.game = game` in dev)

**Estimated scope:** S.

**Note:** this is a one-way smoke test, not a production feature. The broader "scatter generated props around the map" work is out of scope and lives in the game plan.

---

#### Task 3.2: README snippet — game integration handoff

**Description:** A short section in `tools/image-to-3d/README.md` explaining how a generated GLB is picked up by the game: `public/models/generated/foo.glb` is served at `/models/generated/foo.glb` by Vite; call `SceneLoader.ImportMeshAsync(...)` from game code. Link the smoke-test devtools snippet.

**Acceptance criteria:**
- [ ] Section exists with a runnable devtools snippet
- [ ] Points out where to edit game code to load the GLB permanently

**Verification:**
- [ ] A fresh reader can follow the snippet without asking clarifying questions

**Dependencies:** 3.1.

**Files likely touched:**
- `tools/image-to-3d/README.md`

**Estimated scope:** XS.

---

### Checkpoint 3 — End-to-end

- [ ] Drag an image into Gradio → GLB written to `public/models/generated/` → renders in the running Babylon scene via devtools
- [ ] Everything offline after weights are cached
- [ ] **Human review:** the authoring loop feels fast enough to iterate on real concepts

---

### Phase 4 — Trellis pipeline (quality path)

This phase carries real risk. 8 GB VRAM is the target hardware's ceiling. If Trellis cannot be made to fit, the fallback is **InstantMesh** (Apache 2.0, similar VRAM footprint, proven high-quality output).

#### Task 4.1: Trellis dependencies + import smoke test

**Description:** Add Trellis's native deps to `requirements.txt`: `torch-scatter`, `xformers`, `diff-gaussian-rasterization`, `nvdiffrast`. These are tricky on Windows — document the wheel sources (PyPI, pytorch-nightly, rvbust, or user-built) in the README. Implement an import probe: `python convert.py --probe-trellis` that imports the Trellis modules and reports success or a friendly error pointing at the README troubleshooting section.

**Acceptance criteria:**
- [ ] `requirements.txt` (or a separate `requirements-trellis.txt`) pins Trellis deps
- [ ] `python convert.py --probe-trellis` returns exit code 0 on a working install
- [ ] On a failed install, the error message points at a specific README anchor

**Verification:**
- [ ] Fresh venv → install → probe passes
- [ ] Force a fail (uninstall `nvdiffrast`) → probe emits actionable error

**Dependencies:** 0.2.

**Files likely touched:**
- `tools/image-to-3d/requirements-trellis.txt` (separate so TripoSR-only users don't pay)
- `tools/image-to-3d/convert.py` (adds `--probe-trellis` branch)
- `tools/image-to-3d/README.md` (Windows wheel notes)

**Estimated scope:** S (but easily drifts to M if Windows wheels fight back).

**Risk (High):** `nvdiffrast` and `diff-gaussian-rasterization` routinely require building from source on Windows. If binaries don't exist, we document WSL2 as a fallback or drop Trellis in favour of InstantMesh.

---

#### Task 4.2: Trellis pipeline module with VRAM-safe config

**Description:** `pipelines/trellis.py` implementing the `Pipeline` interface. Initialise the Trellis pipeline at FP16 (`torch_dtype=torch.float16`), enable attention slicing, enable sequential CPU offload. Use a 512×512 input target (not 1024) to stay in the VRAM budget. Export the scene to a trimesh Scene for Phase 3's GLB export.

**Acceptance criteria:**
- [ ] `TrellisPipeline.generate(image)` returns a non-empty `trimesh.Scene`
- [ ] Peak VRAM during inference stays < 8 000 MiB (monitored via `torch.cuda.max_memory_allocated`)
- [ ] Output mesh has higher triangle count and better topology than TripoSR on the same input
- [ ] Post-process auto-decimates to `max_triangles` (default 15 000) via `trimesh.simplify.simplify_quadratic_decimation`; original high-poly written to `<name>-<ts>-source.glb` sidecar for reference

**Verification:**
- [ ] Run against the same fixture as TripoSR; compare face count and a human-eyeball of the textured result
- [ ] `nvidia-smi -l 1` during generation: GPU utilisation spikes, VRAM stays under budget

**Dependencies:** 4.1, 1.2.

**Files likely touched:**
- `tools/image-to-3d/pipelines/trellis.py`
- `tools/image-to-3d/tests/test_trellis.py` (marked gpu/slow)

**Estimated scope:** M.

**Fallback:** if Trellis cannot be made to fit in 8 GB even with aggressive offloading, swap to `InstantMesh`. Task description in the TODO has the swap procedure.

---

#### Task 4.3: UI pipeline picker routes to Trellis

**Description:** Remove the "not yet implemented" stub from the CLI and UI. When Trellis is selected, route to `TrellisPipeline` instead of `TripoSRPipeline`. Surface additional progress stages (image → multi-view → mesh → texture) in the Gradio progress indicator since Trellis is much slower.

**Acceptance criteria:**
- [ ] UI Trellis option runs the real pipeline end-to-end
- [ ] Progress bar advances visibly through stages, not a single frozen bar
- [ ] CLI `--pipeline trellis` also works

**Verification:**
- [ ] UI end-to-end flow with Trellis produces a GLB and loads in the Babylon smoke test
- [ ] CLI end-to-end also works

**Dependencies:** 4.2, 2.3.

**Files likely touched:**
- `tools/image-to-3d/app.py`
- `tools/image-to-3d/convert.py`

**Estimated scope:** S.

---

#### Task 4.4: README Trellis section + Windows troubleshooting

**Description:** A dedicated README section covering: how long Trellis takes (~60-120 s/image on this hardware), the VRAM ceiling, the known-bad Windows wheel situations, how to fall back to TripoSR quickly, how to verify the install (`--probe-trellis`), and how to clear the HuggingFace cache if downloads corrupt mid-transfer.

**Acceptance criteria:**
- [ ] Section answers the three most likely support questions ("how slow?", "it said OOM", "import failed on Windows")
- [ ] Links to the specific wheel sources that actually worked on the target machine

**Verification:**
- [ ] Walk through the README with a fresh clone mindset — no steps are hand-wavy

**Dependencies:** 4.1, 4.2, 4.3.

**Files likely touched:**
- `tools/image-to-3d/README.md`

**Estimated scope:** XS.

---

### Checkpoint 4 — Quality path working

- [ ] Selecting Trellis in the UI produces a high-quality GLB within 120 s on the target hardware
- [ ] Peak VRAM stays under 8 GB
- [ ] Both pipelines can be selected and both succeed end-to-end
- [ ] **Human review:** visual comparison of TripoSR vs Trellis on at least two real concept images — the Trellis premium is worth the wait

---

### Phase 5 — Polish + docs

#### Task 5.1: Full README

**Description:** Consolidate everything into a single README the user (or a future contributor) can follow from zero to first generation: Prerequisites (Python 3.12 location, CUDA driver version, ≥15 GB free disk for weights), install steps (venv, requirements, optional Trellis block), first-run walkthrough (`--probe`, CLI example, Gradio example), architecture diagram (same ASCII as this plan), troubleshooting matrix (OOM, torch CUDA mismatch, nvdiffrast missing, rembg ONNX error, HF cache corruption).

**Acceptance criteria:**
- [ ] Prerequisites explicitly call out the RTX 2000 Ada 8 GB ceiling
- [ ] A "Quickstart (TripoSR only)" section exists and is short (≤ 10 commands)
- [ ] A "Full setup (Trellis)" section is separate and flagged as higher effort
- [ ] Troubleshooting has anchor links so probe errors can point at them

**Verification:**
- [ ] Fresh reader can go from `git clone` to a generated GLB using only the README

**Dependencies:** 4.4.

**Files likely touched:**
- `tools/image-to-3d/README.md`

**Estimated scope:** S.

---

#### Task 5.2: Input validation + UI error surfacing

**Description:** Validate inputs before hitting the model: image size ≤ 4096 px on the long side, file size ≤ 32 MB, one of the allowed formats. Catch `torch.cuda.OutOfMemoryError` and surface a specific "Out of VRAM — try TripoSR or reduce input size" message. Catch missing-weights errors and point at the README. Guard against the UI being clicked twice while a generation is in flight (disable the button during inference).

**Acceptance criteria:**
- [ ] Oversize image → friendly error, no crash
- [ ] Two rapid Generate clicks → second one is ignored or queued, never races
- [ ] VRAM OOM → suggestion to swap pipeline, not a raw traceback

**Verification:**
- [ ] Unit test for the validation function with boundary cases
- [ ] Manual UI test: smash Generate while a run is in flight

**Dependencies:** 4.3.

**Files likely touched:**
- `tools/image-to-3d/app.py`
- `tools/image-to-3d/preprocessing.py`
- `tools/image-to-3d/tests/test_preprocessing.py`

**Estimated scope:** S.

---

#### Task 5.3: Batch-mode CLI

**Description:** `python convert.py --batch inputs/` walks the directory, runs each supported image through the chosen pipeline, writes each output to `public/models/generated/`. Skips unsupported files with a warning, continues on per-file errors, prints a final summary (N succeeded, M failed).

**Acceptance criteria:**
- [ ] `--batch <dir>` processes every JPG/PNG/WEBP in the directory
- [ ] A broken image in the middle doesn't stop the batch
- [ ] Summary prints counts and each failed file with its error

**Verification:**
- [ ] Batch of 3 fixture images: 3 GLBs written, 0 errors
- [ ] Batch of 3 + 1 broken: 3 GLBs written, 1 error logged, exit code non-zero

**Dependencies:** 4.3.

**Files likely touched:**
- `tools/image-to-3d/convert.py`

**Estimated scope:** S.

---

### Checkpoint 5 — Ship-ready

- [ ] README alone is enough to set up the tool from a fresh clone
- [ ] Both pipelines work, both are documented
- [ ] UI error surfacing is graceful
- [ ] Batch mode works
- [ ] **Human review:** one real concept sketch round-trips through the tool and lands in the game as a prop

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Trellis won't fit in 8 GB VRAM even with FP16 + CPU offload** | High | Task 4.2 has an explicit InstantMesh fallback. We'll know by Checkpoint 4; fallback is ~4 h of work, not a re-architecture. |
| **Windows wheels for `nvdiffrast` / `diff-gaussian-rasterization` missing** | High | Task 4.1 documents WSL2 fallback. If both paths fail on Windows, Trellis is cut and we use InstantMesh (no native kernels required). |
| **PyTorch + CUDA 12.x install mismatched with driver** | Med | Driver is 581.95 (supports CUDA 12.6 / 12.4 / 12.1). Pin to cu121 and document the exact `--extra-index-url` used. |
| **HuggingFace hub download interrupted mid-weight** | Low | Document cache-clear command in README. HF hub resumes partial downloads by default. |
| **First Gradio launch blocked by Windows Defender / firewall** | Low | Gradio prompts once; document the prompt in the README. |
| **Generated GLB has wrong orientation / scale in Babylon** | Low | Task 3.1 smoke test catches this. If systemic, add a `--rotate-x 90` post-process flag. |
| **Users commit `public/models/generated/*.glb` by accident** | Low | Root `.gitignore` entry in Task 0.1. |
| **rembg's ONNX runtime conflicts with PyTorch CUDA** | Med | Pin `onnxruntime-gpu` version that co-exists; document in requirements. |
| **Tool's Python deps drift from game's Node deps over time** | Low | Tool has its own `.gitignore` and venv; no cross-project dep pollution. |

## Decided Open Questions

- **Sidecar JSON:** YES. Task 1.3 now writes `<name>-<timestamp>.meta.json` alongside each GLB with source image path, pipeline name, model version, and generation timestamp.
- **Auto-decimation for Trellis output:** YES. Task 4.2 includes a post-process step using `trimesh.simplify.simplify_quadratic_decimation` to cap output at ~15 000 triangles (tunable). Game-friendly mesh by default; original high-poly saved to `*-source.glb` sidecar for future-proofing.
- **Subfolder UI control:** DEFERRED. Tracked in future specs.

## Open Questions (remaining)

- **Licensing of user-provided input images** — not our problem, but worth a one-liner in the README that the tool processes whatever you feed it and outputs derivatives.
- **Do we want the tool's tests in the game's Vitest suite?** No — Python test suite is pytest, run from within the tool's venv. Documented in README.

## Verification Before Starting

- [x] Every task has acceptance criteria
- [x] Every task has a verification step
- [x] Task dependencies identified and ordered (see graph above)
- [x] No task touches more than ~5 files
- [x] Checkpoints exist between major phases (5 of them)
- [ ] **Human final sign-off**
