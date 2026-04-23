import './style.css';
import { GameApp } from './game/GameApp';
import {
  loadSettings,
  saveSettings,
  type CameraMinDistance,
  type CameraMode,
  type GameSettings,
  type PostFxSettings,
  type ShadowTier,
} from './game/settings';

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root not found');
}

appRoot.innerHTML = `
  <div class="shell">
    <canvas id="game-canvas"></canvas>
    <aside class="hud">
      <h1>Neon Tail</h1>
      <p class="subtitle">The Midnight Syndicate</p>
      <div id="status" class="card">Act I — The Rainy Rooftops. Slip past the Baron's guards.</div>
      <div class="card">
        <h2>Controls</h2>
        <ul>
          <li><span>Move</span><strong>W A S D</strong></li>
          <li><span>Attack/Fire</span><strong>Left Click</strong></li>
          <li><span>Ascension Dash</span><strong>Space</strong></li>
          <li><span>Sprint</span><strong>Shift</strong></li>
          <li><span>Camera</span><strong>Right-drag</strong></li>
          <li><span>Weapon</span><strong>1 - 4</strong></li>
          <li><span>Pause</span><strong>Esc</strong></li>
          <li><span>Restart</span><strong>R</strong></li>
        </ul>
      </div>
      <div class="card">
        <h2>Loadout</h2>
        <p id="weapon-status">Equipped: Sword</p>
      </div>
      <div class="card">
        <h2>Objective</h2>
        <p id="objective">Plant the tracker on the Baron's cane. Reach the Liquid Time sample.</p>
      </div>
      <div class="card sonar-card">
        <h2>Sonic Crest</h2>
        <p id="sonar-status">Scanning&hellip;</p>
      </div>
    </aside>
  </div>
  <div id="pause-menu" class="overlay hidden">
    <div class="menu-box">
      <h2>Paused</h2>
      <button id="btn-resume">Resume</button>
      <button id="btn-restart">Restart Level</button>
      <div class="settings">
        <h3>Graphic Settings</h3>
        <div class="setting-group">
          <span class="setting-label">Shadows</span>
          <div class="segmented" role="radiogroup" aria-label="Shadow quality">
            <label><input type="radio" name="shadow-tier" value="low"> Low</label>
            <label><input type="radio" name="shadow-tier" value="med"> Med</label>
            <label><input type="radio" name="shadow-tier" value="high"> High</label>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Post-Processing</span>
          <label class="setting-toggle"><input type="checkbox" id="chk-bloom"> Bloom</label>
          <label class="setting-toggle"><input type="checkbox" id="chk-fxaa"> FXAA</label>
          <label class="setting-toggle"><input type="checkbox" id="chk-chromatic"> Chromatic Aberration</label>
        </div>
        <div class="setting-group">
          <span class="setting-label">Camera Mode</span>
          <div class="segmented" role="radiogroup" aria-label="Camera mode">
            <label><input type="radio" name="camera-mode" value="orbit"> Orbit</label>
            <label><input type="radio" name="camera-mode" value="fade"> Fade</label>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Min Camera Distance</span>
          <div class="segmented" role="radiogroup" aria-label="Min camera distance">
            <label><input type="radio" name="camera-min" value="2"> 2 m</label>
            <label><input type="radio" name="camera-min" value="4"> 4 m</label>
            <label><input type="radio" name="camera-min" value="8"> 8 m</label>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const statusElement = document.querySelector<HTMLDivElement>('#status');
const objectiveElement = document.querySelector<HTMLParagraphElement>('#objective');
const sonarElement = document.querySelector<HTMLParagraphElement>('#sonar-status');
const weaponElement = document.querySelector<HTMLParagraphElement>('#weapon-status');
const pauseMenu = document.querySelector<HTMLDivElement>('#pause-menu');
const btnResume = document.querySelector<HTMLButtonElement>('#btn-resume');
const btnRestart = document.querySelector<HTMLButtonElement>('#btn-restart');

if (!canvas || !statusElement || !objectiveElement || !sonarElement || !weaponElement || !pauseMenu || !btnResume || !btnRestart) {
  throw new Error('Game UI elements not found');
}

const game = new GameApp({
  canvas,
  onStatusChange: (message, tone) => {
    statusElement.textContent = message;
    statusElement.dataset.tone = tone;
  },
  onObjectiveChange: (message) => {
    objectiveElement.textContent = message;
  },
  onSonarChange: (message) => {
    sonarElement.textContent = message;
  },
  onWeaponChange: (weapon) => {
    weaponElement.textContent = `Equipped: ${weapon}`;
  },
  onPauseToggle: (isPaused) => {
    if (isPaused) {
      pauseMenu.classList.remove('hidden');
    } else {
      pauseMenu.classList.add('hidden');
    }
  }
});

btnResume.addEventListener('click', () => {
  game.togglePause();
});

btnRestart.addEventListener('click', () => {
  game.togglePause(); // unpause first
  // simulate pressing R
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
});

const shadowTierInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="shadow-tier"]'),
);
const postFxInputs: Record<keyof PostFxSettings, HTMLInputElement | null> = {
  bloom: document.querySelector<HTMLInputElement>('#chk-bloom'),
  fxaa: document.querySelector<HTMLInputElement>('#chk-fxaa'),
  chromaticAberration: document.querySelector<HTMLInputElement>('#chk-chromatic'),
};
const cameraModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="camera-mode"]'),
);
const cameraMinInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="camera-min"]'),
);

let settings: GameSettings = loadSettings();

function applySettings(): void {
  game.applyGraphicsSettings(settings);
  game.applyCameraSettings(settings.camera);
}

function hydrateGraphicsControls(current: GameSettings): void {
  for (const input of shadowTierInputs) {
    input.checked = input.value === current.shadowTier;
  }
  if (postFxInputs.bloom) postFxInputs.bloom.checked = current.postfx.bloom;
  if (postFxInputs.fxaa) postFxInputs.fxaa.checked = current.postfx.fxaa;
  if (postFxInputs.chromaticAberration)
    postFxInputs.chromaticAberration.checked = current.postfx.chromaticAberration;
  for (const input of cameraModeInputs) {
    input.checked = input.value === current.camera.mode;
  }
  for (const input of cameraMinInputs) {
    input.checked = Number(input.value) === current.camera.minDistance;
  }
}

hydrateGraphicsControls(settings);

for (const input of shadowTierInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    settings = { ...settings, shadowTier: input.value as ShadowTier };
    saveSettings(settings);
    applySettings();
  });
}

for (const key of Object.keys(postFxInputs) as Array<keyof PostFxSettings>) {
  const input = postFxInputs[key];
  if (!input) continue;
  input.addEventListener('change', () => {
    settings = {
      ...settings,
      postfx: { ...settings.postfx, [key]: input.checked },
    };
    saveSettings(settings);
    applySettings();
  });
}

for (const input of cameraModeInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    settings = {
      ...settings,
      camera: { ...settings.camera, mode: input.value as CameraMode },
    };
    saveSettings(settings);
    applySettings();
  });
}

for (const input of cameraMinInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    settings = {
      ...settings,
      camera: {
        ...settings.camera,
        minDistance: Number(input.value) as CameraMinDistance,
      },
    };
    saveSettings(settings);
    applySettings();
  });
}

game.start();
applySettings();
