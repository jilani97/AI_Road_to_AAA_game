import type { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import { initialGuardAiState, type GuardAiState } from './guardAi';

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
  /** Visual mesh (hitbox capsule; the loaded Golem GLB parents to this). */
  mesh: Mesh;
  /** Coloured vision cone parented to the pivot — tint tracks the AI state. */
  visionCone: Mesh;
  /** Authored patrol route this guard walks when idle. */
  patrolPoints: Vector3[];
  ai: GuardAiState;
  activePatrolIndex: number;
  /** Latest position the player was seen or heard from — drives investigating. */
  lastKnownPlayerPosition: Vector3 | null;
  /** Non-null while knocked out. */
  knockdown: GuardKnockdown | null;
  /** How many times this guard has been knocked out this run — feeds coin scaling. */
  knockoutCount: number;
}

export function createGuard(
  pivot: TransformNode,
  mesh: Mesh,
  visionCone: Mesh,
  patrolPoints: Vector3[],
): Guard {
  return {
    pivot,
    mesh,
    visionCone,
    patrolPoints,
    ai: initialGuardAiState(),
    activePatrolIndex: 0,
    lastKnownPlayerPosition: null,
    knockdown: null,
    knockoutCount: 0,
  };
}

/** Resets a guard to its initial patrol-state defaults. Preserves scene-graph
 *  handles (pivot/mesh/visionCone/patrolPoints) — only AI bookkeeping resets. */
export function resetGuard(guard: Guard): void {
  guard.ai = initialGuardAiState();
  guard.activePatrolIndex = 0;
  guard.lastKnownPlayerPosition = null;
  guard.knockdown = null;
  guard.knockoutCount = 0;
}
