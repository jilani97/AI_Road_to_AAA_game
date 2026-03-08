import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { isTargetVisible, soundDirection } from './stealth';

export type StatusTone = 'neutral' | 'alert' | 'success';

interface GameAppOptions {
  canvas: HTMLCanvasElement;
  onStatusChange: (message: string, tone: StatusTone) => void;
  onObjectiveChange: (message: string) => void;
  /** Called each frame with the current Ear-dar status string. */
  onEardarChange: (message: string) => void;
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
}

const PLAYER_SPEED = 5.5;
const SPRINT_MULTIPLIER = 1.55;
const CAMERA_ORBIT_SPEED = 0.005;
const GUARD_SPEED = 1.9;
const VISION_RANGE = 8.5;
const VISION_FOV = Math.PI * 0.5;
/** Initial upward velocity when Jax leaps with his spring-like legs. */
const JUMP_IMPULSE = 9;
const GRAVITY = 22;
/** Distance within which the Ear-dar registers guard footsteps. */
const EARDAR_RANGE = 13;

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
  };

  private readonly playerPivot: TransformNode;
  private readonly playerMesh: Mesh;
  private readonly playerShadowMesh: Mesh;
  /** Root node for the two jerboa ears — rotates to face the loudest guard. */
  private readonly earAnchor: TransformNode;
  private readonly leftEar: Mesh;
  private readonly rightEar: Mesh;
  /** Cracked neon monocle over Jax's left eye — highlights guard positions. */
  private readonly monocle: Mesh;
  private readonly guardPivot: TransformNode;
  private readonly guardMesh: Mesh;
  private readonly visionCone: Mesh;
  /** The Liquid Time sample — the MacGuffin of the Chronos Heist. */
  private readonly liquidTimeVial: Mesh;
  private readonly patrolPoints: Vector3[];

  private activePatrolIndex = 0;
  private lastFrameTime = performance.now();
  /** Vertical velocity for Jax's jump physics. */
  private verticalVelocity = 0;

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
    this.buildEnvironment();

    this.playerPivot = new TransformNode('playerPivot', this.scene);
    this.playerPivot.position = new Vector3(-8, 1.2, -8);
    this.playerMesh = this.createPlayerMesh();
    this.playerMesh.parent = this.playerPivot;
    this.playerMesh.position = Vector3.Zero();

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

    // Ear-dar: two large jerboa ears that rotate as a unit toward guard footsteps
    this.earAnchor = new TransformNode('earAnchor', this.scene);
    this.earAnchor.parent = this.playerPivot;
    this.earAnchor.position = new Vector3(0, 0.9, 0);

    this.leftEar = this.createEarMesh('leftEar');
    this.leftEar.parent = this.earAnchor;
    this.leftEar.position = new Vector3(-0.32, 0.42, 0);

    this.rightEar = this.createEarMesh('rightEar');
    this.rightEar.parent = this.earAnchor;
    this.rightEar.position = new Vector3(0.32, 0.42, 0);

    // Cracked neon monocle over Jax's left eye
    this.monocle = this.createMonocle();
    this.monocle.parent = this.playerPivot;
    this.monocle.position = new Vector3(0.27, 0.5, 0.3);

    this.guardPivot = new TransformNode('guardPivot', this.scene);
    this.guardPivot.position = new Vector3(4, 0.75, 0);
    this.guardMesh = this.createGuardMesh();
    this.guardMesh.parent = this.guardPivot;

    this.visionCone = this.createVisionCone();
    this.visionCone.parent = this.guardPivot;

    this.liquidTimeVial = this.createLiquidTimeVial();
    this.liquidTimeVial.position = new Vector3(9, 1.2, 8.5);

    this.patrolPoints = [
      new Vector3(4, 0.75, 0),
      new Vector3(7, 0.75, 6),
      new Vector3(1, 0.75, 10),
      new Vector3(-3, 0.75, 4),
    ];

    this.registerInput();
    this.updateStatus('Act I \u2014 The Rainy Rooftops. Slip past the Baron\'s guards.', 'neutral');
    this.options.onObjectiveChange('Plant the tracker on the Baron\'s cane. Reach the Liquid Time sample.');
    this.options.onEardarChange('Listening\u2026');
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
    camera.upperRadiusLimit = 24;
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

    const roof = MeshBuilder.CreateGround('roof', { width: 28, height: 28 }, this.scene);
    roof.material = rooftopMaterial;

    const centralPad = MeshBuilder.CreateBox(
      'centralPad',
      { width: 8, height: 0.8, depth: 8 },
      this.scene,
    );
    centralPad.position = new Vector3(0, 0.4, 0);
    centralPad.material = accentMaterial;

    const raisedRoof = MeshBuilder.CreateBox(
      'raisedRoof',
      { width: 10, height: 1.2, depth: 6 },
      this.scene,
    );
    raisedRoof.position = new Vector3(-8, 0.6, -8);
    raisedRoof.material = accentMaterial;

    const objectiveRoof = MeshBuilder.CreateBox(
      'objectiveRoof',
      { width: 8, height: 1, depth: 8 },
      this.scene,
    );
    objectiveRoof.position = new Vector3(8, 0.5, 8);
    objectiveRoof.material = accentMaterial;

    // --- Elevated pipe platform (right side) ---
    // Reachable by jumping from base terrain (y~0.6 + JUMP_IMPULSE^2/2*GRAVITY ~ 2.4)
    const pipePlatform = MeshBuilder.CreateBox(
      'pipePlatform',
      { width: 4, height: 0.25, depth: 4 },
      this.scene,
    );
    pipePlatform.position = new Vector3(6.5, 2.0, -5.5);
    pipePlatform.material = neonTrimMaterial;

    // Support columns for the pipe platform
    for (const [px, pz] of [
      [4.8, -3.8],
      [8.2, -3.8],
      [4.8, -7.2],
      [8.2, -7.2],
    ] as [number, number][]) {
      const col = MeshBuilder.CreateCylinder(
        `pipeCol_${px}_${pz}`,
        { diameter: 0.32, height: 2.0, tessellation: 8 },
        this.scene,
      );
      col.position = new Vector3(px, 1.0, pz);
      col.material = rooftopMaterial;
    }

    // --- Wire bridge (left side) ---
    // Connects the map across the gap at an elevated height
    const wireBridge = MeshBuilder.CreateBox(
      'wireBridge',
      { width: 2, height: 0.18, depth: 8 },
      this.scene,
    );
    wireBridge.position = new Vector3(-4.5, 2.0, 0);
    wireBridge.material = neonTrimMaterial;

    // Support poles for the wire bridge
    for (const bz of [-3.5, 3.5]) {
      const pole = MeshBuilder.CreateCylinder(
        `bridgePole_${bz}`,
        { diameter: 0.22, height: 2.0, tessellation: 8 },
        this.scene,
      );
      pole.position = new Vector3(-4.5, 1.0, bz);
      pole.material = rooftopMaterial;
    }

    // Perimeter walls
    [
      new Vector3(-12.5, 1.4, 0),
      new Vector3(0, 1.4, -12.5),
      new Vector3(12.5, 1.4, 0),
      new Vector3(0, 1.4, 12.5),
    ].forEach((position, index) => {
      const wall = MeshBuilder.CreateBox(
        `wall${index}`,
        {
          width: Math.abs(position.x) > 0 ? 1 : 28,
          height: 2.8,
          depth: Math.abs(position.z) > 0 ? 1 : 28,
        },
        this.scene,
      );

      wall.position = position;
      wall.material = rooftopMaterial;
    });

    // Rooftop vents (obstacles / cover)
    [
      new Vector3(-3, 1.2, -2),
      new Vector3(5.5, 1.2, -5),
      new Vector3(-6, 1.2, 6),
      new Vector3(1.5, 1.2, 5.5),
    ].forEach((position, index) => {
      const vent = MeshBuilder.CreateBox(
        `vent${index}`,
        { width: 2.4, height: 1.6, depth: 2.4 },
        this.scene,
      );
      vent.position = position;
      vent.material = rooftopMaterial;
    });

    // Neon teal trim strips along the central pad edges
    for (const [ex, ez, ew, ed] of [
      [0, -4.08, 8, 0.12],
      [0, 4.08, 8, 0.12],
      [-4.08, 0, 0.12, 8],
      [4.08, 0, 0.12, 8],
    ] as [number, number, number, number][]) {
      const trim = MeshBuilder.CreateBox(
        `trim_${ex}_${ez}`,
        { width: ew, height: 0.1, depth: ed },
        this.scene,
      );
      trim.position = new Vector3(ex, 0.85, ez);
      trim.material = neonTrimMaterial;
    }
  }

  /** Jax's tech-vest body — dark navy with faint neon blue trim. */
  private createPlayerMesh(): Mesh {
    const body = MeshBuilder.CreateCapsule(
      'playerBody',
      { radius: 0.42, height: 1.4, tessellation: 12 },
      this.scene,
    );

    const material = new StandardMaterial('playerMaterial', this.scene);
    material.diffuseColor = new Color3(0.1, 0.14, 0.22);
    material.emissiveColor = new Color3(0.02, 0.06, 0.1);
    material.specularColor = new Color3(0.4, 0.6, 0.85);
    body.material = material;

    return body;
  }

  /** One of Jax's large jerboa ears — tall thin capsule with soft inner glow. */
  private createEarMesh(name: string): Mesh {
    const ear = MeshBuilder.CreateCapsule(
      name,
      { radius: 0.075, height: 0.65, tessellation: 8 },
      this.scene,
    );

    const material = new StandardMaterial(`${name}Material`, this.scene);
    material.diffuseColor = new Color3(0.16, 0.2, 0.3);
    material.emissiveColor = new Color3(0.02, 0.08, 0.16);
    ear.material = material;

    return ear;
  }

  /** Cracked neon monocle — tiny sphere with bright teal emissive glow. */
  private createMonocle(): Mesh {
    const monocle = MeshBuilder.CreateSphere(
      'monocle',
      { diameter: 0.17, segments: 6 },
      this.scene,
    );

    const material = new StandardMaterial('monocleMaterial', this.scene);
    material.diffuseColor = new Color3(0.1, 0.9, 1.0);
    material.emissiveColor = new Color3(0.04, 0.52, 0.68);
    material.alpha = 0.88;
    monocle.material = material;

    return monocle;
  }

  /** Baron von Steer's guard — larger, darker, more threatening. */
  private createGuardMesh(): Mesh {
    const body = MeshBuilder.CreateCapsule(
      'guardBody',
      { radius: 0.52, height: 1.75, tessellation: 12 },
      this.scene,
    );

    const material = new StandardMaterial('guardMaterial', this.scene);
    material.diffuseColor = new Color3(0.52, 0.14, 0.11);
    material.emissiveColor = new Color3(0.14, 0.02, 0.02);
    material.specularColor = new Color3(0.35, 0.08, 0.08);
    body.material = material;

    return body;
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
          // Jax's powerful spring-like legs — jump when on solid ground
          if (!this.state.hasLost && !this.state.hasWon && this.isOnGround()) {
            this.verticalVelocity = JUMP_IMPULSE;
          }
          break;
        case 'KeyR':
          if (this.state.hasLost || this.state.hasWon) {
            this.reset();
          }
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

  private update(deltaSeconds: number): void {
    this.updatePlayer(deltaSeconds);
    this.updateGuard(deltaSeconds);
    this.updateLiquidTimeVial(deltaSeconds);
    this.updateEardar();
    this.updateCamera();
    this.evaluateGameState();
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

    if (rawDirection.lengthSquared() > 0) {
      rawDirection.normalize();

      const cameraForward = this.camera.target.subtract(this.camera.position);
      cameraForward.y = 0;
      cameraForward.normalize();

      const cameraRight = new Vector3(cameraForward.z, 0, -cameraForward.x);
      const moveDirection = cameraForward
        .scale(rawDirection.z)
        .add(cameraRight.scale(rawDirection.x));
      moveDirection.normalize();

      const speed = PLAYER_SPEED * (this.inputState.sprint ? SPRINT_MULTIPLIER : 1);
      const displacement = moveDirection.scale(speed * deltaSeconds);
      nextPosition = nextPosition.add(displacement);
      nextPosition.x = clamp(nextPosition.x, -11, 11);
      nextPosition.z = clamp(nextPosition.z, -11, 11);

      this.playerPivot.rotationQuaternion = null;
      this.playerPivot.rotation.y = Math.atan2(moveDirection.x, moveDirection.z);
    }

    // Vertical physics — runs every frame so jumps work without horizontal input
    this.verticalVelocity -= GRAVITY * deltaSeconds;
    const terrainY = this.resolveHeight(nextPosition);
    nextPosition.y = this.playerPivot.position.y + this.verticalVelocity * deltaSeconds;

    // Land on terrain when falling OR snap up if clipped through floor while rising
    if (nextPosition.y <= terrainY) {
      nextPosition.y = terrainY;
      this.verticalVelocity = 0;
    }

    this.playerPivot.position.copyFrom(nextPosition);
  }

  /** Returns true when Jax is standing on solid ground and can jump. */
  private isOnGround(): boolean {
    const terrainY = this.resolveHeight(this.playerPivot.position);
    return Math.abs(this.playerPivot.position.y - terrainY) < 0.08;
  }

  private updateGuard(deltaSeconds: number): void {
    const target = this.patrolPoints[this.activePatrolIndex];
    const toTarget = target.subtract(this.guardPivot.position);
    const planarDistance = Math.hypot(toTarget.x, toTarget.z);

    if (planarDistance < 0.15) {
      this.activePatrolIndex = (this.activePatrolIndex + 1) % this.patrolPoints.length;
      return;
    }

    const direction = new Vector3(toTarget.x, 0, toTarget.z).normalize();
    const displacement = direction.scale(GUARD_SPEED * deltaSeconds);

    this.guardPivot.position.addInPlace(displacement);
    this.guardPivot.rotationQuaternion = null;
    this.guardPivot.rotation.y = Math.atan2(direction.x, direction.z);
  }

  private updateLiquidTimeVial(deltaSeconds: number): void {
    if (!this.liquidTimeVial.isVisible) {
      return;
    }

    this.liquidTimeVial.rotation.y += deltaSeconds * 1.6;
    this.liquidTimeVial.position.y = 1.2 + Math.sin(performance.now() * 0.003) * 0.15;
  }

  /**
   * Ear-dar: rotate Jax's ears toward the guard and pulse their neon glow
   * when footsteps are within EARDAR_RANGE — the primary stealth awareness cue.
   */
  private updateEardar(): void {
    const playerPos = { x: this.playerPivot.position.x, z: this.playerPivot.position.z };
    const guardPos = { x: this.guardPivot.position.x, z: this.guardPivot.position.z };

    const dir = soundDirection(playerPos, guardPos);
    const dist = Math.hypot(
      this.guardPivot.position.x - this.playerPivot.position.x,
      this.guardPivot.position.z - this.playerPivot.position.z,
    );

    // Smoothly rotate the ear anchor to face guard direction (world-space y-rotation)
    if (dir.x !== 0 || dir.z !== 0) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      this.earAnchor.rotation.y += wrapAngleDelta(targetAngle - this.earAnchor.rotation.y) * 0.12;
    }

    // Pulse ear emissive glow based on guard proximity
    const leftMat = this.leftEar.material as StandardMaterial;
    const rightMat = this.rightEar.material as StandardMaterial;

    if (dist < EARDAR_RANGE) {
      const t = 1 - dist / EARDAR_RANGE;
      const glowColor = new Color3(0.05 + t * 0.15, 0.18 + t * 0.48, 0.3 + t * 0.55);
      leftMat.emissiveColor = glowColor;
      rightMat.emissiveColor = glowColor;
      this.options.onEardarChange(`Footsteps detected! (${Math.round(dist)} m)`);
    } else {
      leftMat.emissiveColor = new Color3(0.02, 0.08, 0.16);
      rightMat.emissiveColor = new Color3(0.02, 0.08, 0.16);
      this.options.onEardarChange('Listening\u2026');
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

    const playerPosition = this.playerPivot.position;
    const guardForward = new Vector3(
      Math.sin(this.guardPivot.rotation.y),
      0,
      Math.cos(this.guardPivot.rotation.y),
    );

    // Vertical stealth bonus: guards lose 40% detection range when Jax is on
    // high ground — the floor IS the danger, platforms ARE the safe zone.
    const heightDiff = playerPosition.y - this.guardPivot.position.y;
    const detectionRange = heightDiff > 1.2 ? VISION_RANGE * 0.6 : VISION_RANGE;

    const playerVisible = isTargetVisible({
      guardPosition: { x: this.guardPivot.position.x, z: this.guardPivot.position.z },
      guardForward: { x: guardForward.x, z: guardForward.z },
      targetPosition: { x: playerPosition.x, z: playerPosition.z },
      maxDistance: detectionRange,
      fovRadians: VISION_FOV,
    });

    if (playerVisible) {
      this.state.hasLost = true;
      this.updateStatus("Baron's guard has eyes on Jax! Press R to restart.", 'alert');
      this.options.onObjectiveChange(
        "Tip: use the pipe platform and wire bridge \u2014 stay above the guard's sightline.",
      );
      return;
    }

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

  /**
   * Returns the floor height (player-pivot y) at the given world position.
   *
   * Elevated platforms are only activated when the player is already at or
   * above the access threshold (currentY >= 1.7), preventing an accidental
   * upward snap when the player walks beneath them at ground level.
   */
  private resolveHeight(position: Vector3): number {
    const currentY = position.y;

    // Elevated pipe platform — right side of the map (x: 4.5–8.5, z: -7.5–-3.5)
    if (
      position.x > 4.5 &&
      position.x < 8.5 &&
      position.z < -3.5 &&
      position.z > -7.5 &&
      currentY >= 1.7
    ) {
      return 2.12;
    }

    // Elevated wire bridge — left side of the map (x: -5.5–-3.5, z: -4–4)
    if (
      position.x > -5.5 &&
      position.x < -3.5 &&
      Math.abs(position.z) < 4.0 &&
      currentY >= 1.7
    ) {
      return 2.12;
    }

    // Base terrain levels
    if (position.x < -3.5 && position.z < -3.5) {
      return 1.2;
    }

    if (position.x > 4.25 && position.z > 4.25) {
      return 1.1;
    }

    if (Math.abs(position.x) < 4 && Math.abs(position.z) < 4) {
      return 1;
    }

    return 0.6;
  }

  private updateStatus(message: string, tone: StatusTone): void {
    this.options.onStatusChange(message, tone);
  }

  private reset(): void {
    this.state.hasLost = false;
    this.state.hasWon = false;
    this.state.liquidTimeSecured = false;
    this.verticalVelocity = 0;
    this.liquidTimeVial.isVisible = true;
    this.playerPivot.position = new Vector3(-8, 1.2, -8);
    this.guardPivot.position = this.patrolPoints[0].clone();
    this.activePatrolIndex = 1;
    this.updateStatus('Act I \u2014 The Rainy Rooftops. Slip past the Baron\'s guards.', 'neutral');
    this.options.onObjectiveChange('Plant the tracker on the Baron\'s cane. Reach the Liquid Time sample.');
    this.options.onEardarChange('Listening\u2026');
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

void Matrix.Identity();
