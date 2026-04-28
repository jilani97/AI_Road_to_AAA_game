"""Bake a normal map from a GLB's baseColor texture using Marigold-Normals.

Path A experiment for closing the PBR ceiling on TRELLIS GLBs: feed the UV
atlas to a normal-map estimator trained on photos, write the result into the
glTF normalTexture slot. Per-island interiors will look plausible; UV island
seams will show artefacts (the model treats black gutters as cliffs). This
is a quick-experiment tool — for clean seams, use the multi-view re-bake
path (Option B).

Usage:
    python normal_bake.py <input.glb> [<output.glb>]
"""
import sys
import time
from pathlib import Path

import numpy as np
import torch
import trimesh
from PIL import Image
from diffusers import MarigoldNormalsPipeline

MODEL_ID = 'prs-eth/marigold-normals-v0-1'


def main() -> None:
    if len(sys.argv) < 2:
        print('usage: normal_bake.py <input.glb> [<output.glb>]', file=sys.stderr)
        sys.exit(2)
    glb_in = Path(sys.argv[1])
    glb_out = Path(sys.argv[2]) if len(sys.argv) >= 3 else glb_in.with_name(glb_in.stem + '-pbr.glb')
    if not glb_in.is_file():
        raise SystemExit(f'input not found: {glb_in}')

    print(f'[normal-bake] loading {glb_in}', flush=True)
    scene = trimesh.load(str(glb_in), process=False)
    geoms = list(scene.geometry.values())
    if len(geoms) != 1:
        print(f'[normal-bake] expected 1 geometry, found {len(geoms)} — using the first', flush=True)
    geom = geoms[0]
    material = geom.visual.material
    base_color = material.baseColorTexture
    if base_color is None:
        raise SystemExit('GLB has no baseColorTexture')
    print(f'[normal-bake] baseColor: {base_color.size} {base_color.mode}', flush=True)

    print(f'[normal-bake] loading Marigold-Normals ({MODEL_ID})', flush=True)
    t0 = time.perf_counter()
    pipe = MarigoldNormalsPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.float16).to('cuda')
    print(f'[normal-bake] pipeline ready in {time.perf_counter() - t0:.1f}s', flush=True)

    print('[normal-bake] running inference', flush=True)
    t1 = time.perf_counter()
    result = pipe(base_color.convert('RGB'))
    print(f'[normal-bake] inference done in {time.perf_counter() - t1:.1f}s', flush=True)

    pred = result.prediction
    if isinstance(pred, (list, tuple)):
        pred = pred[0]
    if isinstance(pred, torch.Tensor):
        pred = pred.detach().cpu().numpy()
    if pred.ndim == 4:
        pred = pred[0]
    if pred.ndim == 3 and pred.shape[0] == 3:
        pred = pred.transpose(1, 2, 0)
    print(f'[normal-bake] normal: shape={pred.shape}, dtype={pred.dtype}, range=[{pred.min():.3f}, {pred.max():.3f}]', flush=True)

    normal_rgb = ((pred + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
    normal_pil = Image.fromarray(normal_rgb, mode='RGB')

    if normal_pil.size != base_color.size:
        print(f'[normal-bake] resizing normal {normal_pil.size} -> {base_color.size}', flush=True)
        normal_pil = normal_pil.resize(base_color.size, Image.LANCZOS)

    material.normalTexture = normal_pil

    print(f'[normal-bake] writing {glb_out}', flush=True)
    glb_out.parent.mkdir(parents=True, exist_ok=True)
    scene.export(str(glb_out))
    print('[normal-bake] DONE', flush=True)


if __name__ == '__main__':
    main()
