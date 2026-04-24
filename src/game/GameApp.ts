import {
  AbstractMesh,
  AnimationGroup,
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneLoader,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import '@babylonjs/loaders/OBJ';
import { isTargetVisible, soundDirection } from './stealth';
import { SHADOW_MAP_SIZE, type CameraSettings, type GameSettings } from './settings';
import {
  colliderToAabb,
  distance3,
  raycastHitsAnyAabb,
  segmentHitsAabb,
  type Aabb,
} from './collision';
import {
  DEFAULT_CHARACTER,
  getCharacter,
  type CharacterId,
  type CharacterProfile,
} from './characters';
import {
  guardStateIcon,
  initialGuardAiState,
  tickGuardAi,
  type GuardState,
} from './guardAi';
import {
  bumpAlarm,
  initialAlarmState,
  isTierEscalation,
  tickAlarm,
  type AlarmState,
  type AlarmTier,
} from './alarmState';
import { createGuard, resetGuard, type Guard, type NoiseEvent } from './guard';
import {
  createRng,
  defaultZonesForDifficulty,
  nextPatrolWaypoint,
  zoneCentre,
  type PatrolZone,
  type Rng,
} from './guardPatrol';
import { getDifficulty } from './difficulty';
import { earn, hydrateCurrency, spend } from './currency';
import type { Difficulty } from './settings';

export type StatusTone = 'neutral' | 'alert' | 'success';
type GuardAnimationRole = 'idle' | 'patrol' | 'alert' | 'hit' | 'defeated';

interface GameAppOptions {
  canvas: HTMLCanvasElement;
  onStatusChange: (message: string, tone: StatusTone) => void;
  onObjectiveChange: (message: string) => void;
  /** Called each frame with the current Crest-Sonar status string. */
  onSonarChange: (message: string) => void;
  onWeaponChange?: (weapon: string) => void;
  onPauseToggle?: (isPaused: boolean) => void;
  /** Called when HP changes so the HUD can re-render pips. */
  onHealthChange?: (current: number, max: number) => void;
  /** Called for each damage event — HUD can flash a vignette and shake the canvas. */
  onDamaged?: () => void;
  /** Called whenever the global alarm tier changes (Normal / Caution / Alert / Evasion).
   *  Task 7 will consume this to drive the three-layer music crossfade. */
  onAlarmChange?: (tier: AlarmTier) => void;
}

interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
}

interface GameState {
  hasWon: boolean;
  hasLost: boolean;
  liquidTimeSecured: boolean;
  isPaused: boolean;
  currentWeapon: number;
}

const PLAYER_SPEED = 5.5;
const SPRINT_MULTIPLIER = 1.55;
const CAMERA_ORBIT_SPEED = 0.005;
const GUARD_SPEED = 1.9;
const VISION_RANGE = 8.5;
const VISION_FOV = Math.PI * 0.5;
/** Initial upward velocity when the Hud-hud uses ascension dash. */
const ASCENSION_DASH_IMPULSE = 9;
const GRAVITY = 22;
/** Distance within which the sonic-crestal sonar registers guard footsteps. */
const SONAR_RANGE = 13;
/** How long a knocked-out guard stays down before waking. Easy = never. */
const GUARD_KNOCKOUT_WAKE_SECONDS: Record<Difficulty, number> = {
  easy: Infinity,
  medium: 30,
  hard: 12,
};
/** Base coin drop on the first knockout. Scaling follows `knockoutDropAmount`. */
const KNOCKOUT_BASE_DROP = 25;
const DEFAULT_WEAPON_SOCKET_POSITION = new Vector3(0.5, 0.9, 0.4);
const PROJECTILE_HIT_FADE_SECONDS = 0.15;
const BAZOOKA_WEAPON_INDEX = 3;
const BAZOOKA_EXPLOSION_RADIUS = 2.5;
const SWORD_RANGE = 3.0;
/** Eye height above player pivot used for sword line-of-sight raycasts. */
const PLAYER_EYE_HEIGHT = 1.0;
/** Base hearing radius for a guard — difficulty-scaled hearing is Task 4c. */
const GUARD_HEARING_RADIUS = 10;
/** Base guard melee damage per difficulty (Easy flat 1 / Med 1 / Hard 2, per plan Task 5). */
const GUARD_MELEE_DAMAGE: Record<Difficulty, number> = {
  easy: 1,
  medium: 1,
  hard: 2,
};
/** Base i-frame window per difficulty. Character modifier stacks on top. */
const IFRAME_BASE_SECONDS: Record<Difficulty, number> = {
  easy: 1.0,
  medium: 0.6,
  hard: 0.3,
};
/** Revive token skill id — if active and unused, grants one resurrection on 0 HP (Medium only). */
const REVIVE_TOKEN_SKILL_ID = 'gadgets.revive_token';
/** Per-action base noise radii (hearing targets compare against this). */
const NOISE_RADIUS_DASH = 6;
const NOISE_RADIUS_LANDING = 7;
const NOISE_RADIUS_ATTACK = 8;
/** The guard has to physically reach the player to end the run. */
const GUARD_CATCH_DISTANCE = 1.2;
/** A fall counts as "loud" only when the vertical velocity on landing exceeds this. */
const LANDING_NOISE_SPEED_THRESHOLD = 6;

/** Human-readable tier labels used in the HUD toast on alarm escalation. */
const ALARM_TIER_LABELS: Record<AlarmTier, string> = {
  normal: 'Normal',
  caution: 'Caution',
  alert: 'Alert',
  evasion: 'Evasion',
};

/** Authored rooftop hatch positions. Reinforcements emerge from these when the
 *  alarm hits Alert or Evasion. Y is the rooftop top (matches buildEnvironment). */
const HATCH_POSITIONS: Vector3[] = [
  new Vector3(-18, 5.5, 18),
  new Vector3(18, 7.0, 18),
  new Vector3(-18, 6.5, -18),
  new Vector3(18, 4.5, -18),
];

/** Max total reinforcements (lifetime per run) per difficulty. Plan Task 6
 *  Q4: Hard scales to genuine chaos. */
const REINFORCEMENT_CAP: Record<Difficulty, number> = {
  easy: 0,
  medium: 2,
  hard: 4,
};

/** Half-edge of the square zone a reinforcement patrols around their hatch —
 *  keeps them from wandering the whole map. */
const HATCH_ZONE_HALF = 5;

export class GameApp {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly options: GameAppOptions;
  private readonly inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  };

  private readonly state: GameState = {
    hasWon: false,
    hasLost: false,
    liquidTimeSecured: false,
    isPaused: false,
    currentWeapon: 0,
  };

  private readonly weapons = ['Sting Sword', 'Blaster', 'Sniper', 'Bazooka'];
  private weaponNodes: TransformNode[] = [];
  private weaponSocket!: TransformNode;
  private isAttacking: boolean = false;
  private playerRightHandNode: TransformNode | null = null;

  private readonly playerPivot: TransformNode;
  private readonly playerMesh: Mesh;
  private readonly playerShadowMesh: Mesh;
  /** Root node for the Hud-hud crest — rotates towards targets. */
  private readonly crestAnchor: TransformNode;
  private readonly crestPartLeft: Mesh;
  private readonly crestPartRight: Mesh;
  /** Glowing cyan ocular implant over the right eye — highlights guard positions. */
  private readonly ocularImplant: Mesh;
  /** All guards on the map. Task 6b introduced the array; 6c spawns N per
   *  difficulty (Easy 2 / Medium 3 / Hard 5). 6e appends reinforcements. */
  private readonly guards: Guard[] = [];
  /** Rooftop hatch meshes authored at fixed positions. Each entry tracks
   *  whether a reinforcement has already come through it this run. */
  private readonly hatches: Array<{ mesh: Mesh; position: Vector3; used: boolean }> = [];
  /** Total reinforcements spawned this run (capped by `REINFORCEMENT_CAP`). */
  private reinforcementsSpawned = 0;
  /** Seeded RNG driving patrol waypoint picks — fixed per-boot so a given run
   *  is reproducible if the seed is held. Re-seeded on `reset`. */
  private patrolRng: Rng = createRng(0x4e54 /* "NT" */);
  /** The Liquid Time sample — the MacGuffin of the Chronos Heist. */
  private readonly liquidTimeVial: Mesh;
  private readonly colliders: Array<{ x: number, z: number, w: number, d: number, topY: number, bottomY: number }> = [];
  /** Parallel to `colliders` — the mesh each collider belongs to (for fade/collision wiring). */
  private readonly colliderMeshes: Array<AbstractMesh | null> = [];
  private canDoubleJump = false;

  private readonly projectiles: Array<{
    mesh: Mesh;
    direction: Vector3;
    speed: number;
    life: number;
    weaponIndex: number;
    dying: number;
  }> = [];
  private readonly sparkBursts: Array<{
    mesh: Mesh;
    velocity: Vector3;
    life: number;
    maxLife: number;
  }> = [];
  private colliderAabbs: Aabb[] = [];

  private lastFrameTime = performance.now();
  /** Vertical velocity for the Hud-hud's ascension dash physics. */
  private verticalVelocity = 0;

  // Track the animations loaded from the player GLB
  private readonly playerAnimations: Map<string, AnimationGroup> = new Map();
  private currentPlayerAnimation: string = 'Idle';
  private readonly guardAnimations: Map<string, AnimationGroup> = new Map();
  private readonly guardAnimationBindings: Partial<Record<GuardAnimationRole, string>> = {};
  private currentGuardAnimation = '';

  private sun!: DirectionalLight;
  private shadowGenerator: ShadowGenerator | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private currentShadowTier: GameSettings['shadowTier'] | null = null;
  private cameraMode: CameraSettings['mode'] = 'orbit';
  private readonly fadedMeshes: Set<AbstractMesh> = new Set();
  private character: CharacterProfile = getCharacter(DEFAULT_CHARACTER);
  /** Noise events queued this frame. Every guard evaluates the list each tick,
   *  then it's cleared. Populated by `emitNoise`; consumed in `updateGuard`. */
  private pendingNoises: NoiseEvent[] = [];
  /** Global alarm state — counter + tier. Driven by guard state transitions
   *  (alerted/chasing bumps) and decayed each tick while no guard is aware
   *  of the player. */
  private alarm: AlarmState = initialAlarmState();
  private wasAirborne: boolean = false;
  private hp: number = getCharacter(DEFAULT_CHARACTER).stats.hp;
  private iFramesRemaining: number = 0;
  private reviveTokenUsed: boolean = false;
  /** Skills active for the current run (character starting skills + any unlocked via skill tree). */
  private activeRunSkills: readonly string[] = [];
  private reduceMotion: boolean = false;

  constructor(options: GameAppOptions) {
    this.options = options;
    this.engine = new Engine(options.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });

    this.scene = new Scene(this.engine);
    // Overcast Neo-Paris night sky
    this.scene.clearColor = new Color4(0.02, 0.04, 0.09, 1);

    this.camera = this.createCamera(options.canvas);
    this.setupLighting();

    // Auto-enroll meshes with the active shadow generator as they're added to the scene.
    // This covers async-loaded GLBs (player, guard) without touching every loader callback.
    this.scene.onNewMeshAddedObservable.add((mesh) => {
      this.applyShadowRoleToMesh(mesh);
    });

    this.buildEnvironment();
    this.colliderAabbs = this.colliders.map(colliderToAabb);

    this.playerPivot = new TransformNode('playerPivot', this.scene);
    this.playerPivot.position = new Vector3(-8, 1.2, -8);
    this.playerMesh = this.createPlayerMesh();
    this.playerMesh.parent = this.playerPivot;
    this.playerMesh.position = Vector3.Zero();

    this.createWeapons();

    this.playerShadowMesh = MeshBuilder.CreateDisc(
      'playerShadow',
      { radius: 0.7, tessellation: 40 },
      this.scene,
    );
    this.playerShadowMesh.parent = this.playerPivot;
    this.playerShadowMesh.rotation.x = Math.PI / 2;
    this.playerShadowMesh.position = new Vector3(0, -0.58, 0);
    const shadowMaterial = new StandardMaterial('shadowMaterial', this.scene);
    shadowMaterial.diffuseColor = new Color3(0, 0, 0);
    shadowMaterial.alpha = 0.22;
    this.playerShadowMesh.material = shadowMaterial;

    // Crestal Sonar: Hud-hud crest that rotates and spreads
    this.crestAnchor = new TransformNode('crestAnchor', this.scene);
    this.crestAnchor.parent = this.playerPivot;
    this.crestAnchor.position = new Vector3(0, 0.9, 0);

    this.crestPartLeft = this.createCrestPart('crestPartLeft');
    this.crestPartLeft.parent = this.crestAnchor;
    this.crestPartLeft.position = new Vector3(-0.15, 0.42, -0.1);

    this.crestPartRight = this.createCrestPart('crestPartRight');
    this.crestPartRight.parent = this.crestAnchor;
    this.crestPartRight.position = new Vector3(0.15, 0.42, -0.1);

    // Glowing cyan ocular implant over the right eye
    this.ocularImplant = this.createOcularImplant();
    this.ocularImplant.parent = this.playerPivot;
    this.ocularImplant.position = new Vector3(-0.27, 0.5, 0.3);

    this.seedGuardsForDifficulty();
    this.placeHatches();

    this.liquidTimeVial = this.createLiquidTimeVial();
    this.liquidTimeVial.position = new Vector3(9, 1.2, 8.5);

    hydrateCurrency();
    this.activeRunSkills = this.character.startingSkills.slice();
    this.registerInput();
    this.updateStatus('Act I \u2014 The Rainy Rooftops. Slip past the Baron\'s guards.', 'neutral');
    this.options.onObjectiveChange('Plant the tracker on the Baron\'s cane. Reach the Liquid Time sample.');
    this.options.onSonarChange('Scanning\u2026');
    this.options.onHealthChange?.(this.hp, this.character.stats.hp);
    this.options.onAlarmChange?.(this.alarm.tier);
  }

  public start(): void {
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const deltaSeconds = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      this.update(deltaSeconds);
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  private createCamera(canvas: HTMLCanvasElement): ArcRotateCamera {
    const camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      1.1,
      18,
      new Vector3(0, 2, 0),
      this.scene,
    );

    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.015;
    camera.lowerRadiusLimit = 8;
    camera.upperRadiusLimit = 50;
    camera.lowerBetaLimit = 0.45;
    camera.upperBetaLimit = 1.3;
    camera.panningSensibility = 0;
    camera.angularSensibilityX = 1 / CAMERA_ORBIT_SPEED;
    camera.angularSensibilityY = 1 / CAMERA_ORBIT_SPEED;
    camera.useBouncingBehavior = false;

    return camera;
  }

  private setupLighting(): void {
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.62;
    // Overcast Neo-Paris ambient — cool blue-green tint
    hemi.diffuse = new Color3(0.5, 0.65, 0.85);
    hemi.groundColor = new Color3(0.04, 0.05, 0.08);

    const sun = new DirectionalLight('sun', new Vector3(-0.6, -1, -0.2), this.scene);
    sun.position = new Vector3(15, 20, 10);
    sun.intensity = 1.25;
    // Cool moonlight tone
    sun.diffuse = new Color3(0.65, 0.78, 1.0);
    this.sun = sun;
  }

  /** Meshes that are invisible helpers or would fight the shadow pass. */
  private static readonly NON_SHADOW_NAMES = /^(playerHitbox|playerShadow|visionCone|wall|trim_|spark_)/;
  /** Static environment that should receive but not cast shadows. */
  private static readonly SHADOW_RECEIVER_NAMES =
    /^(roof|b_|centralPad|raisedRoof|objectiveRoof|pipePlatform|wireBridge|vent|bridgePole|pipeCol)/;

  private applyShadowRoleToMesh(mesh: AbstractMesh): void {
    if (!this.shadowGenerator || !mesh.name) return;
    if (GameApp.NON_SHADOW_NAMES.test(mesh.name)) return;
    if (GameApp.SHADOW_RECEIVER_NAMES.test(mesh.name)) {
      mesh.receiveShadows = true;
      return;
    }
    this.shadowGenerator.addShadowCaster(mesh, false);
  }

  public applyGraphicsSettings(settings: GameSettings): void {
    const mapSize = SHADOW_MAP_SIZE[settings.shadowTier];

    if (!this.shadowGenerator || this.currentShadowTier !== settings.shadowTier) {
      this.shadowGenerator?.dispose();
      this.shadowGenerator = new ShadowGenerator(mapSize, this.sun);
      this.shadowGenerator.useBlurExponentialShadowMap = true;
      this.shadowGenerator.blurKernel = 24;
      this.shadowGenerator.bias = 0.002;
      this.currentShadowTier = settings.shadowTier;

      for (const mesh of this.scene.meshes) {
        this.applyShadowRoleToMesh(mesh);
      }
      // The decorative disc under the player is redundant once real shadows render.
      this.playerShadowMesh.isVisible = false;
    }

    if (!this.pipeline) {
      this.pipeline = new DefaultRenderingPipeline(
        'defaultPipeline',
        true,
        this.scene,
        [this.camera],
      );
      this.pipeline.bloomThreshold = 0.85;
      this.pipeline.bloomWeight = 0.4;
      // Default aberration (30) is too harsh for a stealth game; moderate it.
      this.pipeline.chromaticAberration.aberrationAmount = 10;
    }
    this.pipeline.bloomEnabled = settings.postfx.bloom;
    this.pipeline.fxaaEnabled = settings.postfx.fxaa;
    this.pipeline.chromaticAberrationEnabled = settings.postfx.chromaticAberration;
  }

  public setCharacter(id: CharacterId): void {
    this.character = getCharacter(id);
    this.activeRunSkills = this.character.startingSkills.slice();
    this.hp = this.character.stats.hp;
    this.iFramesRemaining = 0;
    this.reviveTokenUsed = false;
    this.options.onHealthChange?.(this.hp, this.character.stats.hp);
  }

  public getCharacter(): CharacterProfile {
    return this.character;
  }

  public setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
  }

  public getHealth(): { current: number; max: number } {
    return { current: this.hp, max: this.character.stats.hp };
  }

  private iFrameDuration(): number {
    return Math.max(
      0.1,
      IFRAME_BASE_SECONDS[getDifficulty()] + this.character.stats.iFrameModifierSeconds,
    );
  }

  private takeDamage(amount: number): void {
    if (this.state.hasLost || this.state.hasWon) return;
    if (this.iFramesRemaining > 0 || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.iFramesRemaining = this.iFrameDuration();
    this.options.onHealthChange?.(this.hp, this.character.stats.hp);
    if (!this.reduceMotion) {
      this.options.onDamaged?.();
    }
    if (this.hp <= 0) {
      this.handleZeroHealth();
    }
  }

  private handleZeroHealth(): void {
    const difficulty = getDifficulty();
    if (difficulty === 'easy') {
      // Respawn at level start with a fresh HP bar. Vial progress is preserved.
      this.hp = this.character.stats.hp;
      this.iFramesRemaining = this.iFrameDuration();
      this.playerPivot.position.set(-8, 1.2, -8);
      this.verticalVelocity = 0;
      this.options.onHealthChange?.(this.hp, this.character.stats.hp);
      this.updateStatus('Respawned at the starting rooftop.', 'alert');
      return;
    }
    if (
      difficulty === 'medium' &&
      !this.reviveTokenUsed &&
      this.activeRunSkills.includes(REVIVE_TOKEN_SKILL_ID)
    ) {
      this.reviveTokenUsed = true;
      this.hp = 1;
      this.iFramesRemaining = this.iFrameDuration() * 1.5;
      this.options.onHealthChange?.(this.hp, this.character.stats.hp);
      this.updateStatus('Revive token consumed — back on 1 HP!', 'alert');
      return;
    }
    this.state.hasLost = true;
    this.playGuardAnimationRole('alert');
    this.updateStatus("Midnight is down. Press R to restart.", 'alert');
  }

  public applyCameraSettings(settings: CameraSettings): void {
    this.camera.lowerRadiusLimit = settings.minDistance;
    if (this.camera.radius < settings.minDistance) {
      this.camera.radius = settings.minDistance;
    }

    const switchingOutOfFade = this.cameraMode === 'fade' && settings.mode !== 'fade';
    this.cameraMode = settings.mode;

    if (switchingOutOfFade) {
      for (const mesh of this.fadedMeshes) {
        mesh.visibility = 1.0;
      }
      this.fadedMeshes.clear();
    }

    if (settings.mode === 'orbit') {
      this.scene.collisionsEnabled = true;
      this.camera.checkCollisions = true;
      for (const mesh of this.colliderMeshes) {
        if (mesh) mesh.checkCollisions = true;
      }
    } else {
      this.camera.checkCollisions = false;
      for (const mesh of this.colliderMeshes) {
        if (mesh) mesh.checkCollisions = false;
      }
    }
  }

  private updateCameraFade(): void {
    if (this.cameraMode !== 'fade') return;

    const origin = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    };
    const target = {
      x: this.playerPivot.position.x,
      y: this.playerPivot.position.y + PLAYER_EYE_HEIGHT,
      z: this.playerPivot.position.z,
    };

    const obstructing = new Set<AbstractMesh>();
    for (let i = 0; i < this.colliderAabbs.length; i++) {
      const mesh = this.colliderMeshes[i];
      if (!mesh) continue;
      if (segmentHitsAabb(origin, target, this.colliderAabbs[i])) {
        obstructing.add(mesh);
      }
    }

    for (const mesh of this.fadedMeshes) {
      if (!obstructing.has(mesh)) mesh.visibility = 1.0;
    }
    for (const mesh of obstructing) {
      mesh.visibility = 0.35;
    }
    this.fadedMeshes.clear();
    for (const mesh of obstructing) this.fadedMeshes.add(mesh);
  }

  private buildEnvironment(): void {
    const rooftopMaterial = new StandardMaterial('rooftopMaterial', this.scene);
    rooftopMaterial.diffuseColor = new Color3(0.11, 0.14, 0.22);
    rooftopMaterial.specularColor = new Color3(0.07, 0.07, 0.09);

    const accentMaterial = new StandardMaterial('accentMaterial', this.scene);
    accentMaterial.diffuseColor = new Color3(0.14, 0.2, 0.35);
    accentMaterial.emissiveColor = new Color3(0.01, 0.02, 0.07);

    // Neon teal trim — elevated platforms and edge strips
    const neonTrimMaterial = new StandardMaterial('neonTrimMaterial', this.scene);
    neonTrimMaterial.diffuseColor = new Color3(0.04, 0.18, 0.22);
    neonTrimMaterial.emissiveColor = new Color3(0.0, 0.16, 0.22);

    const roof = MeshBuilder.CreateGround('roof', { width: 56, height: 56 }, this.scene);
    roof.material = rooftopMaterial;

    const addCollider = (
      mesh: AbstractMesh | null,
      x: number,
      z: number,
      w: number,
      d: number,
      topY: number,
      bottomY: number = -100,
    ) => {
      this.colliders.push({ x, z, w, d, topY, bottomY });
      this.colliderMeshes.push(mesh);
    };

    // Construct the city blocks
    const cityBuildings = [
      // existing core platforms
      { name: 'centralPad', x: 0, z: 0, w: 8, d: 8, h: 0.8, y: 0.4, top: 0.8, mat: accentMaterial },
      { name: 'raisedRoof', x: -8, z: -8, w: 10, d: 6, h: 1.2, y: 0.6, top: 1.2, mat: accentMaterial },
      { name: 'objectiveRoof', x: 8, z: 8, w: 8, d: 8, h: 1.0, y: 0.5, top: 1.0, mat: accentMaterial },
      
      // new tall buildings to form a small city (so player needs to double jump to explore)
      { name: 'b_northWest', x: -18, z: 18, w: 10, d: 8, h: 5.5, y: 2.75, top: 5.5, mat: rooftopMaterial },
      { name: 'b_northEast', x: 18, z: 18, w: 8, d: 10, h: 7, y: 3.5, top: 7.0, mat: accentMaterial },
      { name: 'b_southWest', x: -18, z: -18, w: 8, d: 8, h: 6.5, y: 3.25, top: 6.5, mat: rooftopMaterial },
      { name: 'b_southEast', x: 18, z: -18, w: 12, d: 6, h: 4.5, y: 2.25, top: 4.5, mat: accentMaterial },
      
      // scattered city blocks
      { name: 'b_west', x: -22, z: 0, w: 6, d: 14, h: 7.5, y: 3.75, top: 7.5, mat: accentMaterial },
      { name: 'b_east', x: 22, z: 0, w: 6, d: 14, h: 6, y: 3.0, top: 6.0, mat: rooftopMaterial },
      { name: 'b_north', x: 0, z: 22, w: 14, d: 6, h: 5.5, y: 2.75, top: 5.5, mat: accentMaterial },
      { name: 'b_south', x: 0, z: -22, w: 14, d: 6, h: 6, y: 3.0, top: 6.0, mat: rooftopMaterial },

      // a few mid-size rooftops closer to the center
      { name: 'b_midWest', x: -14, z: 6, w: 6, d: 6, h: 3, y: 1.5, top: 3.0, mat: rooftopMaterial },
      { name: 'b_midEast', x: 14, z: -6, w: 6, d: 6, h: 3.5, y: 1.75, top: 3.5, mat: rooftopMaterial },

      // Rooftop vents (obstacles / cover)
      { name: 'vent0', x: -3, z: -2, w: 2.4, d: 2.4, h: 1.6, y: 1.2, top: 2.0, mat: rooftopMaterial },
      { name: 'vent1', x: 5.5, z: -5, w: 2.4, d: 2.4, h: 1.6, y: 1.2, top: 2.0, mat: rooftopMaterial },
      { name: 'vent2', x: -6, z: 6, w: 2.4, d: 2.4, h: 1.6, y: 1.2, top: 2.0, mat: rooftopMaterial },
      { name: 'vent3', x: 1.5, z: 5.5, w: 2.4, d: 2.4, h: 1.6, y: 1.2, top: 2.0, mat: rooftopMaterial },
    ];

    cityBuildings.forEach(b => {
      const mesh = MeshBuilder.CreateBox(b.name, { width: b.w, height: b.h, depth: b.d }, this.scene);
      mesh.position = new Vector3(b.x, b.y, b.z);
      mesh.material = b.mat;
      addCollider(mesh, b.x, b.z, b.w, b.d, b.top, -100);
    });

    // Elevated platforms (jump-throughable from below if high enough)
    const pipePlatform = MeshBuilder.CreateBox('pipePlatform', { width: 4, height: 0.25, depth: 4 }, this.scene);
    pipePlatform.position = new Vector3(6.5, 2.0, -5.5);
    pipePlatform.material = neonTrimMaterial;
    addCollider(pipePlatform, 6.5, -5.5, 4, 4, 2.125, 1.875);

    for (const [px, pz] of [[4.8, -3.8], [8.2, -3.8], [4.8, -7.2], [8.2, -7.2]]) {
      const col = MeshBuilder.CreateCylinder(`pipeCol_${px}_${pz}`, { diameter: 0.32, height: 2.0, tessellation: 8 }, this.scene);
      col.position = new Vector3(px, 1.0, pz);
      col.material = rooftopMaterial;
      addCollider(col, px, pz, 0.4, 0.4, 2.0, -100);
    }

    const wireBridge = MeshBuilder.CreateBox('wireBridge', { width: 2, height: 0.18, depth: 8 }, this.scene);
    wireBridge.position = new Vector3(-4.5, 2.0, 0);
    wireBridge.material = neonTrimMaterial;
    addCollider(wireBridge, -4.5, 0, 2, 8, 2.09, 1.91);

    for (const bz of [-3.5, 3.5]) {
      const pole = MeshBuilder.CreateCylinder(`bridgePole_${bz}`, { diameter: 0.22, height: 2.0, tessellation: 8 }, this.scene);
      pole.position = new Vector3(-4.5, 1.0, bz);
      pole.material = rooftopMaterial;
      addCollider(pole, -4.5, bz, 0.4, 0.4, 2.0, -100);
    }

    // Perimeter walls
    [
      new Vector3(-27.5, 1.4, 0),
      new Vector3(0, 1.4, -27.5),
      new Vector3(27.5, 1.4, 0),
      new Vector3(0, 1.4, 27.5),
    ].forEach((position, index) => {
      const wall = MeshBuilder.CreateBox(`wall${index}`, {
        width: Math.abs(position.x) > 0 ? 1 : 56,
        height: 10, // increased height to bound the city properly
        depth: Math.abs(position.z) > 0 ? 1 : 56,
      }, this.scene);
      wall.position = position;
      wall.material = rooftopMaterial;
      // We don't need colliders for walls because movement is strictly clamped at +/- 27
    });

    // Neon teal trim strips along the central pad edges
    for (const [ex, ez, ew, ed] of [
      [0, -4.08, 8, 0.12], [0, 4.08, 8, 0.12], [-4.08, 0, 0.12, 8], [4.08, 0, 0.12, 8],
    ]) {
      const trim = MeshBuilder.CreateBox(`trim_${ex}_${ez}`, { width: ew, height: 0.1, depth: ed }, this.scene);
      trim.position = new Vector3(ex, 0.85, ez);
      trim.material = neonTrimMaterial;
    }
  }

  /** Hud-hud character in streamlined tactical suit - black, white, orange-cinnamon. */
  private createPlayerMesh(): Mesh {
    const dummyPlayer = MeshBuilder.CreateCapsule(
      'playerHitbox',
      { radius: 0.42, height: 1.4 },
      this.scene,
    );
    dummyPlayer.isVisible = false;

    SceneLoader.ImportMeshAsync("", "/models/Meshy_AI_biped/", "Meshy_AI_Meshy_Merged_Animations.glb", this.scene).then((result) => {
      const character = result.meshes[0];
      character.parent = dummyPlayer;
      
      // Fine-tune these based on how the model is exported
      character.scaling = new Vector3(1.3, 1.3, 1.3);
      character.position.y = 0.2; // Lifted character model further up so feet rest completely on the floor
      
      // If the model faces the opposite way when moving, reset or flip its Y rotation
      character.rotationQuaternion = null;
      character.rotation = new Vector3(0, 0, 0); // Changed from Math.PI to 0 to flip 180 degrees

      // Store animation groups for playback
      if (result.animationGroups && result.animationGroups.length > 0) {
        result.animationGroups.forEach(anim => {
          this.playerAnimations.set(anim.name, anim);
          anim.stop(); // Stop all animations initially
        });

        // Start with Idle
        const idle = this.playerAnimations.get('Idle');
        if (idle) {
          idle.play(true);
        }
      }

      this.attachWeaponSocketToHand(result.transformNodes, result.meshes);
    });

    return dummyPlayer;
  }

  private attachWeaponSocketToHand(
    transformNodes: TransformNode[],
    meshes: AbstractMesh[],
  ): void {
    if (!this.weaponSocket) {
      return;
    }

    const rightHand = transformNodes.find(node => node.name === 'RightHand')
      ?? transformNodes.find(node => /right.*hand|hand.*right/i.test(node.name))
      ?? transformNodes.find(node => /right.*wrist|wrist.*right/i.test(node.name))
      ?? transformNodes.find(node => /right.*arm/i.test(node.name));

    if (!rightHand) {
      this.weaponSocket.parent = this.playerPivot;
      this.weaponSocket.rotationQuaternion = null;
      this.weaponSocket.position.copyFrom(DEFAULT_WEAPON_SOCKET_POSITION);
      this.weaponSocket.rotation.set(0, 0, 0);
      this.weaponSocket.scaling.set(1, 1, 1);
      return;
    }

    this.playerRightHandNode = rightHand;
    this.weaponSocket.parent = null;
    this.weaponSocket.rotationQuaternion = Quaternion.Identity();
    this.weaponSocket.position.copyFrom(rightHand.getAbsolutePosition());
    this.weaponSocket.scaling.set(1, 1, 1);

    const skinnedMesh = meshes.find(mesh => !!mesh.skeleton);
    if (skinnedMesh) {
      this.weaponSocket.position.addInPlace(new Vector3(0.16, 0.1, 0.18));
    }
  }

  private syncWeaponSocketToHand(): void {
    if (!this.playerRightHandNode || !this.weaponSocket) {
      return;
    }

    const handMatrix = this.playerRightHandNode.getWorldMatrix();
    const handScale = new Vector3();
    const handRotation = new Quaternion();
    const handPosition = new Vector3();
    handMatrix.decompose(handScale, handRotation, handPosition);

    this.weaponSocket.parent = null;
    this.weaponSocket.rotationQuaternion = handRotation;
    this.weaponSocket.position.copyFrom(handPosition);
  }

  /** One half of the Hud-hud crest — dramatic feathers with cyan fiber-optics. */
  private createCrestPart(name: string): Mesh {
    const crest = MeshBuilder.CreateBox(
      name,
      { width: 0.1, height: 0.8, depth: 0.35 },
      this.scene,
    );
    // Angle backward slightly to form a folded crest
    crest.rotation.x = -Math.PI / 6;

    const material = new StandardMaterial(`${name}Material`, this.scene);
    material.diffuseColor = new Color3(0.85, 0.35, 0.1); // Cinnamon
    material.emissiveColor = new Color3(0.0, 0.5, 0.8); // Cyan tech glow
    crest.material = material;

    return crest;
  }

  /** Glowing cyan ocular implant. */
  private createOcularImplant(): Mesh {
    const implant = MeshBuilder.CreateSphere(
      'implant',
      { diameter: 0.17, segments: 6 },
      this.scene,
    );

    const material = new StandardMaterial('implantMaterial', this.scene);
    material.diffuseColor = new Color3(0.1, 0.9, 1.0);
    material.emissiveColor = new Color3(0.04, 0.8, 0.98);
    material.alpha = 0.88;
    implant.material = material;

    return implant;
  }

  private createWeapons(): void {
    this.weaponSocket = new TransformNode('weaponSocket', this.scene);
    this.weaponSocket.parent = this.playerPivot;
    // Offset the socket relative to the pivot so it aligns with the right arm/hand area
    this.weaponSocket.position.copyFrom(DEFAULT_WEAPON_SOCKET_POSITION);

    // 0: Sword - Procedural fallback so the weapon is always visible in-hand
    const swordNode = this.createSwordMesh();
    swordNode.parent = this.weaponSocket;
    swordNode.position = new Vector3(0.02, -0.02, 0.14);
    swordNode.rotation = Vector3.Zero();
    swordNode.scaling = new Vector3(1, 1, 1);

    // 1: Blaster - A small compact gun
    const blaster = MeshBuilder.CreateBox('weapon_blaster', { width: 0.15, height: 0.25, depth: 0.5 }, this.scene);
    blaster.parent = this.weaponSocket;
    const blasterMat = new StandardMaterial('blasterMat', this.scene);
    blasterMat.diffuseColor = new Color3(0.8, 0.2, 0.2);
    blaster.material = blasterMat;

    // 2: Sniper - A long barrel rifle
    const sniper = MeshBuilder.CreateCylinder('weapon_sniper', { diameter: 0.1, height: 1.5, tessellation: 8 }, this.scene);
    sniper.parent = this.weaponSocket;
    sniper.rotation.x = Math.PI / 2;
    sniper.position.z = 0.5; // push barrel outward
    const sniperMat = new StandardMaterial('sniperMat', this.scene);
    sniperMat.diffuseColor = new Color3(0.2, 0.2, 0.8);
    sniper.material = sniperMat;

    // 3: Bazooka - A thick tube
    const bazooka = MeshBuilder.CreateCylinder('weapon_bazooka', { diameter: 0.3, height: 1.2, tessellation: 12 }, this.scene);
    bazooka.parent = this.weaponSocket;
    bazooka.rotation.x = Math.PI / 2;
    bazooka.position.z = 0.2; // push outward
    const bazookaMat = new StandardMaterial('bazookaMat', this.scene);
    bazookaMat.diffuseColor = new Color3(0.8, 0.5, 0.1);
    bazooka.material = bazookaMat;

    this.weaponNodes = [swordNode, blaster, sniper, bazooka];

    for (let i = 0; i < this.weaponNodes.length; i++) {
      const w = this.weaponNodes[i];
      // Note: for swordNode this sets the node enable/disable
      w.setEnabled(i === this.state.currentWeapon);
    }
    
    if (this.options.onWeaponChange) {
      this.options.onWeaponChange(this.weapons[this.state.currentWeapon]);
    }
  }

  private createSwordMesh(): TransformNode {
    const swordRoot = new TransformNode('weapon_sword_root', this.scene);

    const blade = MeshBuilder.CreateBox('weapon_sword_blade', { width: 0.06, height: 0.06, depth: 1.15 }, this.scene);
    blade.parent = swordRoot;
    blade.position.z = 0.56;

    const guard = MeshBuilder.CreateBox('weapon_sword_guard', { width: 0.32, height: 0.08, depth: 0.08 }, this.scene);
    guard.parent = swordRoot;
    guard.position.z = 0.06;

    const handle = MeshBuilder.CreateCylinder('weapon_sword_handle', { diameter: 0.07, height: 0.28, tessellation: 10 }, this.scene);
    handle.parent = swordRoot;
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -0.12;

    const pommel = MeshBuilder.CreateSphere('weapon_sword_pommel', { diameter: 0.1, segments: 8 }, this.scene);
    pommel.parent = swordRoot;
    pommel.position.z = -0.28;

    const bladeMaterial = new StandardMaterial('swordBladeMaterial', this.scene);
    bladeMaterial.diffuseColor = new Color3(0.86, 0.9, 0.98);
    bladeMaterial.specularColor = new Color3(0.95, 0.95, 1);
    blade.material = bladeMaterial;

    const hiltMaterial = new StandardMaterial('swordHiltMaterial', this.scene);
    hiltMaterial.diffuseColor = new Color3(0.2, 0.16, 0.12);
    hiltMaterial.emissiveColor = new Color3(0.14, 0.08, 0.02);
    guard.material = hiltMaterial;
    handle.material = hiltMaterial;
    pommel.material = hiltMaterial;

    return swordRoot;
  }

  /** Builds one guard end-to-end — scene-graph + AI state + zone — and wires
   *  the cone colour. The `primary` flag loads the full Golem rig (animated);
   *  placeholder guards get a visible tinted capsule while per-guard animation
   *  state is a follow-up. */
  private spawnGuard(zone: PatrolZone, primary: boolean): Guard {
    const centre = zoneCentre(zone);
    const position = new Vector3(centre.x, 0.75, centre.z);
    const pivot = new TransformNode(`guardPivot_${this.guards.length}`, this.scene);
    pivot.position = position.clone();
    const mesh = primary ? this.createGuardMesh() : this.createPlaceholderGuardMesh();
    mesh.parent = pivot;
    const visionCone = this.createVisionCone();
    visionCone.parent = pivot;
    const firstTargetXZ = nextPatrolWaypoint(centre, zone, this.patrolRng);
    const firstTarget = new Vector3(firstTargetXZ.x, 0.75, firstTargetXZ.z);
    const guard = createGuard(pivot, mesh, visionCone, zone, firstTarget);
    this.applyConeColourForGuard(guard);
    return guard;
  }

  /** Spawns all starting guards for the current difficulty. First guard gets
   *  the full Golem rig; additional guards use placeholder capsules. */
  private seedGuardsForDifficulty(): void {
    const zones = defaultZonesForDifficulty(getDifficulty());
    for (let i = 0; i < zones.length; i++) {
      this.guards.push(this.spawnGuard(zones[i], i === 0));
    }
  }

  /** Creates the rooftop hatch meshes at authored positions. Closed state is
   *  a slightly-emissive grey disc; `flashHatchOpen` briefly brightens it when
   *  a reinforcement emerges. */
  private placeHatches(): void {
    for (let i = 0; i < HATCH_POSITIONS.length; i++) {
      const origin = HATCH_POSITIONS[i];
      const mesh = MeshBuilder.CreateCylinder(
        `hatch_${i}`,
        { diameter: 1.4, height: 0.18, tessellation: 16 },
        this.scene,
      );
      mesh.position = origin.clone();
      mesh.position.y += 0.09;
      const mat = new StandardMaterial(`hatchMat_${i}`, this.scene);
      mat.diffuseColor = new Color3(0.14, 0.18, 0.22);
      mat.emissiveColor = new Color3(0.02, 0.04, 0.05);
      mat.specularColor = new Color3(0.5, 0.6, 0.7);
      mesh.material = mat;
      this.hatches.push({ mesh, position: origin.clone(), used: false });
    }
  }

  /** Cyan-flash visual on hatch open. Kept briefly bright for ~1 s via a
   *  timeout; no heavy particle system (Task 7 will hook SFX here). */
  private flashHatchOpen(hatch: { mesh: Mesh }): void {
    const mat = hatch.mesh.material as StandardMaterial | null;
    if (!mat) return;
    const originalEmissive = mat.emissiveColor.clone();
    mat.emissiveColor = new Color3(0.1, 0.7, 0.85);
    setTimeout(() => {
      mat.emissiveColor = originalEmissive;
    }, 1000);
  }

  /** Picks the hatch closest to the player that has not yet been used.
   *  Returns null when every hatch is used — reinforcement spawn is skipped. */
  private nearestUnusedHatch(): { mesh: Mesh; position: Vector3; used: boolean } | null {
    let best: { mesh: Mesh; position: Vector3; used: boolean } | null = null;
    let bestSq = Infinity;
    for (const hatch of this.hatches) {
      if (hatch.used) continue;
      const dx = hatch.position.x - this.playerPivot.position.x;
      const dz = hatch.position.z - this.playerPivot.position.z;
      const sq = dx * dx + dz * dz;
      if (sq < bestSq) {
        bestSq = sq;
        best = hatch;
      }
    }
    return best;
  }

  /** Spawns one reinforcement through the nearest unused hatch if the per-run
   *  cap hasn't been reached. Reinforcements get a 10×10 m patrol zone centred
   *  on their hatch so they stay near their entry point. */
  private trySpawnReinforcement(): void {
    if (this.reinforcementsSpawned >= REINFORCEMENT_CAP[getDifficulty()]) return;
    const hatch = this.nearestUnusedHatch();
    if (!hatch) return;
    hatch.used = true;
    this.reinforcementsSpawned += 1;
    this.flashHatchOpen(hatch);

    const zone: PatrolZone = {
      minX: hatch.position.x - HATCH_ZONE_HALF,
      maxX: hatch.position.x + HATCH_ZONE_HALF,
      minZ: hatch.position.z - HATCH_ZONE_HALF,
      maxZ: hatch.position.z + HATCH_ZONE_HALF,
    };
    const guard = this.spawnGuard(zone, false);
    // Plant the guard at the hatch itself, not the zone centre, so the spawn
    // reads as "emerging from the hatch".
    guard.pivot.position.set(hatch.position.x, hatch.position.y + 0.2, hatch.position.z);
    this.guards.push(guard);
    this.updateStatus('Reinforcement breached the roof!', 'alert');
  }

  /** Visible tinted capsule for secondary guards until per-guard animation
   *  lands. Same hitbox radius as the Golem hitbox so collisions stay honest. */
  private createPlaceholderGuardMesh(): Mesh {
    const capsule = MeshBuilder.CreateCapsule(
      `guardPlaceholder_${this.guards.length}`,
      { radius: 0.52, height: 1.75 },
      this.scene,
    );
    const mat = new StandardMaterial(`guardPlaceholderMat_${this.guards.length}`, this.scene);
    mat.diffuseColor = new Color3(0.28, 0.22, 0.18);
    mat.emissiveColor = new Color3(0.08, 0.04, 0.02);
    mat.specularColor = new Color3(0.4, 0.4, 0.45);
    capsule.material = mat;
    return capsule;
  }

  /** Baron von Steer's guard — larger, darker, more threatening. */
  private createGuardMesh(): Mesh {
    // Create an invisible dummy base to attach the GLB model
    const dummyGuard = MeshBuilder.CreateCapsule(
      'guardHitbox',
      { radius: 0.52, height: 1.75 },
      this.scene,
    );
    dummyGuard.isVisible = false;

    // Load the Golem Crystal Behemoth replacement asynchronously
    SceneLoader.ImportMeshAsync("", "/models/", "Golem Crystal Behemoth.glb", this.scene).then((result) => {
      const golem = result.meshes[0];
      golem.parent = dummyGuard;
      // Adjust scale and position based on the Golem model's pivot
      golem.scaling = new Vector3(1.3, 1.3, 1.3); // Bumped scale up to make it more imposing
      golem.position.y = 0.3; // Lifted guard up so its feet touch the floor perfectly
      
      // Rotate 180 degrees if the model faces backward by default
      golem.rotation = new Vector3(0, 0, 0); // Removed the Math.PI rotation so it faces forward along its pivot

      if (result.animationGroups && result.animationGroups.length > 0) {
        result.animationGroups.forEach(anim => {
          this.guardAnimations.set(anim.name, anim);
          anim.stop();
        });
        this.bindGuardAnimations();
        this.playGuardAnimationRole('patrol');
      }
    });

    return dummyGuard;
  }

  private createVisionCone(): Mesh {
    const cone = MeshBuilder.CreateCylinder(
      'visionCone',
      {
        diameterTop: 0.01,
        diameterBottom: 6,
        height: 7,
        tessellation: 24,
      },
      this.scene,
    );

    cone.rotation.z = Math.PI / 2;
    cone.rotation.y = Math.PI / 2;
    cone.position = new Vector3(3.2, 0, 0);
    cone.scaling.y = 0.025;
    cone.scaling.z = 0.5;

    const coneMaterial = new StandardMaterial('visionConeMaterial', this.scene);
    coneMaterial.diffuseColor = new Color3(0.9, 0.2, 0.18);
    coneMaterial.alpha = 0.25;
    coneMaterial.emissiveColor = new Color3(0.35, 0.04, 0.04);
    cone.material = coneMaterial;

    return cone;
  }

  /** The Liquid Time sample — amber golden polyhedron, the prize of the Chronos Heist. */
  private createLiquidTimeVial(): Mesh {
    const vial = MeshBuilder.CreatePolyhedron(
      'liquidTimeVial',
      { type: 1, size: 0.95 },
      this.scene,
    );

    const material = new StandardMaterial('vialMaterial', this.scene);
    material.diffuseColor = new Color3(1.0, 0.76, 0.1);
    material.emissiveColor = new Color3(0.38, 0.2, 0.02);
    material.specularColor = new Color3(1.0, 0.92, 0.55);
    vial.material = material;

    return vial;
  }

  private registerInput(): void {
    this.scene.onPointerDown = (evt) => {
      // Left click (0) to use weapon
      if (evt.button === 0 && !this.state.isPaused && !this.state.hasLost && !this.state.hasWon) {
        this.useWeapon();
      }
    };

    window.addEventListener('keydown', (event) => {
      if (event.repeat) {
        return;
      }

      switch (event.code) {
        case 'KeyW':
          this.inputState.forward = true;
          break;
        case 'KeyS':
          this.inputState.backward = true;
          break;
        case 'KeyA':
          this.inputState.left = true;
          break;
        case 'KeyD':
          this.inputState.right = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.inputState.sprint = true;
          break;
        case 'Space':
          // Ascension Dash — diagonal burst using micro-thrusters and wings
          if (!this.state.hasLost && !this.state.hasWon) {
            if (this.isOnGround()) {
              this.verticalVelocity = ASCENSION_DASH_IMPULSE * this.character.stats.jumpMultiplier;
              this.canDoubleJump = true;
              this.emitNoise(this.playerPivot.position, NOISE_RADIUS_DASH);
            } else if (this.canDoubleJump) {
              this.verticalVelocity =
                ASCENSION_DASH_IMPULSE * this.character.stats.jumpMultiplier * 0.85; // slightly weaker second jump
              this.emitNoise(this.playerPivot.position, NOISE_RADIUS_DASH);
              this.canDoubleJump = false;
            }
          }
          break;
        case 'KeyR':
          if (this.state.hasLost || this.state.hasWon) {
            this.reset();
          }
          break;
        case 'Digit1':
          this.switchWeapon(0);
          break;
        case 'Digit2':
          this.switchWeapon(1);
          break;
        case 'Digit3':
          this.switchWeapon(2);
          break;
        case 'Digit4':
          this.switchWeapon(3);
          break;
        case 'Escape':
          this.togglePause();
          break;
        default:
          break;
      }
    });

    window.addEventListener('keyup', (event) => {
      switch (event.code) {
        case 'KeyW':
          this.inputState.forward = false;
          break;
        case 'KeyS':
          this.inputState.backward = false;
          break;
        case 'KeyA':
          this.inputState.left = false;
          break;
        case 'KeyD':
          this.inputState.right = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.inputState.sprint = false;
          break;
        default:
          break;
      }
    });
  }

  private switchWeapon(index: number): void {
    if (this.state.isPaused || this.state.hasLost || this.state.hasWon) return;
    if (index >= 0 && index < this.weaponNodes.length) {
      this.state.currentWeapon = index;
      for (let i = 0; i < this.weaponNodes.length; i++) {
        this.weaponNodes[i].setEnabled(i === index);
      }
      if (this.options.onWeaponChange) {
        this.options.onWeaponChange(this.weapons[index]);
      }
    }
  }

  public togglePause(): void {
    if (this.state.hasLost || this.state.hasWon) return;
    this.state.isPaused = !this.state.isPaused;
    if (this.options.onPauseToggle) {
      this.options.onPauseToggle(this.state.isPaused);
    }
    
    // Stop animations if paused
    if (this.state.isPaused) {
      const currentAnim = this.playerAnimations.get(this.currentPlayerAnimation);
      if (currentAnim) currentAnim.pause();
      const currentGuardAnim = this.guardAnimations.get(this.currentGuardAnimation);
      if (currentGuardAnim) currentGuardAnim.pause();
    } else {
      const currentAnim = this.playerAnimations.get(this.currentPlayerAnimation);
      if (currentAnim) currentAnim.play(true);
      const currentGuardAnim = this.guardAnimations.get(this.currentGuardAnimation);
      if (currentGuardAnim) currentGuardAnim.play(currentGuardAnim.loopAnimation);
      // Reset delta time to avoid jumping logic when unpaused
      this.lastFrameTime = performance.now();
    }
  }

  private update(deltaSeconds: number): void {
    if (this.state.isPaused) return;

    this.syncWeaponSocketToHand();
    this.updatePlayer(deltaSeconds);
    this.updateGuard(deltaSeconds);
    this.updateLiquidTimeVial(deltaSeconds);
    this.updateProjectiles(deltaSeconds);
    this.updateSparkBursts(deltaSeconds);
    this.updateSonar();
    this.updateCameraFade();
    if (this.iFramesRemaining > 0) {
      this.iFramesRemaining = Math.max(0, this.iFramesRemaining - deltaSeconds);
    }
    this.updateCamera();
    this.evaluateGameState();
  }

  private useWeapon(): void {
    if (this.isAttacking) return;

    const weaponIndex = this.state.currentWeapon;
    const playerPos = this.playerPivot.position.clone();
    playerPos.y += 1.0; // Shoot from chest/weapon height
    this.emitNoise(this.playerPivot.position, NOISE_RADIUS_ATTACK);

    // Determine direction player is facing
    const facingDirection = new Vector3(
      Math.sin(this.playerPivot.rotation.y),
      0,
      Math.cos(this.playerPivot.rotation.y)
    );

    if (weaponIndex === 0) {
      // Sword - Trigger Triple_Combo_Attack animation
      this.isAttacking = true;
      const atkAnim = this.playerAnimations.get('Triple_Combo_Attack');
      if (atkAnim) {
        const currentAnim = this.playerAnimations.get(this.currentPlayerAnimation);
        if (currentAnim) currentAnim.stop();
        
        atkAnim.reset();
        atkAnim.play(false);
        this.currentPlayerAnimation = 'Triple_Combo_Attack';
        
        atkAnim.onAnimationEndObservable.addOnce(() => {
          this.isAttacking = false;
        });
      } else {
        // Fallback if animation not found
        this.isAttacking = false;
      }

      // Pick the nearest non-KO'd guard inside sword range; a vent between the
      // player and that guard blocks the swing (Task 2 line-of-sight guard).
      const target = this.nearestLivingGuardWithin(SWORD_RANGE);
      if (target) {
        const origin = {
          x: this.playerPivot.position.x,
          y: this.playerPivot.position.y + PLAYER_EYE_HEIGHT,
          z: this.playerPivot.position.z,
        };
        const los = {
          x: target.pivot.position.x,
          y: target.pivot.position.y + PLAYER_EYE_HEIGHT,
          z: target.pivot.position.z,
        };
        if (!raycastHitsAnyAabb(origin, los, this.colliderAabbs)) {
          const pushDir = target.pivot.position.subtract(this.playerPivot.position);
          pushDir.y = 0;
          pushDir.normalize();
          target.pivot.position.addInPlace(pushDir.scale(2.0));
          this.triggerGuardHitReaction(target);
        }
      }

    } else if (weaponIndex === 1) {
      // Blaster - fast small laser
      this.spawnProjectile(playerPos, facingDirection, 25, 2.0, new Color3(0.8, 0.2, 0.2), 0.2, weaponIndex);
    } else if (weaponIndex === 2) {
      // Sniper - extremely fast, long-range
      this.spawnProjectile(playerPos, facingDirection, 50, 3.0, new Color3(0.2, 0.2, 0.8), 0.1, weaponIndex);
    } else if (weaponIndex === BAZOOKA_WEAPON_INDEX) {
      // Bazooka - slow, big explosive rocket
      this.spawnProjectile(playerPos, facingDirection, 10, 4.0, new Color3(0.8, 0.5, 0.1), 0.6, weaponIndex);
    }
  }

  private spawnProjectile(
    pos: Vector3,
    dir: Vector3,
    speed: number,
    life: number,
    color: Color3,
    size: number,
    weaponIndex: number,
  ): void {
    const proj = MeshBuilder.CreateSphere('projectile', { diameter: size }, this.scene);
    proj.position = pos;
    const mat = new StandardMaterial('projMat', this.scene);
    mat.emissiveColor = color;
    mat.diffuseColor = color;
    proj.material = mat;

    this.projectiles.push({
      mesh: proj,
      direction: dir,
      speed,
      life,
      weaponIndex,
      dying: 0,
    });
  }

  private updateProjectiles(deltaSeconds: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      if (p.dying > 0) {
        p.dying -= deltaSeconds;
        const scale = Math.max(0.001, p.dying / PROJECTILE_HIT_FADE_SECONDS);
        p.mesh.scaling.setAll(scale);
        if (p.dying <= 0) {
          p.mesh.dispose();
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      p.life -= deltaSeconds;
      if (p.life <= 0) {
        p.mesh.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }

      const prev = { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z };
      p.mesh.position.addInPlace(p.direction.scale(p.speed * deltaSeconds));
      const current = { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z };

      // Environment collision (segment test prevents tunnelling on fast shots).
      const hitEnvironment = this.colliderAabbs.some((box) =>
        segmentHitsAabb(prev, current, box),
      );
      if (hitEnvironment) {
        this.handleProjectileImpact(p, p.mesh.position.clone());
        continue;
      }

      // Guard sphere check — first non-KO'd guard the projectile touches stops it.
      let guardHit: Guard | null = null;
      for (const g of this.guards) {
        if (g.knockdown !== null) continue;
        const chest = g.pivot.position.add(new Vector3(0, 1, 0));
        if (Vector3.Distance(p.mesh.position, chest) < 1.0) {
          guardHit = g;
          break;
        }
      }
      if (guardHit) {
        if (p.weaponIndex !== BAZOOKA_WEAPON_INDEX) {
          // Direct hit — bazooka AoE handles its own push.
          guardHit.pivot.position.addInPlace(p.direction.scale(2.0));
          this.triggerGuardHitReaction(guardHit);
        }
        this.handleProjectileImpact(p, p.mesh.position.clone());
      }
    }
  }

  private handleProjectileImpact(
    p: (typeof this.projectiles)[number],
    position: Vector3,
  ): void {
    this.spawnSparkBurst(position, (p.mesh.material as StandardMaterial).emissiveColor.clone());
    if (p.weaponIndex === BAZOOKA_WEAPON_INDEX) {
      this.triggerExplosion(position);
    }
    p.dying = PROJECTILE_HIT_FADE_SECONDS;
  }

  private triggerExplosion(center: Vector3): void {
    const centerP = { x: center.x, y: center.y, z: center.z };
    for (const guard of this.guards) {
      if (guard.knockdown !== null) continue;
      const chest = {
        x: guard.pivot.position.x,
        y: guard.pivot.position.y + 1,
        z: guard.pivot.position.z,
      };
      if (distance3(centerP, chest) > BAZOOKA_EXPLOSION_RADIUS) continue;
      const push = guard.pivot.position.subtract(center);
      push.y = 0;
      if (push.lengthSquared() > 1e-6) {
        push.normalize();
        guard.pivot.position.addInPlace(push.scale(2.5));
      }
      this.triggerGuardHitReaction(guard);
    }
    // Larger, orange spark burst for the explosion itself.
    this.spawnSparkBurst(center, new Color3(1.0, 0.55, 0.15), 16, 0.55);
  }

  /** Nearest non-KO'd guard to the player — used by the sonar display. */
  private nearestSonarGuard(): Guard | null {
    let nearest: Guard | null = null;
    let bestSq = Infinity;
    for (const guard of this.guards) {
      if (guard.knockdown !== null) continue;
      const dx = guard.pivot.position.x - this.playerPivot.position.x;
      const dz = guard.pivot.position.z - this.playerPivot.position.z;
      const sq = dx * dx + dz * dz;
      if (sq < bestSq) {
        bestSq = sq;
        nearest = guard;
      }
    }
    return nearest;
  }

  /** Returns the nearest guard that is not knocked out within `range` metres on the
   *  XZ plane, or null if none qualify. */
  private nearestLivingGuardWithin(range: number): Guard | null {
    let nearest: Guard | null = null;
    let bestSq = range * range;
    for (const guard of this.guards) {
      if (guard.knockdown !== null) continue;
      const dx = guard.pivot.position.x - this.playerPivot.position.x;
      const dz = guard.pivot.position.z - this.playerPivot.position.z;
      const sq = dx * dx + dz * dz;
      if (sq <= bestSq) {
        bestSq = sq;
        nearest = guard;
      }
    }
    return nearest;
  }

  private spawnSparkBurst(
    position: Vector3,
    color: Color3,
    count: number = 8,
    life: number = 0.35,
  ): void {
    for (let i = 0; i < count; i++) {
      const spark = MeshBuilder.CreateSphere(
        `spark_${Date.now()}_${i}`,
        { diameter: 0.1, segments: 4 },
        this.scene,
      );
      const mat = new StandardMaterial('sparkMat', this.scene);
      mat.emissiveColor = color;
      mat.diffuseColor = color;
      spark.material = mat;
      spark.position.copyFrom(position);

      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const speed = 2.5 + Math.random() * 3.5;
      const velocity = new Vector3(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + 2,
        Math.sin(theta) * Math.cos(phi) * speed,
      );
      this.sparkBursts.push({ mesh: spark, velocity, life, maxLife: life });
    }
  }

  private updateSparkBursts(deltaSeconds: number): void {
    for (let i = this.sparkBursts.length - 1; i >= 0; i--) {
      const s = this.sparkBursts[i];
      s.life -= deltaSeconds;
      s.velocity.y -= 9.8 * deltaSeconds;
      s.mesh.position.addInPlace(s.velocity.scale(deltaSeconds));
      const scale = Math.max(0.01, s.life / s.maxLife);
      s.mesh.scaling.setAll(scale);
      if (s.life <= 0) {
        s.mesh.dispose();
        this.sparkBursts.splice(i, 1);
      }
    }
  }

  private bindGuardAnimations(): void {
    this.guardAnimationBindings.idle = this.findGuardAnimationName([
      'idle', 'stand', 'breath', 'wait', 'look', 'rest',
    ]);
    this.guardAnimationBindings.patrol = this.findGuardAnimationName([
      'walk', 'run', 'patrol', 'move', 'locomotion', 'stride',
    ]) ?? this.guardAnimationBindings.idle;
    this.guardAnimationBindings.alert = this.findGuardAnimationName([
      'alert', 'attack', 'roar', 'taunt', 'shout', 'scream', 'threat',
    ]) ?? this.guardAnimationBindings.patrol ?? this.guardAnimationBindings.idle;
    this.guardAnimationBindings.hit = this.findGuardAnimationName([
      'hit', 'hurt', 'damage', 'impact', 'stagger', 'flinch', 'react',
    ]);
    this.guardAnimationBindings.defeated = this.findGuardAnimationName([
      'death', 'dead', 'die', 'defeat', 'fall', 'knockout',
    ]);

    if (!this.guardAnimationBindings.idle) {
      this.guardAnimationBindings.idle = this.guardAnimations.keys().next().value;
    }
    if (!this.guardAnimationBindings.patrol) {
      this.guardAnimationBindings.patrol = this.guardAnimationBindings.idle;
    }
    if (!this.guardAnimationBindings.alert) {
      this.guardAnimationBindings.alert = this.guardAnimationBindings.patrol;
    }
  }

  private findGuardAnimationName(candidates: string[]): string | undefined {
    let bestName: string | undefined;
    let bestScore = -1;

    for (const name of this.guardAnimations.keys()) {
      const normalizedName = normalizeAnimationName(name);
      let score = 0;

      for (const candidate of candidates) {
        const normalizedCandidate = normalizeAnimationName(candidate);
        if (!normalizedCandidate) {
          continue;
        }
        if (normalizedName === normalizedCandidate) {
          score = Math.max(score, 100);
        } else if (normalizedName.startsWith(normalizedCandidate)) {
          score = Math.max(score, 80);
        } else if (normalizedName.includes(normalizedCandidate)) {
          score = Math.max(score, 60);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }

    return bestScore > 0 ? bestName : undefined;
  }

  private playGuardAnimationRole(role: GuardAnimationRole): void {
    const animationName = this.guardAnimationBindings[role];
    if (!animationName || this.currentGuardAnimation === animationName) {
      return;
    }

    const nextAnimation = this.guardAnimations.get(animationName);
    if (!nextAnimation) {
      return;
    }

    const currentAnimation = this.guardAnimations.get(this.currentGuardAnimation);
    if (currentAnimation) {
      currentAnimation.stop();
    }

    const shouldLoop = role !== 'hit' && role !== 'defeated';
    nextAnimation.reset();
    nextAnimation.play(shouldLoop);
    this.currentGuardAnimation = animationName;

    if (!shouldLoop) {
      nextAnimation.onAnimationEndObservable.addOnce(() => {
        if (this.currentGuardAnimation !== animationName) {
          return;
        }
        this.currentGuardAnimation = '';
        if (role === 'hit' && !this.state.hasLost && !this.state.hasWon) {
          this.playGuardAnimationRole('patrol');
        }
      });
    }
  }

  /** Called by melee / projectiles / bazooka AoE when they land on `guard`.
   *  A successful strike is a clean takedown — wake timing scales with difficulty.
   *  No-ops while the guard is already knocked out. */
  private triggerGuardHitReaction(guard: Guard): void {
    if (guard.knockdown !== null) return;

    guard.knockoutCount += 1;
    const difficulty = getDifficulty();
    const wake = GUARD_KNOCKOUT_WAKE_SECONDS[difficulty];
    const drop = this.knockoutDropAmount(guard.knockoutCount, difficulty);

    let pendingRescind = 0;
    if (drop > 0) {
      earn(drop, 'knockout');
      if (difficulty === 'hard') pendingRescind = drop;
    }

    guard.knockdown = { remainingSeconds: wake, pendingRescind };
    // One guard going down plays the shared defeated animation; when 6c adds
    // per-guard animation state this will move onto each guard's own rig.
    this.playGuardAnimationRole('defeated');

    const permanent = wake === Infinity;
    this.updateStatus(
      drop > 0
        ? `Takedown! +${drop} ⬢${permanent ? '' : ` (wakes in ${Math.round(wake)} s)`}`
        : `Takedown!${permanent ? '' : ` (wakes in ${Math.round(wake)} s)`}`,
      'success',
    );
  }

  private knockoutDropAmount(count: number, difficulty: Difficulty): number {
    switch (difficulty) {
      case 'easy':
        return KNOCKOUT_BASE_DROP;
      case 'medium':
        return count === 1 ? KNOCKOUT_BASE_DROP : 0;
      case 'hard':
        return Math.floor(KNOCKOUT_BASE_DROP * Math.pow(0.5, count - 1));
    }
  }

  private wakeGuardFromKnockdown(guard: Guard): void {
    if (!guard.knockdown) return;
    const difficulty = getDifficulty();
    const pendingRescind = guard.knockdown.pendingRescind;
    guard.knockdown = null;

    // Plan Task 4d: a waking guard returns to Suspicious rather than Patrol.
    guard.ai = initialGuardAiState('suspicious');
    this.applyConeColourForGuard(guard);

    if (difficulty === 'hard') {
      if (pendingRescind > 0) spend(pendingRescind);
      // Actual reinforcement spawns land in Task 6e (hatch-driven spawning).
      this.updateStatus(
        'Guard woke and radioed for reinforcements!',
        'alert',
      );
    } else {
      this.updateStatus('Guard is back on their feet.', 'alert');
    }
  }

  private setPlayerAnimation(name: string): void {
    if (this.isAttacking && name !== 'Dead') return;
    if (this.currentPlayerAnimation === name) return;
    const nextAnim = this.playerAnimations.get(name);
    if (!nextAnim) return;

    const currentAnim = this.playerAnimations.get(this.currentPlayerAnimation);
    if (currentAnim) currentAnim.stop();

    nextAnim.play(true);
    this.currentPlayerAnimation = name;
  }

  private updatePlayer(deltaSeconds: number): void {
    if (this.state.hasLost || this.state.hasWon) {
      return;
    }

    const inputX = Number(this.inputState.right) - Number(this.inputState.left);
    const inputZ = Number(this.inputState.forward) - Number(this.inputState.backward);
    const rawDirection = new Vector3(inputX, 0, inputZ);

    // Start from current position; only update x/z if there is directional input
    let nextPosition = this.playerPivot.position.clone();

    let isMoving = false;

    if (rawDirection.lengthSquared() > 0) {
      isMoving = true;
      rawDirection.normalize();

      const cameraForward = this.camera.target.subtract(this.camera.position);
      cameraForward.y = 0;
      cameraForward.normalize();

      const cameraRight = new Vector3(cameraForward.z, 0, -cameraForward.x);
      const moveDirection = cameraForward
        .scale(rawDirection.z)
        .add(cameraRight.scale(rawDirection.x));
      moveDirection.normalize();

      const speed =
        PLAYER_SPEED *
        this.character.stats.speedMultiplier *
        (this.inputState.sprint ? SPRINT_MULTIPLIER : 1);
      
      let tryX = this.playerPivot.position.x + moveDirection.x * speed * deltaSeconds;
      let tryZ = this.playerPivot.position.z + moveDirection.z * speed * deltaSeconds;
      
      tryX = clamp(tryX, -27, 27);
      tryZ = clamp(tryZ, -27, 27);

      // Player-Guard Collision (Capsule-to-Capsule on XZ) — resolve against each
      // guard in turn so the player can't squeeze through a pair of bodies.
      const minDistance = 0.94; // player radius (0.42) + guard radius (0.52)
      for (const guard of this.guards) {
        const dx = tryX - guard.pivot.position.x;
        const dz = tryZ - guard.pivot.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < minDistance && distance > 0.001) {
          const overlap = minDistance - distance;
          tryX += (dx / distance) * overlap;
          tryZ += (dz / distance) * overlap;
          tryX = clamp(tryX, -27, 27);
          tryZ = clamp(tryZ, -27, 27);
        }
      }

      // Environmental Collision
      let nextX = this.playerPivot.position.x;
      let nextZ = this.playerPivot.position.z;

      if (!this.isWallCollision(tryX, this.playerPivot.position.z, this.playerPivot.position.y)) {
        nextX = tryX;
      }
      if (!this.isWallCollision(nextX, tryZ, this.playerPivot.position.y)) {
        nextZ = tryZ;
      }

      nextPosition.x = nextX;
      nextPosition.z = nextZ;

      this.playerPivot.rotationQuaternion = null;
      this.playerPivot.rotation.y = Math.atan2(moveDirection.x, moveDirection.z);
    }

    // Vertical physics — runs every frame so jumps work without horizontal input
    this.verticalVelocity -= GRAVITY * deltaSeconds;
    const terrainY = this.resolveHeight(nextPosition);
    nextPosition.y = this.playerPivot.position.y + this.verticalVelocity * deltaSeconds;

    // Land on terrain when falling OR snap up if clipped through floor while rising
    const fellFromHeight = this.wasAirborne && -this.verticalVelocity >= LANDING_NOISE_SPEED_THRESHOLD;
    if (nextPosition.y <= terrainY) {
      nextPosition.y = terrainY;
      this.verticalVelocity = 0;
      this.canDoubleJump = true;
      if (fellFromHeight) {
        this.emitNoise(this.playerPivot.position, NOISE_RADIUS_LANDING);
      }
    }
    this.wasAirborne = nextPosition.y > terrainY + 0.08;

    this.playerPivot.position.copyFrom(nextPosition);

    if (this.state.hasLost) {
      this.setPlayerAnimation('Dead');
    } else if (isMoving) {
      this.setPlayerAnimation(this.inputState.sprint ? 'Running' : 'Walking');
    } else {
      this.setPlayerAnimation('Idle');
    }
  }

  /** Returns true when the Hud-hud is standing on solid ground and can dash. */
  private isOnGround(): boolean {
    const terrainY = this.resolveHeight(this.playerPivot.position);
    return Math.abs(this.playerPivot.position.y - terrainY) < 0.08;
  }

  private emitNoise(origin: Vector3, radius: number): void {
    this.pendingNoises.push({ origin: origin.clone(), radius });
  }

  private computePlayerVisibleTo(guard: Guard): boolean {
    const guardForward = new Vector3(
      Math.sin(guard.pivot.rotation.y),
      0,
      Math.cos(guard.pivot.rotation.y),
    );
    const heightDiff = this.playerPivot.position.y - guard.pivot.position.y;
    const detectionRange = heightDiff > 1.2 ? VISION_RANGE * 0.6 : VISION_RANGE;
    return isTargetVisible({
      guardPosition: { x: guard.pivot.position.x, z: guard.pivot.position.z },
      guardForward: { x: guardForward.x, z: guardForward.z },
      targetPosition: { x: this.playerPivot.position.x, z: this.playerPivot.position.z },
      maxDistance: detectionRange,
      fovRadians: VISION_FOV,
    });
  }

  /** True when any queued noise this frame is within `min(hearing radius, noise radius)`
   *  of the guard. Multiple guards evaluate the same queue independently. */
  private guardHearsAnyNoise(guard: Guard): boolean {
    for (const n of this.pendingNoises) {
      const dx = guard.pivot.position.x - n.origin.x;
      const dz = guard.pivot.position.z - n.origin.z;
      if (Math.hypot(dx, dz) <= Math.min(GUARD_HEARING_RADIUS, n.radius)) return true;
    }
    return false;
  }

  private static readonly CONE_COLOURS: Record<
    GuardState,
    { diffuse: Color3; emissive: Color3; alpha: number }
  > = {
    patrol: {
      diffuse: new Color3(0.35, 0.6, 0.75),
      emissive: new Color3(0.05, 0.1, 0.12),
      alpha: 0.18,
    },
    returning: {
      diffuse: new Color3(0.35, 0.6, 0.75),
      emissive: new Color3(0.05, 0.1, 0.12),
      alpha: 0.18,
    },
    suspicious: {
      diffuse: new Color3(0.95, 0.8, 0.2),
      emissive: new Color3(0.3, 0.22, 0.02),
      alpha: 0.25,
    },
    investigating: {
      diffuse: new Color3(0.95, 0.8, 0.2),
      emissive: new Color3(0.3, 0.22, 0.02),
      alpha: 0.25,
    },
    alerted: {
      diffuse: new Color3(1.0, 0.55, 0.15),
      emissive: new Color3(0.4, 0.15, 0.02),
      alpha: 0.3,
    },
    chasing: {
      diffuse: new Color3(0.95, 0.18, 0.15),
      emissive: new Color3(0.4, 0.04, 0.04),
      alpha: 0.32,
    },
  };

  private applyConeColourForGuard(guard: Guard): void {
    const mat = guard.visionCone.material as StandardMaterial | null;
    if (!mat) return;
    const palette = GameApp.CONE_COLOURS[guard.ai.state];
    mat.diffuseColor = palette.diffuse;
    mat.emissiveColor = palette.emissive;
    mat.alpha = palette.alpha;
  }

  /** Walks `guard` towards `target` on the XZ plane and returns true when arrived. */
  private walkGuardToward(guard: Guard, target: Vector3, deltaSeconds: number): boolean {
    const toTarget = target.subtract(guard.pivot.position);
    const planarDistance = Math.hypot(toTarget.x, toTarget.z);
    if (planarDistance < 0.15) return true;
    const direction = new Vector3(toTarget.x, 0, toTarget.z).normalize();
    const displacement = direction.scale(GUARD_SPEED * deltaSeconds);
    guard.pivot.position.addInPlace(displacement);
    guard.pivot.position.y = this.resolveHeight(guard.pivot.position);
    guard.pivot.rotationQuaternion = null;
    guard.pivot.rotation.y = Math.atan2(direction.x, direction.z);
    return false;
  }

  private faceTarget(guard: Guard, target: Vector3): void {
    const dx = target.x - guard.pivot.position.x;
    const dz = target.z - guard.pivot.position.z;
    if (Math.hypot(dx, dz) < 1e-4) return;
    guard.pivot.rotationQuaternion = null;
    guard.pivot.rotation.y = Math.atan2(dx, dz);
  }

  private distanceToPatrolTarget(guard: Guard): number {
    return Math.hypot(
      guard.currentPatrolTarget.x - guard.pivot.position.x,
      guard.currentPatrolTarget.z - guard.pivot.position.z,
    );
  }

  /** Picks a fresh semi-random waypoint inside the guard's zone. Used on patrol
   *  arrival (primary use) and on `reset` to re-seed the route. */
  private regeneratePatrolTarget(guard: Guard): void {
    const current = { x: guard.pivot.position.x, z: guard.pivot.position.z };
    const pick = nextPatrolWaypoint(current, guard.zone, this.patrolRng);
    guard.currentPatrolTarget = new Vector3(pick.x, guard.pivot.position.y, pick.z);
  }

  private updateGuard(deltaSeconds: number): void {
    if (this.state.hasLost) {
      this.playGuardAnimationRole('alert');
      this.pendingNoises.length = 0;
      return;
    }

    if (this.state.hasWon) {
      this.playGuardAnimationRole('idle');
      this.pendingNoises.length = 0;
      return;
    }

    // Animation state is still shared — the "loudest" role any active guard wants
    // wins. Task 6c will give each guard its own rig + animation state.
    let desiredAnimation: GuardAnimationRole | null = null;
    const promoteAnim = (role: GuardAnimationRole): void => {
      if (desiredAnimation === null) {
        desiredAnimation = role;
        return;
      }
      const priority: Record<GuardAnimationRole, number> = {
        idle: 0,
        patrol: 1,
        alert: 2,
        hit: 3,
        defeated: 4,
      };
      if (priority[role] > priority[desiredAnimation]) desiredAnimation = role;
    };

    const difficulty = getDifficulty();
    let meleeDamagePending = false;

    for (const guard of this.guards) {
      if (guard.knockdown !== null) {
        promoteAnim('defeated');
        if (Number.isFinite(guard.knockdown.remainingSeconds)) {
          guard.knockdown.remainingSeconds -= deltaSeconds;
          if (guard.knockdown.remainingSeconds <= 0) {
            this.wakeGuardFromKnockdown(guard);
          }
        }
        continue;
      }

      const visible = this.computePlayerVisibleTo(guard);
      const noiseHeard = this.guardHearsAnyNoise(guard);

      if (visible || noiseHeard) {
        guard.lastKnownPlayerPosition = this.playerPivot.position.clone();
      }

      const nearPatrolPath = this.distanceToPatrolTarget(guard) < 1.5;
      let reachedLastKnownPosition = false;
      if (guard.ai.state === 'investigating' && guard.lastKnownPlayerPosition) {
        const dx = guard.pivot.position.x - guard.lastKnownPlayerPosition.x;
        const dz = guard.pivot.position.z - guard.lastKnownPlayerPosition.z;
        if (Math.hypot(dx, dz) < 0.4) reachedLastKnownPosition = true;
      }

      const previousState = guard.ai.state;
      guard.ai = tickGuardAi(guard.ai, {
        visible,
        noiseHeard,
        difficulty,
        reachedLastKnownPosition,
        nearPatrolPath,
        dt: deltaSeconds,
      });

      if (previousState !== guard.ai.state) {
        this.applyConeColourForGuard(guard);
        this.announceGuardStateTransition(previousState, guard.ai.state);
        if (guard.ai.state === 'alerted' && previousState !== 'chasing') {
          this.alarm = bumpAlarm(this.alarm, 'guard_alerted');
        } else if (guard.ai.state === 'chasing' && previousState !== 'alerted') {
          // Skipping alerted straight into chasing (rare — integration layer
          // transition edge) still costs full `chasing` pressure.
          this.alarm = bumpAlarm(this.alarm, 'guard_chasing');
        }
      }

      // Movement by state.
      switch (guard.ai.state) {
        case 'patrol':
        case 'returning': {
          const arrived = this.walkGuardToward(guard, guard.currentPatrolTarget, deltaSeconds);
          if (arrived) {
            promoteAnim('idle');
            this.regeneratePatrolTarget(guard);
          } else {
            promoteAnim('patrol');
          }
          break;
        }
        case 'suspicious':
        case 'alerted': {
          const focus = guard.lastKnownPlayerPosition ?? this.playerPivot.position;
          this.faceTarget(guard, focus);
          promoteAnim('alert');
          break;
        }
        case 'investigating': {
          if (guard.lastKnownPlayerPosition) {
            this.walkGuardToward(guard, guard.lastKnownPlayerPosition, deltaSeconds);
          }
          promoteAnim('patrol');
          break;
        }
        case 'chasing': {
          this.walkGuardToward(guard, this.playerPivot.position, deltaSeconds);
          promoteAnim('patrol');
          break;
        }
      }

      // Guard-Player Collision (Capsule-to-Capsule projection on XZ plane)
      const dx = guard.pivot.position.x - this.playerPivot.position.x;
      const dz = guard.pivot.position.z - this.playerPivot.position.z;
      const distance = Math.hypot(dx, dz);
      const minDistance = 0.94;

      if (distance < minDistance && distance > 0.001) {
        const overlap = minDistance - distance;
        guard.pivot.position.x += (dx / distance) * overlap;
        guard.pivot.position.z += (dz / distance) * overlap;
      }

      // Melee hit: any aggressive guard within catch distance deals damage
      // during the current i-frame window. Multiple guards in range still
      // apply a single damage tick — i-frames gate that on the player side.
      if (
        (guard.ai.state === 'alerted' || guard.ai.state === 'chasing') &&
        distance <= GUARD_CATCH_DISTANCE
      ) {
        meleeDamagePending = true;
      }
    }

    if (desiredAnimation !== null) {
      this.playGuardAnimationRole(desiredAnimation);
    }

    if (meleeDamagePending && this.iFramesRemaining <= 0) {
      this.takeDamage(GUARD_MELEE_DAMAGE[difficulty]);
    }

    // All guards have read this frame's noise queue; discard it.
    this.pendingNoises.length = 0;

    this.updateAlarm(deltaSeconds);
  }

  /** Decays the alarm counter when no guard is actively aware of the player,
   *  and surfaces tier changes. Escalation fires a status toast; decay updates
   *  the HUD silently so the player can feel it cool off. */
  private updateAlarm(deltaSeconds: number): void {
    let anyAware = false;
    for (const guard of this.guards) {
      if (guard.knockdown !== null) continue;
      if (guard.ai.state === 'alerted' || guard.ai.state === 'chasing') {
        anyAware = true;
        break;
      }
    }
    const previousTier = this.alarm.tier;
    this.alarm = tickAlarm(this.alarm, {
      dt: deltaSeconds,
      anyGuardAwareOfPlayer: anyAware,
      difficulty: getDifficulty(),
    });
    if (this.alarm.tier === previousTier) return;

    this.options.onAlarmChange?.(this.alarm.tier);
    if (isTierEscalation(previousTier, this.alarm.tier)) {
      const label = ALARM_TIER_LABELS[this.alarm.tier];
      this.updateStatus(`Alarm: ${label}!`, 'alert');
      // Every escalation into Alert or Evasion pushes one reinforcement through
      // a rooftop hatch (capped by REINFORCEMENT_CAP per run per difficulty).
      if (this.alarm.tier === 'alert' || this.alarm.tier === 'evasion') {
        this.trySpawnReinforcement();
      }
    }
  }

  private announceGuardStateTransition(previous: GuardState, next: GuardState): void {
    const icon = guardStateIcon(next);
    const toneByIcon = { '.': 'neutral', '?': 'neutral', '!': 'alert' } as const;
    const labels: Record<GuardState, string> = {
      patrol: 'Patrol',
      returning: 'Returning to route',
      suspicious: 'Something caught their attention',
      investigating: "Investigating Midnight's last position",
      alerted: 'Baron’s guard locked on!',
      chasing: 'Baron’s guard is chasing!',
    };
    if (icon === '!' || next === 'suspicious' || next === 'investigating') {
      this.updateStatus(`${icon} ${labels[next]}`, toneByIcon[icon]);
    } else if (previous !== 'patrol' && next === 'patrol') {
      this.updateStatus(`${icon} ${labels[next]}`, 'neutral');
    }
  }

  private updateLiquidTimeVial(deltaSeconds: number): void {
    if (!this.liquidTimeVial.isVisible) {
      return;
    }

    this.liquidTimeVial.rotation.y += deltaSeconds * 1.6;
    this.liquidTimeVial.position.y = 1.2 + Math.sin(performance.now() * 0.003) * 0.15;
  }

  /**
   * Crestal Sonar: Automatically spreads the Hud-hud crest and pulses cyan tech glow
   * when threats are within SONAR_RANGE — providing intense 360-degree awareness.
   */
  private updateSonar(): void {
    const playerPos = { x: this.playerPivot.position.x, z: this.playerPivot.position.z };
    // Sonar tracks the nearest active guard — knocked-out guards don't radiate
    // threat, so they're excluded. If none remain, fall back to the last known
    // patrol position of the first guard so the crest doesn't jerk to the origin.
    const nearest = this.nearestSonarGuard();
    const guardPos = nearest
      ? { x: nearest.pivot.position.x, z: nearest.pivot.position.z }
      : { x: this.guards[0]?.pivot.position.x ?? 0, z: this.guards[0]?.pivot.position.z ?? 0 };

    const dir = soundDirection(playerPos, guardPos);
    const dist = Math.hypot(guardPos.x - playerPos.x, guardPos.z - playerPos.z);

    // Rotate the crest anchor slightly to track threat
    if (dir.x !== 0 || dir.z !== 0) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      this.crestAnchor.rotation.y += wrapAngleDelta(targetAngle - this.crestAnchor.rotation.y) * 0.12;
    }

    const matLeft = this.crestPartLeft.material as StandardMaterial;
    const matRight = this.crestPartRight.material as StandardMaterial;

    const sonarRange = SONAR_RANGE * this.character.stats.sonarRangeMultiplier;
    if (dist < sonarRange) {
      const t = 1 - dist / sonarRange;
      // Crest snaps open in surprise/focus
      this.crestPartLeft.rotation.z = -Math.PI / 4;
      this.crestPartRight.rotation.z = Math.PI / 4;

      const glowColor = new Color3(0.0, 0.4 + t * 0.4, 0.6 + t * 0.4);
      matLeft.emissiveColor = glowColor;
      matRight.emissiveColor = glowColor;
      this.options.onSonarChange(`Threat detected! (${Math.round(dist)} m)`);        
        // Use Alert animation if player is standing still
        if (this.currentPlayerAnimation === 'Idle') {
          this.setPlayerAnimation('Alert');
        }    } else {
      // Crest lowered/folded when no threat
      this.crestPartLeft.rotation.z = -Math.PI / 16;
      this.crestPartRight.rotation.z = Math.PI / 16;

      matLeft.emissiveColor = new Color3(0.0, 0.5, 0.8);
      matRight.emissiveColor = new Color3(0.0, 0.5, 0.8);
      this.options.onSonarChange('Scanning\u2026');
    }
  }

  private updateCamera(): void {
    this.camera.target = Vector3.Lerp(
      this.camera.target,
      this.playerPivot.position.add(new Vector3(0, 1.2, 0)),
      0.08,
    );
  }

  private evaluateGameState(): void {
    if (this.state.hasWon || this.state.hasLost) {
      return;
    }

    // (The "guard touches player" loss condition now lives in Task 5's HP pipeline:
    // damage ticks inside updateGuard, and `hasLost` trips only when HP hits 0 with no
    // revive option available.)
    const playerPosition = this.playerPivot.position;

    if (
      !this.state.liquidTimeSecured &&
      Vector3.Distance(playerPosition, this.liquidTimeVial.position) < 1.35
    ) {
      this.state.liquidTimeSecured = true;
      this.state.hasWon = true;
      this.liquidTimeVial.isVisible = false;
      this.updateStatus(
        "Liquid Time secured! The Baron never saw it coming. Press R to run again.",
        'success',
      );
      this.options.onObjectiveChange(
        'The Chronos Heist is a go. Next: Act II \u2014 The Iron Transit.',
      );
    }
  }

  private isWallCollision(x: number, z: number, y: number): boolean {
    const playerRadius = 0.42;
    const playerHeight = 1.4;
    const stepHeight = 0.5;

    for (const c of this.colliders) {
      const minX = c.x - c.w / 2 - playerRadius;
      const maxX = c.x + c.w / 2 + playerRadius;
      const minZ = c.z - c.d / 2 - playerRadius;
      const maxZ = c.z + c.d / 2 + playerRadius;

      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        // Can step onto it?
        if (y + stepHeight >= c.topY) {
          continue; // safe, can step up or already standing on it
        }
        // Beneath it?
        if (y + playerHeight <= c.bottomY) {
          continue; // safe, going under it
        }
        return true; // XZ overlap AND Y overlap -> Wall hit!
      }
    }
    return false;
  }

  /**
   * Returns the floor height (player-pivot y) at the given world position
   * by checking against all registered city block colliders.
   */
  private resolveHeight(position: Vector3): number {
    let maxH = 0.6; // Base terrain ground level
    const stepHeight = 0.5;
    const edgeLeeway = 0.1;
    
    for (const c of this.colliders) {
      if (
        position.x > c.x - c.w / 2 - edgeLeeway &&
        position.x < c.x + c.w / 2 + edgeLeeway &&
        position.z > c.z - c.d / 2 - edgeLeeway &&
        position.z < c.z + c.d / 2 + edgeLeeway
      ) {
        // To step onto it, or to not fall through it, player must be reasonably high
        if (position.y >= c.topY - stepHeight - 0.1) {
          maxH = Math.max(maxH, c.topY);
        }
      }
    }
    
    return maxH;
  }

  private updateStatus(message: string, tone: StatusTone): void {
    this.options.onStatusChange(message, tone);
  }

  private reset(): void {
    this.state.hasLost = false;
    this.state.hasWon = false;
    this.state.liquidTimeSecured = false;
    this.hp = this.character.stats.hp;
    this.iFramesRemaining = 0;
    this.reviveTokenUsed = false;
    this.activeRunSkills = this.character.startingSkills.slice();
    this.options.onHealthChange?.(this.hp, this.character.stats.hp);
    this.verticalVelocity = 0;
    this.canDoubleJump = false;
    this.wasAirborne = false;
    this.liquidTimeVial.isVisible = true;
    this.playerPivot.position = new Vector3(-8, 1.2, -8);
    this.pendingNoises.length = 0;
    // Re-seed the RNG so a fresh run picks fresh patrol paths (and tests that
    // depend on a known run still control their own RNG state).
    this.patrolRng = createRng(Date.now() & 0xffffffff);
    // Dispose reinforcement guards (everything past the starting roster) so a
    // fresh run starts with just the seeded count.
    const startingCount = this.guards.length - this.reinforcementsSpawned;
    for (let i = this.guards.length - 1; i >= startingCount; i--) {
      const g = this.guards[i];
      g.visionCone.dispose();
      g.mesh.dispose();
      g.pivot.dispose();
      this.guards.splice(i, 1);
    }
    for (const guard of this.guards) {
      resetGuard(guard);
      const centre = zoneCentre(guard.zone);
      guard.pivot.position = new Vector3(centre.x, 0.75, centre.z);
      guard.pivot.position.y = this.resolveHeight(guard.pivot.position);
      this.regeneratePatrolTarget(guard);
      this.applyConeColourForGuard(guard);
    }
    for (const hatch of this.hatches) hatch.used = false;
    this.reinforcementsSpawned = 0;
    this.alarm = initialAlarmState();
    this.options.onAlarmChange?.(this.alarm.tier);
    this.playGuardAnimationRole('patrol');
    this.updateStatus('Act I \u2014 The Rainy Rooftops. Slip past the Baron\'s guards.', 'neutral');
    this.options.onObjectiveChange('Plant the tracker on the Baron\'s cane. Reach the Liquid Time sample.');
    this.options.onSonarChange('Scanning\u2026');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Wraps a rotation delta to the shortest arc within [-π, π]. */
function wrapAngleDelta(delta: number): number {
  let d = delta % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function normalizeAnimationName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

void Matrix.Identity();
