"""Gradio web UI for the image-to-3D converter.

Usage:
    .venv/Scripts/python app.py

Opens at http://127.0.0.1:7860 — drag-drop an image, pick a pipeline,
click Generate. Output GLBs land in ``public/models/generated/`` (same
contract as the CLI).

Task 2.1 scope: the layout and the stubbed handler that echoes inputs.
Real TripoSR integration lands in Task 2.2; download + save controls
in 2.3; Trellis option in 4.3.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import gradio as gr
from PIL import Image

_LOG = logging.getLogger("image-to-3d.app")

PIPELINE_CHOICES: list[tuple[str, str]] = [
    ("TripoSR — fast, low VRAM (~15 s/image on RTX 2000 Ada)", "triposr"),
    ("InstantMesh — multi-view fusion (~30–60 s, ~6.5 GB weights, vertex colours)", "instantmesh"),
    ("Trellis — quality, higher VRAM (Phase 4 — not yet implemented)", "trellis"),
]


def _generate(
    image: Optional[Image.Image],
    pipeline_name: str,
    remove_background: bool,
    progress: gr.Progress = gr.Progress(),  # noqa: B008 — Gradio-injected
):
    """Run the selected pipeline end-to-end on the uploaded image.

    Returns ``(glb_path, status_text, glb_path_display, download_update)`` —
    Gradio binds them into the Model3D viewer, the status textbox, the
    on-disk path textbox, and the Download button (whose visibility and
    underlying file are toggled by ``gr.update``). ``glb_path`` doubles
    as the Model3D source when it's a real filesystem path.
    """
    if image is None:
        raise gr.Error("Drop an image before clicking Generate.")
    if pipeline_name == "trellis":
        raise gr.Error(
            "Trellis is not yet implemented (Phase 4). Use TripoSR or InstantMesh."
        )
    if pipeline_name not in ("triposr", "instantmesh"):
        raise gr.Error(f"Unknown pipeline: {pipeline_name!r}")

    # Deferred imports so boot doesn't pay any pipeline's load-on-first-call cost.
    from output import (
        export_scene_to_glb,
        resolve_output_path,
        write_sidecar_meta,
    )
    from preprocessing import preprocess_image

    start = time.perf_counter()

    try:
        progress(0.05, desc="Preprocessing image…")
        preprocessed = preprocess_image(image, remove_background=remove_background)

        if pipeline_name == "triposr":
            from pipelines.triposr import TripoSRPipeline

            progress(0.25, desc="Loading TripoSR + running inference…")
            pipeline = TripoSRPipeline()
            scene = pipeline.generate(preprocessed)
            extra: dict[str, object] = {
                "chunk_size": pipeline.chunk_size,
                "mc_resolution": pipeline.mc_resolution,
                "device": pipeline.device,
            }
        else:
            from pipelines.instantmesh import InstantMeshPipeline

            # Map pipeline-internal progress (0..1) to UI band 0.20..0.85.
            def _on_stage(fraction: float, message: str) -> None:
                progress(0.20 + fraction * 0.65, desc=message)

            pipeline = InstantMeshPipeline(progress_callback=_on_stage)
            progress(0.20, desc="Starting InstantMesh…")
            scene = pipeline.generate(preprocessed)
            extra = {
                "config_name": pipeline.config_name,
                "diffusion_steps": pipeline.diffusion_steps,
                "scale": pipeline.scale,
                "seed": pipeline.seed,
                "device": pipeline.device,
            }

        progress(0.85, desc="Exporting GLB + sidecar…")
        out_path = resolve_output_path("ui")
        export_scene_to_glb(scene, out_path)
        meta_path = write_sidecar_meta(
            out_path,
            source_image=Path("ui-upload"),
            pipeline=pipeline_name,
            scene=scene,
            extra={
                **extra,
                "remove_background": remove_background,
                "input_size": list(image.size),
            },
        )
        progress(1.0, desc="Done")
    except Exception as exc:
        _LOG.exception("generation failed")
        # Gradio's gr.Error surfaces as a toast in the UI.
        raise gr.Error(f"Generation failed: {exc}") from exc

    elapsed = time.perf_counter() - start
    tri_count = sum(
        int(getattr(m, "faces", []).shape[0])
        for m in scene.geometry.values()
        if hasattr(m, "faces")
    )
    status = (
        f"OK — {pipeline_name} generated a mesh in {elapsed:.1f} s "
        f"({tri_count:,} triangles).\nSidecar: {meta_path.name}"
    )
    _LOG.info(status.replace("\n", " · "))
    return (
        str(out_path),
        status,
        str(out_path),
        gr.update(value=str(out_path), visible=True),
    )


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="image-to-3d") as demo:
        gr.Markdown(
            """
            # image-to-3d
            Drop a reference image, pick a pipeline, click **Generate**. Output
            GLBs land in `public/models/generated/` — the Babylon game can
            `ImportMeshAsync` them without copying.
            """
        )

        with gr.Row():
            with gr.Column(scale=1):
                image_input = gr.Image(
                    type="pil",
                    label="Reference image",
                    sources=["upload", "clipboard"],
                    height=380,
                )
                pipeline_radio = gr.Radio(
                    choices=PIPELINE_CHOICES,
                    value="triposr",
                    label="Pipeline",
                )
                remove_bg_checkbox = gr.Checkbox(
                    value=True,
                    label="Auto-remove background (rembg)",
                    info="Uncheck when the input is already a clean transparent PNG.",
                )
                generate_btn = gr.Button("Generate", variant="primary", size="lg")

            with gr.Column(scale=1):
                model_output = gr.Model3D(
                    label="Generated mesh",
                    height=460,
                    clear_color=[0.02, 0.04, 0.09, 1.0],
                )
                status = gr.Textbox(
                    label="Status",
                    lines=3,
                    interactive=False,
                    value="Ready.",
                )
                path_output = gr.Textbox(
                    label="Output path (click to select, Ctrl+C to copy)",
                    interactive=False,
                    placeholder="Will be filled with the GLB path after Generate.",
                )
                download_btn = gr.DownloadButton(
                    label="Download GLB",
                    visible=False,
                )

        generate_btn.click(
            fn=_generate,
            inputs=[image_input, pipeline_radio, remove_bg_checkbox],
            outputs=[model_output, status, path_output, download_btn],
        )

        gr.Markdown(
            """
            Pipelines: **TripoSR** (MIT, fast), **InstantMesh**
            (Apache 2.0, multi-view fusion via Zero123++, vertex colours),
            **Trellis** (MIT, quality — Phase 4, not yet implemented).
            First TripoSR call downloads ~1.6 GB of weights; first InstantMesh
            call ~6.5 GB. Run `convert.py --prefetch-weights instantmesh`
            ahead of time to avoid the surprise. Offline after the cache fills.
            """
        )

    return demo


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    demo = build_ui()
    demo.launch(
        server_name="127.0.0.1",
        server_port=7860,
        inbrowser=False,
        theme=gr.themes.Soft(),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
