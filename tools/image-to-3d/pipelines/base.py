"""Abstract base class every image-to-3D pipeline implements.

Keeps `convert.py` and `app.py` ignorant of model internals — they pick a
pipeline by name, hand it a preprocessed RGBA image, and receive a
``trimesh.Scene`` that can be written to GLB.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

import trimesh
from PIL import Image


class Pipeline(ABC):
    """Interface for a 2-D → 3-D pipeline. Subclasses are expected to cache
    their loaded model on first call so repeated inferences in one process
    don't pay the weight-load cost twice."""

    name: ClassVar[str]
    """Stable id used in the UI / CLI to pick this pipeline."""

    @abstractmethod
    def generate(self, image: Image.Image) -> trimesh.Scene:
        """Run inference on the preprocessed image and return a scene.

        ``image`` is always RGBA, already resized by ``preprocessing.load_and_prepare``.
        The returned scene contains at least one mesh. Vertex colours and/or
        textures are preserved when the pipeline produces them.
        """
        raise NotImplementedError
