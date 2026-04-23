export type CharacterId = 'midnight' | 'ironclaw' | 'kestrel';

export interface CharacterStats {
  /** Integer base HP at the chosen character (before difficulty adjustments). */
  hp: number;
  /** Multiplier applied to `PLAYER_SPEED` (1.0 = baseline). */
  speedMultiplier: number;
  /** Multiplier applied to jump impulse (1.0 = baseline). */
  jumpMultiplier: number;
  /** Multiplier applied to `SONAR_RANGE`. Negative deltas welcome. */
  sonarRangeMultiplier: number;
  /** Multiplier applied to outgoing weapon damage (1.0 = baseline). */
  weaponDamageMultiplier: number;
  /** Multiplier applied to the effective footstep noise radius (lower = quieter). */
  footstepNoiseMultiplier: number;
  /** Flat modifier (seconds) added to the difficulty base i-frame window after a hit. */
  iFrameModifierSeconds: number;
  /** Whether the ascension dash consumes sprint stamina for this character (Task 11). */
  dashConsumesStamina: boolean;
}

export interface CharacterProfile {
  id: CharacterId;
  name: string;
  archetype: string;
  stats: CharacterStats;
  /** Skill IDs granted at the start of every run. */
  startingSkills: string[];
}

export const CHARACTERS: Record<CharacterId, CharacterProfile> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    archetype: 'Hud-hud — Senses specialist',
    stats: {
      hp: 3,
      speedMultiplier: 1.0,
      jumpMultiplier: 1.0,
      sonarRangeMultiplier: 1.4,
      weaponDamageMultiplier: 1.0,
      footstepNoiseMultiplier: 1.0,
      iFrameModifierSeconds: 0,
      dashConsumesStamina: false,
    },
    startingSkills: ['senses.extended_sonar', 'silence.silent_landing'],
  },
  ironclaw: {
    id: 'ironclaw',
    name: 'Ironclaw',
    archetype: 'Badger — Gadgets & combat',
    stats: {
      hp: 5,
      speedMultiplier: 0.85,
      jumpMultiplier: 0.95,
      sonarRangeMultiplier: 0.75,
      weaponDamageMultiplier: 1.25,
      footstepNoiseMultiplier: 1.15,
      iFrameModifierSeconds: -0.2,
      dashConsumesStamina: false,
    },
    startingSkills: ['gadgets.bazooka_blast_radius', 'gadgets.armoured_plating'],
  },
  kestrel: {
    id: 'kestrel',
    name: 'Kestrel',
    archetype: 'Fennec Fox — Mobility & silence',
    stats: {
      hp: 2,
      speedMultiplier: 1.3,
      jumpMultiplier: 1.5,
      sonarRangeMultiplier: 1.0,
      weaponDamageMultiplier: 0.85,
      footstepNoiseMultiplier: 0.35,
      iFrameModifierSeconds: 0.3,
      dashConsumesStamina: true,
    },
    startingSkills: ['mobility.ascension_dash_plus', 'silence.whisper_walk'],
  },
};

export const CHARACTER_ORDER: CharacterId[] = ['midnight', 'ironclaw', 'kestrel'];

export const DEFAULT_CHARACTER: CharacterId = 'midnight';

export function isCharacterId(value: unknown): value is CharacterId {
  return value === 'midnight' || value === 'ironclaw' || value === 'kestrel';
}

export function getCharacter(id: CharacterId): CharacterProfile {
  return CHARACTERS[id];
}
