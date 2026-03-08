export interface Vector2Like {
  x: number;
  z: number;
}

export interface VisionCheckInput {
  guardPosition: Vector2Like;
  guardForward: Vector2Like;
  targetPosition: Vector2Like;
  maxDistance: number;
  fovRadians: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalize2(value: Vector2Like): Vector2Like {
  const length = Math.hypot(value.x, value.z);

  if (length === 0) {
    return { x: 0, z: 0 };
  }

  return {
    x: value.x / length,
    z: value.z / length,
  };
}

export function dot2(left: Vector2Like, right: Vector2Like): number {
  return left.x * right.x + left.z * right.z;
}

export function distance2(left: Vector2Like, right: Vector2Like): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

export function isTargetVisible(input: VisionCheckInput): boolean {
  const distance = distance2(input.guardPosition, input.targetPosition);

  if (distance > input.maxDistance) {
    return false;
  }

  const forward = normalize2(input.guardForward);
  const toTarget = normalize2({
    x: input.targetPosition.x - input.guardPosition.x,
    z: input.targetPosition.z - input.guardPosition.z,
  });

  const cosine = clamp(dot2(forward, toTarget), -1, 1);
  const angle = Math.acos(cosine);

  return angle <= input.fovRadians * 0.5;
}

/** Returns the normalised 2-D direction from a listener toward a sound source.
 *  Used by the Ear-dar mechanic to rotate Jax's ears toward guard footsteps.
 */
export function soundDirection(listenerPosition: Vector2Like, soundPosition: Vector2Like): Vector2Like {
  return normalize2({
    x: soundPosition.x - listenerPosition.x,
    z: soundPosition.z - listenerPosition.z,
  });
}
