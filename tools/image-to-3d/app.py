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
from pathlib import Path
from typing import Optional

import gradio as gr
from PIL import Image

_LOG = logging.getLogger("image-to-3d.app")

PIPELINE_CHOICES: list[tuple[str, str]] = [
    ("TripoSR — fast, low VRAM (~15 s/image on RTX 2000 Ada)", "triposr"),
    ("Trellis — quality, higher VRAM (Phase 4 — not yet implemented)", "trellis"),
]


def _stub_generate(
    image: Optional[Image.Image],
    pipeline_name: str,
    remove_background: bool,
) -> tuple[Optional[str], str, str]:
    """Task 2.1 placeholder — no model inference yet. Replaced in 2.2."""
    if image is None:
        return None, "Drop an image first.", ""

    w, h = image.size
    stub_msg = (
        f"stub: would run `{pipeline_name}` on a {w}×{h} image "
        f"(remove_background={remove_background}). "
        "Real inference wires in at Task 2.2."
    )
    _LOG.info(stub_msg)
    return None, stub_msg, ""


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="image-to-3d", theme=gr.themes.Soft()) as demo:
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
                    label="Output path",
                    interactive=False,
                    placeholder="Will be filled with the GLB path after Generate.",
                )

        generate_btn.click(
            fn=_stub_generate,
            inputs=[image_input, pipeline_radio, remove_bg_checkbox],
            outputs=[model_output, status, path_output],
        )

        gr.Markdown(
            """
            Pipeline: **TripoSR** (MIT, fast), **Trellis** (MIT, quality —
            Phase 4, not yet implemented). First TripoSR call downloads
            ~1.6 GB of weights into the HuggingFace cache — offline after that.
            """
        )

    return demo


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    demo = build_ui()
    demo.launch(server_name="127.0.0.1", server_port=7860, inbrowser=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
