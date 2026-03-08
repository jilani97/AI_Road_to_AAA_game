# Babylon Stealth Prototype

A browser-based `TypeScript + Vite + Babylon.js` starter inspired by the stealth/platforming feel of games like `Sly 3`.

## Features

- Third-person movement relative to camera facing
- Patrol guard with vision-cone stealth detection
- Collectible objective and win/fail states
- Lightweight HUD and restart loop
- Unit-tested stealth math helpers with `Vitest`

## Quick Start

```bash
cd "c:/Users/ilham/Documents/AI Project"
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

- `W/A/S/D`: move
- `Shift`: sprint
- `Right mouse drag`: orbit camera
- `Mouse wheel`: zoom
- `R`: restart after win/fail

## Project Layout

- `src/main.ts`: bootstraps the app shell
- `src/game/GameApp.ts`: Babylon scene, player, guard, gameplay loop
- `src/game/stealth.ts`: vision-cone logic and helpers
- `tests/stealth.test.ts`: quick validation for stealth math

## Next Up

Good next iterations:

1. Add jump/climb traversal and ledges
2. Swap primitives for `glb` placeholder assets
3. Add multiple guards and patrol routes
4. Add level data loaded from JSON or Blender exports
5. Add sound effects and gamepad support
