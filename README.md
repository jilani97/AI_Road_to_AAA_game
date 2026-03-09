# Neon Tail: The Midnight Syndicate

A browser-based `TypeScript + Vite + Babylon.js` stealth-platformer inspired by the "Gentleman Thief" aesthetic of *Sly Cooper* — noir atmosphere, high-stakes heist platforming, and an anthropomorphic Hoopoe (Hud-hud) equipped with a tactical stealth suit.

## The Protagonist — "Midnight" the Hud-hud

An elegant, highly intelligent bird with bold black, white, and orange-cinnamon plumage. They wear a streamlined tactical suit of matte carbon fiber plating with subtle glowing blue vents and utility pouches. The right eye features a glowing cyan ocular implant. Their mechanical talon leg enhancements provide immense grip for parkour, and integrated micro-thrusters in their folding glider mantle allow for incredible directed lift. 

## The Story — The Chronos Heist (Act I)

Baron von Steer (a massive cybernetic Bull) owns **Liquid Time** — a substance that lets its owner rewind mistakes. He used it to frame Midnight's mentor. You are here to steal it back.

**Act I — The Rainy Rooftops:** Infiltrate the Baron's gala on a Neo-Middle Eastern rooftop, plant a tracker on his cane, and secure the Liquid Time sample — all without being spotted by the Baron's crimson guards.

## Gameplay Pillars

- **Sonic-Crestal Sonar**: Holding a trigger "spreads" the character's signature crest, initiating a pulsed sonar. This detects and highlights guard positions in a 360-degree radius. When the crest is lowered, detection stops to preserve intense stealth gameplay.
- **Ascension Dash**: Instead of horizontal jumping, the character utilizes an "ascension" dash using micro-thrusters and their wings. This creates a vertical parkour experience. 
- **Prehensile Talon/Feather Mantle**: The suit has a small retractable metallic hook in the leg harness, allowing brief "mantling" (hanging) under horizontal surfaces.
- **Vertical Stealth**: Guards have reduced detection when the Hud-hud is on high ground. 

## Features

- Third-person movement relative to camera facing
- Ascension Dash parkour loop focusing on vertical traversal
- Patrol guard with vision-cone stealth detection
- Elevation stealth bonus — reduced guard vision from high ground
- Sonic-Crestal Sonar mechanic — crest dynamically snaps open / narrows, HUD status tracking
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
- `Space`: ascension dash
- `Shift`: sprint
- `Right mouse drag`: orbit camera
- `Mouse wheel`: zoom
- `R`: restart after win/fail

## Project Layout

- `src/main.ts`: bootstraps the app shell and HUD
- `src/game/GameApp.ts`: Babylon scene, character, guard, gameplay loop
- `src/game/stealth.ts`: vision-cone logic, helpers, Sonar `soundDirection`
- `tests/stealth.test.ts`: validation for stealth and Sonar math

## Next Up

1. Add Act II — The Iron Transit (maglev train kinetic platforming)
2. Swap primitives for `glb` placeholder assets (Hud-hud silhouette)
3. Add multiple guards and patrol routes
4. Add the talon/hook rail-grind & mantle mechanic
5. Add sound effects, rain particles, and gamepad support
