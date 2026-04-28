"""One-off TRELLIS inference for the hudhud-relax test (Phase 4 spike)."""
import os
os.environ['ATTN_BACKEND'] = 'xformers'
os.environ['SPCONV_ALGO'] = 'native'

import sys
import time
from datetime import datetime
from pathlib import Path
from PIL import Image

TRELLIS_DIR = '/mnt/c/Users/ilham.jillani/Documents/Visma/AI_Road_to_AAA_game/tools/image-to-3d/external/TRELLIS'
sys.path.insert(0, TRELLIS_DIR)

from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils

INPUT = '/mnt/c/Users/ilham.jillani/Documents/Visma/AI_Road_to_AAA_game/tools/image-to-3d/inputs/hudhud-relax.png'
OUT_DIR = Path('/mnt/c/Users/ilham.jillani/Documents/Visma/AI_Road_to_AAA_game/public/models/generated')
OUT_DIR.mkdir(parents=True, exist_ok=True)
ts = datetime.now().strftime('%Y%m%d-%H%M%S-') + f'{datetime.now().microsecond // 1000:03d}'
OUT_GLB = OUT_DIR / f'hudhud-relax-trellis-hq-{ts}.glb'

print(f'[trellis] loading TrellisImageTo3DPipeline from microsoft/TRELLIS-image-large ...', flush=True)
t0 = time.perf_counter()
pipeline = TrellisImageTo3DPipeline.from_pretrained('microsoft/TRELLIS-image-large')
pipeline.cuda()
print(f'[trellis] pipeline ready in {time.perf_counter() - t0:.1f}s', flush=True)

image = Image.open(INPUT)
print(f'[trellis] running inference on {INPUT} (size={image.size}, mode={image.mode})', flush=True)
t1 = time.perf_counter()
outputs = pipeline.run(
    image,
    seed=42,
    sparse_structure_sampler_params={'steps': 50, 'cfg_strength': 7.5},
    slat_sampler_params={'steps': 50, 'cfg_strength': 3.0},
)
print(f'[trellis] inference done in {time.perf_counter() - t1:.1f}s', flush=True)

print(f'[trellis] exporting textured GLB to {OUT_GLB}', flush=True)
glb = postprocessing_utils.to_glb(
    outputs['gaussian'][0],
    outputs['mesh'][0],
    simplify=0.9,
    texture_size=2048,
)
glb.export(str(OUT_GLB))
print(f'[trellis] DONE. total {time.perf_counter() - t0:.1f}s', flush=True)
print(f'GLB: {OUT_GLB}', flush=True)
