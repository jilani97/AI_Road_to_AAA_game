import type { Difficulty } from './settings';

export type GuardState =
  | 'patrol'
  | 'suspicious'
  | 'investigating'
  | 'alerted'
  | 'chasing'
  | 'returning';

/** Time thresholds keyed by difficulty. Values in seconds. Source: tasks/plan.md Task 4. */
export const PATROL_TO_SUSPICIOUS_SECONDS: Record<Difficulty, number> = {
  easy: 1.0,
  medium: 0.5,
  hard: 0.2,
};

export const SUSPICIOUS_TO_ALERTED_SECONDS: Record<Difficulty, number> = {
  easy: 1.5,
  medium: 0.8,
  hard: 0.3,
};

/** How long the guard will stay alerted after losing sight before giving up to investigating. */
export const ALERTED_GIVE_UP_SECONDS: Record<Difficulty, number> = {
  easy: 3,
  medium: 6,
  hard: 10,
};

/** Total time a guard spends in `investigating` before heading back to patrol. */
export const INVESTIGATION_BUDGET_SECONDS = 6;

/** Brief "caught you" pause between `alerted` (stops and raises weapon) and `chasing` (moves). */
export const ALERTED_TO_CHASING_SECONDS = 0.3;

/** Time a guard spends in `returning` before declaring themselves back on patrol.
 *  Integration layer can short-circuit this when close to the patrol path. */
export const RETURNING_TO_PATROL_SECONDS = 4;

export interface GuardAiState {
  state: GuardState;
  /** Continuous seconds of visibility in the current state — drives patrol→suspicious→alerted. */
  sustainedVisibleSeconds: number;
  /** Seconds since vision was last lost while alerted/chasing — drives the give-up timer. */
  timeSinceLostSight: number;
  /** Accumulated seconds in `investigating` — compared against `INVESTIGATION_BUDGET_SECONDS`. */
  timeInvestigating: number;
  /** Accumulated seconds in `alerted` — used for the brief `alerted`→`chasing` transition. */
  timeInAlerted: number;
  /** Accumulated seconds in `returning` — compared against `RETURNING_TO_PATROL_SECONDS`. */
  timeInReturning: number;
}

export interface GuardAiTick {
  /** Whether the guard has line-of-sight on the player this tick. */
  visible: boolean;
  /** Whether a noise event arrived within the guard's hearing radius this tick. */
  noiseHeard: boolean;
  /** Whether the integration layer has confirmed the guard reached the last-known position
   *  (used by `investigating` to shorten the state if the search completes early). */
  reachedLastKnownPosition?: boolean;
  /** Whether the guard is close enough to their patrol path to declare `returning` complete. */
  nearPatrolPath?: boolean;
  difficulty: Difficulty;
  /** Seconds elapsed since the previous tick. */
  dt: number;
}

export function initialGuardAiState(state: GuardState = 'patrol'): GuardAiState {
  return {
    state,
    sustainedVisibleSeconds: 0,
    timeSinceLostSight: 0,
    timeInvestigating: 0,
    timeInAlerted: 0,
    timeInReturning: 0,
  };
}

function enter(nextState: GuardState): GuardAiState {
  return initialGuardAiState(nextState);
}

/** Deterministic, side-effect-free state transition. The integration layer owns movement
 *  (where the guard walks, how fast); this function owns only the awareness tier. */
export function tickGuardAi(current: GuardAiState, input: GuardAiTick): GuardAiState {
  const { visible, noiseHeard, difficulty, dt } = input;

  switch (current.state) {
    case 'patrol': {
      if (visible) {
        const accumulated = current.sustainedVisibleSeconds + dt;
        if (accumulated >= PATROL_TO_SUSPICIOUS_SECONDS[difficulty]) {
          return enter('suspicious');
        }
        return { ...current, sustainedVisibleSeconds: accumulated };
      }
      if (noiseHeard) {
        return enter('suspicious');
      }
      return { ...current, sustainedVisibleSeconds: 0 };
    }

    case 'suspicious': {
      if (visible) {
        const accumulated = current.sustainedVisibleSeconds + dt;
        if (accumulated >= SUSPICIOUS_TO_ALERTED_SECONDS[difficulty]) {
          return enter('alerted');
        }
        return { ...current, sustainedVisibleSeconds: accumulated };
      }
      // No renewed contact — go check the last known position.
      return enter('investigating');
    }

    case 'investigating': {
      if (visible) {
        // Renewed contact — skip back up to alerted.
        return enter('alerted');
      }
      if (noiseHeard) {
        // Noise resets the investigation clock; the guard stays in investigating
        // but has something fresh to chase (integration layer picks the new LKP).
        return { ...current, timeInvestigating: 0 };
      }
      const accumulated = current.timeInvestigating + dt;
      if (accumulated >= INVESTIGATION_BUDGET_SECONDS || input.reachedLastKnownPosition) {
        return enter('returning');
      }
      return { ...current, timeInvestigating: accumulated };
    }

    case 'alerted': {
      if (!visible) {
        const lostFor = current.timeSinceLostSight + dt;
        if (lostFor >= ALERTED_GIVE_UP_SECONDS[difficulty]) {
          return enter('investigating');
        }
        return { ...current, timeSinceLostSight: lostFor };
      }
      // Still has the player — reset the give-up timer and consider promoting to chasing.
      const inAlerted = current.timeInAlerted + dt;
      if (inAlerted >= ALERTED_TO_CHASING_SECONDS) {
        return enter('chasing');
      }
      return { ...current, timeInAlerted: inAlerted, timeSinceLostSight: 0 };
    }

    case 'chasing': {
      if (!visible) {
        const lostFor = current.timeSinceLostSight + dt;
        if (lostFor >= ALERTED_GIVE_UP_SECONDS[difficulty]) {
          return enter('investigating');
        }
        return { ...current, timeSinceLostSight: lostFor };
      }
      return { ...current, timeSinceLostSight: 0 };
    }

    case 'returning': {
      if (visible) {
        return enter('alerted');
      }
      if (noiseHeard) {
        return enter('suspicious');
      }
      const accumulated = current.timeInReturning + dt;
      if (accumulated >= RETURNING_TO_PATROL_SECONDS || input.nearPatrolPath) {
        return enter('patrol');
      }
      return { ...current, timeInReturning: accumulated };
    }
  }
}

/** Small convenience for the integration layer — the icon shown above the guard
 *  mirrors the spec's "dot / question / exclaim" belt-and-suspenders rule. */
export function guardStateIcon(state: GuardState): '.' | '?' | '!' {
  switch (state) {
    case 'patrol':
    case 'returning':
      return '.';
    case 'suspicious':
    case 'investigating':
      return '?';
    case 'alerted':
    case 'chasing':
      return '!';
  }
}
