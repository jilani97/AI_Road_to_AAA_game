import type { AnimationGroup, Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import { initialGuardAiState, type GuardAiState } from './guardAi';
import type { PatrolZone } from './guardPatrol';

/** Animation slots each guard's rig supports. Bindings (file → slot) are
 *  resolved per guard at GLB import time via `findGuardAnimationName`. */
export type GuardAnimationRole = 'idle' | 'patrol' | 'alert' | 'hit' | 'defeated';

/** Knockout state for a single guard — persists until `remainingSeconds` drains.
 *  `Infinity` means permanent (Easy difficulty). `pendingRescind` holds the coin
 *  amount that will be refunded from the player's purse if the guard wakes on Hard. */
export interface GuardKnockdown {
  remainingSeconds: number;
  pendingRescind: number;
}

/** Noise events queued for guard hearing this frame. Multiple guards evaluate the
 *  same list so a loud action near one guard can also be heard by a neighbour. */
export interface NoiseEvent {
  origin: Vector3;
  radius: number;
}

/** A single guard — scene-graph handles + AI bookkeeping. Behaviour (movement,
 *  hearing, damage) lives in GameApp; this interface is the data contract.
 *
 *  Introduced by Task 6b as the pure refactor step: GameApp previously held one
 *  guard's state in flat `guardPivot` / `guardAi` / `guardKnockdown` fields. */
export interface Guard {
  /** Scene-graph parent — position and Y-rotation live here. */
  pivot: TransformNode;
  /** Visual mesh (hitbox capsule; the loaded Golem GLB parents to this, or a
   *  tinted capsule for placeholder reinforcement guards in Task 6c). */
  mesh: Mesh;
  /** Coloured vision cone parented to the pivot — tint tracks the AI state. */
  visionCone: Mesh;
  /** Zone this guard patrols within. Task 6c — "zones with semi-random
   *  wandering" replaces the hand-authored patrol loop. */
  zone: PatrolZone;
  /** The next XZ point this guard is walking to. Regenerated on arrival via
   *  `nextPatrolWaypoint`; the Y is resolved from terrain each tick. */
  currentPatrolTarget: Vector3;
  ai: GuardAiState;
  /** Latest position the player was seen or heard from — drives investigating. */
  lastKnownPlayerPosition: Vector3 | null;
  /** Non-null while knocked out. */
  knockdown: GuardKnockdown | null;
  /** How many times this guard has been knocked out this run — feeds coin scaling. */
  knockoutCount: number;
  /** Animation groups from this guard's Golem GLB — populated asynchronously.
   *  Empty until the rig finishes importing. */
  animations: Map<string, AnimationGroup>;
  /** Resolved name-per-role for this guard's animation groups. */
  animationBindings: Partial<Record<GuardAnimationRole, string>>;
  /** Name of the currently-playing animation group, or '' if none. */
  currentAnimationName: string;
}

export function createGuard(
  pivot: TransformNode,
  mesh: Mesh,
  visionCone: Mesh,
  zone: PatrolZone,
  initialTarget: Vector3,
): Guard {
  return {
    pivot,
    mesh,
    visionCone,
    zone,
    currentPatrolTarget: initialTarget,
    ai: initialGuardAiState(),
    lastKnownPlayerPosition: null,
    knockdown: null,
    knockoutCount: 0,
    animations: new Map(),
    animationBindings: {},
    currentAnimationName: '',
  };
}

/** Resets a guard's AI bookkeeping. Preserves scene-graph handles and zone —
 *  the caller is responsible for picking a fresh `currentPatrolTarget`. */
export function resetGuard(guard: Guard): void {
  guard.ai = initialGuardAiState();
  guard.lastKnownPlayerPosition = null;
  guard.knockdown = null;
  guard.knockoutCount = 0;
}
