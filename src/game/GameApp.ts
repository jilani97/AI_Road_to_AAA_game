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
import { isTargetVisible } from './stealth';

export type StatusTone = 'neutral' | 'alert' | 'success';

interface GameAppOptions {
  canvas: HTMLCanvasElement;
  onStatusChange: (message: string, tone: StatusTone) => void;
  onObjectiveChange: (message: string) => void;
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
  crystalCollected: boolean;
}

const PLAYER_SPEED = 5.5;
const SPRINT_MULTIPLIER = 1.55;
const CAMERA_ORBIT_SPEED = 0.005;
const GUARD_SPEED = 1.9;
const VISION_RANGE = 8.5;
const VISION_FOV = Math.PI * 0.5;

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
    crystalCollected: false,
  };

  private readonly playerPivot: TransformNode;
  private readonly playerMesh: Mesh;
  private readonly playerShadowMesh: Mesh;
  private readonly guardPivot: TransformNode;
  private readonly guardMesh: Mesh;
  private readonly visionCone: Mesh;
  private readonly crystal: Mesh;
  private readonly patrolPoints: Vector3[];

  private activePatrolIndex = 0;
  private lastFrameTime = performance.now();

  constructor(options: GameAppOptions) {
    this.options = options;
    this.engine = new Engine(options.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.03, 0.06, 0.12, 1);

    this.camera = this.createCamera(options.canvas);
    this.setupLighting();
    this.buildEnvironment();

    this.playerPivot = new TransformNode('playerPivot', this.scene);
    this.playerPivot.position = new Vector3(-8, 0.6, -8);
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

    this.guardPivot = new TransformNode('guardPivot', this.scene);
    this.guardPivot.position = new Vector3(4, 0.75, 0);
    this.guardMesh = this.createGuardMesh();
    this.guardMesh.parent = this.guardPivot;

    this.visionCone = this.createVisionCone();
    this.visionCone.parent = this.guardPivot;

    this.crystal = this.createCrystal();
    this.crystal.position = new Vector3(9, 1.2, 8.5);

    this.patrolPoints = [
      new Vector3(4, 0.75, 0),
      new Vector3(7, 0.75, 6),
      new Vector3(1, 0.75, 10),
      new Vector3(-3, 0.75, 4),
    ];

    this.registerInput();
    this.updateStatus('Sneak across the rooftops and steal the crystal.', 'neutral');
    this.options.onObjectiveChange('Avoid the red cone. Reach the glowing crystal.');
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
    hemi.intensity = 0.85;
    hemi.groundColor = new Color3(0.05, 0.06, 0.1);

    const sun = new DirectionalLight('sun', new Vector3(-0.6, -1, -0.2), this.scene);
    sun.position = new Vector3(15, 20, 10);
    sun.intensity = 1.7;
  }

  private buildEnvironment(): void {
    const rooftopMaterial = new StandardMaterial('rooftopMaterial', this.scene);
    rooftopMaterial.diffuseColor = new Color3(0.15, 0.18, 0.28);
    rooftopMaterial.specularColor = new Color3(0.1, 0.1, 0.12);

    const accentMaterial = new StandardMaterial('accentMaterial', this.scene);
    accentMaterial.diffuseColor = new Color3(0.18, 0.26, 0.42);
    accentMaterial.emissiveColor = new Color3(0.01, 0.02, 0.06);

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
  }

  private createPlayerMesh(): Mesh {
    const body = MeshBuilder.CreateCapsule(
      'playerBody',
      { radius: 0.45, height: 1.5, tessellation: 12 },
      this.scene,
    );

    const material = new StandardMaterial('playerMaterial', this.scene);
    material.diffuseColor = new Color3(0.24, 0.7, 0.92);
    material.emissiveColor = new Color3(0.02, 0.05, 0.08);
    body.material = material;

    return body;
  }

  private createGuardMesh(): Mesh {
    const body = MeshBuilder.CreateCapsule(
      'guardBody',
      { radius: 0.48, height: 1.6, tessellation: 12 },
      this.scene,
    );

    const material = new StandardMaterial('guardMaterial', this.scene);
    material.diffuseColor = new Color3(0.86, 0.36, 0.32);
    material.emissiveColor = new Color3(0.12, 0.02, 0.02);
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

  private createCrystal(): Mesh {
    const crystal = MeshBuilder.CreatePolyhedron(
      'crystal',
      { type: 1, size: 0.95 },
      this.scene,
    );

    const material = new StandardMaterial('crystalMaterial', this.scene);
    material.diffuseColor = new Color3(0.44, 0.95, 1);
    material.emissiveColor = new Color3(0.2, 0.45, 0.52);
    material.specularColor = new Color3(0.8, 0.95, 1);
    crystal.material = material;

    return crystal;
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
    this.updateCrystal(deltaSeconds);
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

    if (rawDirection.lengthSquared() === 0) {
      return;
    }

    rawDirection.normalize();

    const cameraForward = this.camera.target.subtract(this.camera.position);
    cameraForward.y = 0;
    cameraForward.normalize();

    const cameraRight = new Vector3(cameraForward.z, 0, -cameraForward.x);
    const moveDirection = cameraForward.scale(rawDirection.z).add(cameraRight.scale(rawDirection.x));
    moveDirection.normalize();

    const speed = PLAYER_SPEED * (this.inputState.sprint ? SPRINT_MULTIPLIER : 1);
    const displacement = moveDirection.scale(speed * deltaSeconds);
    const nextPosition = this.playerPivot.position.add(displacement);
    nextPosition.x = clamp(nextPosition.x, -11, 11);
    nextPosition.z = clamp(nextPosition.z, -11, 11);
    nextPosition.y = this.resolveHeight(nextPosition);

    this.playerPivot.position.copyFrom(nextPosition);
    this.playerPivot.rotationQuaternion = null;
    this.playerPivot.rotation.y = Math.atan2(moveDirection.x, moveDirection.z);
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

  private updateCrystal(deltaSeconds: number): void {
    if (!this.crystal.isVisible) {
      return;
    }

    this.crystal.rotation.y += deltaSeconds * 1.6;
    this.crystal.position.y = 1.2 + Math.sin(performance.now() * 0.003) * 0.15;
  }

  private updateCamera(): void {
    this.camera.target = Vector3.Lerp(this.camera.target, this.playerPivot.position.add(new Vector3(0, 1.2, 0)), 0.08);
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

    const playerVisible = isTargetVisible({
      guardPosition: { x: this.guardPivot.position.x, z: this.guardPivot.position.z },
      guardForward: { x: guardForward.x, z: guardForward.z },
      targetPosition: { x: playerPosition.x, z: playerPosition.z },
      maxDistance: VISION_RANGE,
      fovRadians: VISION_FOV,
    });

    if (playerVisible) {
      this.state.hasLost = true;
      this.updateStatus('You were spotted. Press R to restart.', 'alert');
      this.options.onObjectiveChange('Tip: use the rooftop vents and wider flanks to stay out of sight.');
      return;
    }

    if (!this.state.crystalCollected && Vector3.Distance(playerPosition, this.crystal.position) < 1.35) {
      this.state.crystalCollected = true;
      this.state.hasWon = true;
      this.crystal.isVisible = false;
      this.updateStatus('Crystal secured. Press R to run it again.', 'success');
      this.options.onObjectiveChange('Nice. Next upgrade: add jump, ledges, and a second guard.');
    }
  }

  private resolveHeight(position: Vector3): number {
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
    this.state.crystalCollected = false;
    this.crystal.isVisible = true;
    this.playerPivot.position = new Vector3(-8, 1.2, -8);
    this.guardPivot.position = this.patrolPoints[0].clone();
    this.activePatrolIndex = 1;
    this.updateStatus('Sneak across the rooftops and steal the crystal.', 'neutral');
    this.options.onObjectiveChange('Avoid the red cone. Reach the glowing crystal.');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

void Matrix.Identity();
