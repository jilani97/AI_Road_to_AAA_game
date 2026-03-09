import {
  AnimationGroup,
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
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { isTargetVisible, soundDirection } from './stealth';

export type StatusTone = 'neutral' | 'alert' | 'success';

interface GameAppOptions {
  canvas: HTMLCanvasElement;
  onStatusChange: (message: string, tone: StatusTone) => void;
  onObjectiveChange: (message: string) => void;
  /** Called each frame with the current Crest-Sonar status string. */
  onSonarChange: (message: string) => void;
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
/** Initial upward velocity when the Hud-hud uses ascension dash. */
const ASCENSION_DASH_IMPULSE = 9;
const GRAVITY = 22;
/** Distance within which the sonic-crestal sonar registers guard footsteps. */
const SONAR_RANGE = 13;

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
  /** Root node for the Hud-hud crest — rotates towards targets. */
  private readonly crestAnchor: TransformNode;
  private readonly crestPartLeft: Mesh;
  private readonly crestPartRight: Mesh;
  /** Glowing cyan ocular implant over the right eye — highlights guard positions. */
  private readonly ocularImplant: Mesh;
  private readonly guardPivot: TransformNode;
  private readonly guardMesh: Mesh;
  private readonly visionCone: Mesh;
  /** The Liquid Time sample — the MacGuffin of the Chronos Heist. */
  private readonly liquidTimeVial: Mesh;
  private readonly patrolPoints: Vector3[];
  private readonly colliders: Array<{ x: number, z: number, w: number, d: number, topY: number, bottomY: number }> = [];
  private canDoubleJump = false;

  private activePatrolIndex = 0;
  private lastFrameTime = performance.now();
  /** Vertical velocity for the Hud-hud's ascension dash physics. */
  private verticalVelocity = 0;

  // Track the animations loaded from the player GLB
  private readonly playerAnimations: Map<string, AnimationGroup> = new Map();
  private currentPlayerAnimation: string = 'Idle';

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

    this.guardPivot = new TransformNode('guardPivot', this.scene);
    this.guardPivot.position = new Vector3(14, 0.75, 0);
    this.guardMesh = this.createGuardMesh();
    this.guardMesh.parent = this.guardPivot;

    this.visionCone = this.createVisionCone();
    this.visionCone.parent = this.guardPivot;

    this.liquidTimeVial = this.createLiquidTimeVial();
    this.liquidTimeVial.position = new Vector3(9, 1.2, 8.5);

    this.patrolPoints = [
      new Vector3(14, 0.75, 0),
      new Vector3(0, 0.75, 14),
      new Vector3(-14, 0.75, 0),
      new Vector3(0, 0.75, -14),
    ];

    this.registerInput();
    this.updateStatus('Act I \u2014 The Rainy Rooftops. Slip past the Baron\'s guards.', 'neutral');
    this.options.onObjectiveChange('Plant the tracker on the Baron\'s cane. Reach the Liquid Time sample.');
    this.options.onSonarChange('Scanning\u2026');
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

    const addCollider = (x: number, z: number, w: number, d: number, topY: number, bottomY: number = -100) => {
      this.colliders.push({ x, z, w, d, topY, bottomY });
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
      addCollider(b.x, b.z, b.w, b.d, b.top, -100);
    });

    // Elevated platforms (jump-throughable from below if high enough)
    const pipePlatform = MeshBuilder.CreateBox('pipePlatform', { width: 4, height: 0.25, depth: 4 }, this.scene);
    pipePlatform.position = new Vector3(6.5, 2.0, -5.5);
    pipePlatform.material = neonTrimMaterial;
    addCollider(6.5, -5.5, 4, 4, 2.125, 1.875);

    for (const [px, pz] of [[4.8, -3.8], [8.2, -3.8], [4.8, -7.2], [8.2, -7.2]]) {
      const col = MeshBuilder.CreateCylinder(`pipeCol_${px}_${pz}`, { diameter: 0.32, height: 2.0, tessellation: 8 }, this.scene);
      col.position = new Vector3(px, 1.0, pz);
      col.material = rooftopMaterial;
      addCollider(px, pz, 0.4, 0.4, 2.0, -100);
    }

    const wireBridge = MeshBuilder.CreateBox('wireBridge', { width: 2, height: 0.18, depth: 8 }, this.scene);
    wireBridge.position = new Vector3(-4.5, 2.0, 0);
    wireBridge.material = neonTrimMaterial;
    addCollider(-4.5, 0, 2, 8, 2.09, 1.91);

    for (const bz of [-3.5, 3.5]) {
      const pole = MeshBuilder.CreateCylinder(`bridgePole_${bz}`, { diameter: 0.22, height: 2.0, tessellation: 8 }, this.scene);
      pole.position = new Vector3(-4.5, 1.0, bz);
      pole.material = rooftopMaterial;
      addCollider(-4.5, bz, 0.4, 0.4, 2.0, -100);
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
    });

    return dummyPlayer;
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
      golem.rotation = new Vector3(0, Math.PI, 0);

      // If there are animations (like walk cycle), play the first one
      if (result.animationGroups && result.animationGroups.length > 0) {
        result.animationGroups[0].play(true);
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
              this.verticalVelocity = ASCENSION_DASH_IMPULSE;
              this.canDoubleJump = true;
            } else if (this.canDoubleJump) {
              this.verticalVelocity = ASCENSION_DASH_IMPULSE * 0.85; // slightly weaker second jump
              this.canDoubleJump = false;
            }
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
    this.updateSonar();
    this.updateCamera();
    this.evaluateGameState();
  }

  private setPlayerAnimation(name: string): void {
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

      const speed = PLAYER_SPEED * (this.inputState.sprint ? SPRINT_MULTIPLIER : 1);
      
      let tryX = this.playerPivot.position.x + moveDirection.x * speed * deltaSeconds;
      let tryZ = this.playerPivot.position.z + moveDirection.z * speed * deltaSeconds;
      
      tryX = clamp(tryX, -27, 27);
      tryZ = clamp(tryZ, -27, 27);

      // Player-Guard Collision (Capsule-to-Capsule projection on XZ plane)
      const dx = tryX - this.guardPivot.position.x;
      const dz = tryZ - this.guardPivot.position.z;
      const distance = Math.hypot(dx, dz);
      const minDistance = 0.94; // player radius (0.42) + guard radius (0.52)
      
      if (distance < minDistance && distance > 0.001) {
        const overlap = minDistance - distance;
        tryX += (dx / distance) * overlap;
        tryZ += (dz / distance) * overlap;
        
        tryX = clamp(tryX, -27, 27);
        tryZ = clamp(tryZ, -27, 27);
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
    if (nextPosition.y <= terrainY) {
      nextPosition.y = terrainY;
      this.verticalVelocity = 0;
      this.canDoubleJump = true;
    }

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
    this.guardPivot.position.y = this.resolveHeight(this.guardPivot.position);

    // Guard-Player Collision (Capsule-to-Capsule projection on XZ plane)
    const dx = this.guardPivot.position.x - this.playerPivot.position.x;
    const dz = this.guardPivot.position.z - this.playerPivot.position.z;
    const distance = Math.hypot(dx, dz);
    const minDistance = 0.94; // guard radius (0.52) + player radius (0.42)
    
    if (distance < minDistance && distance > 0.001) {
      const overlap = minDistance - distance;
      this.guardPivot.position.x += (dx / distance) * overlap;
      this.guardPivot.position.z += (dz / distance) * overlap;
    }

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
   * Crestal Sonar: Automatically spreads the Hud-hud crest and pulses cyan tech glow
   * when threats are within SONAR_RANGE — providing intense 360-degree awareness.
   */
  private updateSonar(): void {
    const playerPos = { x: this.playerPivot.position.x, z: this.playerPivot.position.z };
    const guardPos = { x: this.guardPivot.position.x, z: this.guardPivot.position.z };

    const dir = soundDirection(playerPos, guardPos);
    const dist = Math.hypot(
      this.guardPivot.position.x - this.playerPivot.position.x,
      this.guardPivot.position.z - this.playerPivot.position.z,
    );

    // Rotate the crest anchor slightly to track threat
    if (dir.x !== 0 || dir.z !== 0) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      this.crestAnchor.rotation.y += wrapAngleDelta(targetAngle - this.crestAnchor.rotation.y) * 0.12;
    }

    const matLeft = this.crestPartLeft.material as StandardMaterial;
    const matRight = this.crestPartRight.material as StandardMaterial;

    if (dist < SONAR_RANGE) {
      const t = 1 - dist / SONAR_RANGE;
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

    const playerPosition = this.playerPivot.position;
    const guardForward = new Vector3(
      Math.sin(this.guardPivot.rotation.y),
      0,
      Math.cos(this.guardPivot.rotation.y),
    );

    // Vertical stealth bonus: guards lose 40% detection range when the character is on
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
      this.updateStatus("Baron's guard has eyes on Midnight! Press R to restart.", 'alert');
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
    this.verticalVelocity = 0;
    this.canDoubleJump = false;
    this.liquidTimeVial.isVisible = true;
    this.playerPivot.position = new Vector3(-8, 1.2, -8);
    this.guardPivot.position = this.patrolPoints[0].clone();
    this.guardPivot.position.y = this.resolveHeight(this.guardPivot.position);
    this.activePatrolIndex = 1;
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

void Matrix.Identity();
