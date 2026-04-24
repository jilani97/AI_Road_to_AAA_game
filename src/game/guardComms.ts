import type { Difficulty } from './settings';
import type { GuardState } from './guardAi';

/** Guard-to-guard communication radius per difficulty (metres, XZ plane).
 *  Plan Task 4 Q13 / Task 4c: Easy isolated, Medium proximity shout 10 m,
 *  Hard full walkie-talkie (every map guard hears). */
export const COMMS_RADIUS: Record<Difficulty, number> = {
  easy: 0,
  medium: 10,
  hard: Infinity,
};

/** A candidate listener evaluated by `shouldDropIntoInvestigating`. */
export interface CommsListener {
  /** XZ distance in metres from the alerted sender. */
  distance: number;
  state: GuardState;
  /** Knocked-out guards never hear comms. */
  isKnockedOut: boolean;
}

/** True when this listener should drop into `investigating` as a result of
 *  the sender going `alerted`. Skips guards already escalated (alerted /
 *  chasing / investigating), knocked out, or out of range. Easy's radius is
 *  0 so no listener qualifies — matches "each guard is isolated". */
export function shouldDropIntoInvestigating(
  listener: CommsListener,
  difficulty: Difficulty,
): boolean {
  const radius = COMMS_RADIUS[difficulty];
  if (radius <= 0) return false;
  if (listener.isKnockedOut) return false;
  if (
    listener.state === 'alerted' ||
    listener.state === 'chasing' ||
    listener.state === 'investigating'
  ) {
    return false;
  }
  return listener.distance <= radius;
}
