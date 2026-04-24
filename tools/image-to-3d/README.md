# image-to-3d

Local tool that turns a 2-D image into a 3-D GLB, straight into the game's
`public/models/generated/` folder where Babylon can `ImportMeshAsync` it.

Pipelines (selectable in the UI and CLI):

- **TripoSR** (MIT) — fast path, ~2 GB VRAM, seconds per image.
- **Trellis** (MIT) — quality path, ~8–12 GB VRAM, ~60 s per image.

Fully offline after the first weight download.

Planning docs live in `tasks/image-to-3d-plan.md` and
`tasks/image-to-3d-todo.md`. Full setup + troubleshooting are added in
Task 5.1; until then this is a stub.
