# Neon Tail: The Midnight Syndicate

A browser-based `TypeScript + Vite + Babylon.js` stealth-platformer inspired by the "Gentleman Thief" aesthetic of *Sly Cooper* — noir atmosphere, high-stakes heist platforming, and a Long-Eared Jerboa with spring-loaded legs.

## The Protagonist — Jax "The Ghost" Vales

A Long-Eared Jerboa wearing a high-collar sleeveless tech-vest and a cracked **neon monocle** that highlights guard positions. His powerful legs launch him to elevated platforms; his tail-hook swings him across gaps. Over-confident, fast-talking, deeply loyal to his crew.

## The Story — The Chronos Heist (Act I)

Baron von Steer (a massive cybernetic Bull) owns **Liquid Time** — a substance that lets its owner rewind mistakes. He used it to frame Jax's mentor. Jax is here to steal it back.

**Act I — The Rainy Rooftops:** Infiltrate the Baron's gala on a Neo-Paris rooftop, plant a tracker on his cane, and secure the Liquid Time sample — all without being spotted by the Baron's crimson guards.

## Gameplay Pillars

- **Ear-dar**: Jax's ears rotate toward the loudest guard footsteps, giving players a real-time directional audio cue without a minimap.
- **Vertical Stealth**: Guards have 40% reduced detection range when Jax is on high ground. The floor is the danger; pipes and wire bridges are the safe zones.
- **Jump**: Jax's spring-like legs let him leap to the elevated pipe platform and wire bridge.

## Features

- Third-person movement relative to camera facing
- Jump with realistic vertical velocity + gravity physics
- Patrol guard with vision-cone stealth detection
- Elevation stealth bonus — reduced guard vision from high ground
- Ear-dar mechanic — ears rotate toward guard, HUD footstep indicator
- Amber Liquid Time sample with win / fail states
- Lightweight HUD with restart loop
- Unit-tested stealth math helpers with `Vitest`

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

- `W/A/S/D`: move
- `Space`: jump
- `Shift`: sprint
- `Right mouse drag`: orbit camera
- `Mouse wheel`: zoom
- `R`: restart after win/fail

## Project Layout

- `src/main.ts`: bootstraps the app shell and HUD
- `src/game/GameApp.ts`: Babylon scene, Jax, guard, gameplay loop
- `src/game/stealth.ts`: vision-cone logic, helpers, Ear-dar `soundDirection`
- `tests/stealth.test.ts`: validation for stealth and Ear-dar math

## Next Up

1. Add Act II — The Iron Transit (maglev train kinetic platforming)
2. Swap primitives for `glb` placeholder assets (Jax's jerboa silhouette)
3. Add multiple guards and patrol routes
4. Add the tail-hook rail-grind / swing mechanic
5. Add sound effects, rain particles, and gamepad support
