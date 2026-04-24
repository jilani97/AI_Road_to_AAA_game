import './style.css';
import { GameApp } from './game/GameApp';
import { hydrateDifficulty, setDifficulty } from './game/difficulty';
import {
  CHARACTER_ORDER,
  getCharacter,
  isCharacterId,
  loadPersistedCharacter,
  persistCharacter,
  type CharacterId,
} from './game/characters';
import { getSkill } from './game/skills';
import {
  loadSettings,
  saveSettings,
  type CameraMinDistance,
  type CameraMode,
  type Difficulty,
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
      <div class="card">
        <h2>Health</h2>
        <div id="hp-pips" class="hp-pips"></div>
      </div>
      <div class="card">
        <h2>Alarm</h2>
        <div id="alarm-tier" class="alarm-tier" data-tier="normal">Normal</div>
      </div>
      <div class="card">
        <h2>Coins</h2>
        <div id="currency" class="currency"><span class="currency-icon" aria-hidden="true">⬢</span><span id="currency-amount">0</span></div>
      </div>
      <div class="card sonar-card">
        <h2>Sonic Crest</h2>
        <p id="sonar-status">Scanning&hellip;</p>
      </div>
    </aside>
  </div>
  <div id="damage-vignette" class="damage-vignette"></div>
  <div id="character-select" class="overlay">
    <div class="menu-box character-select-box">
      <h2>Choose your operative</h2>
      <p class="character-select-subtitle">The Midnight Syndicate — Act I: The Rainy Rooftops</p>
      <div id="character-grid" class="character-grid"></div>
      <button id="btn-start-run">Start Run</button>
    </div>
  </div>
  <div id="pause-menu" class="overlay hidden">
    <div class="menu-box">
      <h2>Paused</h2>
      <button id="btn-resume">Resume</button>
      <button id="btn-restart">Restart Level</button>
      <div class="settings">
        <h3>Gameplay</h3>
        <div class="setting-group">
          <span class="setting-label">Difficulty</span>
          <div class="segmented" role="radiogroup" aria-label="Difficulty">
            <label><input type="radio" name="difficulty" value="easy"> Easy</label>
            <label><input type="radio" name="difficulty" value="medium"> Medium</label>
            <label><input type="radio" name="difficulty" value="hard"> Hard</label>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Accessibility</span>
          <label class="setting-toggle"><input type="checkbox" id="chk-reduce-motion"> Reduce camera motion</label>
        </div>
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
const hpPipsElement = document.querySelector<HTMLDivElement>('#hp-pips');
const alarmElement = document.querySelector<HTMLDivElement>('#alarm-tier');
const currencyAmountElement = document.querySelector<HTMLSpanElement>('#currency-amount');
const damageVignette = document.querySelector<HTMLDivElement>('#damage-vignette');
const shellElement = document.querySelector<HTMLDivElement>('.shell');
const characterSelectOverlay = document.querySelector<HTMLDivElement>('#character-select');
const characterGrid = document.querySelector<HTMLDivElement>('#character-grid');
const btnStartRun = document.querySelector<HTMLButtonElement>('#btn-start-run');

if (
  !canvas ||
  !statusElement ||
  !objectiveElement ||
  !sonarElement ||
  !weaponElement ||
  !pauseMenu ||
  !btnResume ||
  !btnRestart ||
  !hpPipsElement ||
  !alarmElement ||
  !currencyAmountElement ||
  !damageVignette ||
  !shellElement ||
  !characterSelectOverlay ||
  !characterGrid ||
  !btnStartRun
) {
  throw new Error('Game UI elements not found');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function formatMultiplier(n: number): string {
  const fixed = n.toFixed(2);
  return `${fixed.replace(/\.?0+$/, '')}×`;
}

let selectedCharacter: CharacterId = loadPersistedCharacter();

function renderCharacterGrid(): void {
  const cards = CHARACTER_ORDER.map((id) => {
    const c = getCharacter(id);
    const starters = c.startingSkills
      .map((s) => getSkill(s)?.name ?? s)
      .map(escapeHtml)
      .join(' · ');
    const checked = id === selectedCharacter ? 'checked' : '';
    return `
      <label class="character-card" data-character="${id}">
        <input type="radio" name="character" value="${id}" ${checked}>
        <div class="character-card-body">
          <h3>${escapeHtml(c.name)}</h3>
          <p class="archetype">${escapeHtml(c.archetype)}</p>
          <dl class="character-stats">
            <div><dt>HP</dt><dd>${c.stats.hp}</dd></div>
            <div><dt>Speed</dt><dd>${formatMultiplier(c.stats.speedMultiplier)}</dd></div>
            <div><dt>Jump</dt><dd>${formatMultiplier(c.stats.jumpMultiplier)}</dd></div>
            <div><dt>Sonar</dt><dd>${formatMultiplier(c.stats.sonarRangeMultiplier)}</dd></div>
            <div><dt>Damage</dt><dd>${formatMultiplier(c.stats.weaponDamageMultiplier)}</dd></div>
            <div><dt>i-frame Δ</dt><dd>${c.stats.iFrameModifierSeconds >= 0 ? '+' : ''}${c.stats.iFrameModifierSeconds}s</dd></div>
          </dl>
          <p class="starters">Starting skills: ${starters}</p>
        </div>
      </label>
    `;
  }).join('');
  characterGrid!.innerHTML = cards;
}

characterGrid!.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | null;
  if (target && target.name === 'character' && isCharacterId(target.value)) {
    selectedCharacter = target.value;
  }
});

const ALARM_LABELS = {
  normal: 'Normal',
  caution: 'Caution',
  alert: 'Alert',
  evasion: 'Evasion',
} as const;

function renderHpPips(current: number, max: number): void {
  const doubled = Math.round(current * 2);
  const fragments: string[] = [];
  for (let i = 0; i < max; i++) {
    const filledHalves = Math.max(0, Math.min(2, doubled - i * 2));
    const cls = filledHalves === 2 ? 'hp-pip full' : filledHalves === 1 ? 'hp-pip half' : 'hp-pip empty';
    fragments.push(`<span class="${cls}" aria-hidden="true"></span>`);
  }
  hpPipsElement!.innerHTML = fragments.join('');
  hpPipsElement!.setAttribute('aria-label', `Health: ${current} of ${max}`);
}

let damageFlashTimer: number | undefined;
function flashDamage(): void {
  damageVignette!.classList.remove('pulse');
  // Force reflow so re-adding the class restarts the animation.
  void damageVignette!.offsetWidth;
  damageVignette!.classList.add('pulse');
  shellElement!.classList.remove('camera-shake');
  void shellElement!.offsetWidth;
  shellElement!.classList.add('camera-shake');
  if (damageFlashTimer !== undefined) window.clearTimeout(damageFlashTimer);
  damageFlashTimer = window.setTimeout(() => {
    damageVignette!.classList.remove('pulse');
    shellElement!.classList.remove('camera-shake');
  }, 420);
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
  },
  onHealthChange: renderHpPips,
  onDamaged: flashDamage,
  onAlarmChange: (tier) => {
    alarmElement.textContent = ALARM_LABELS[tier];
    alarmElement.dataset.tier = tier;
  },
  onCurrencyChange: (balance) => {
    currencyAmountElement.textContent = String(balance);
  },
  onAwaitingStart: () => {
    renderCharacterGrid();
    characterSelectOverlay!.classList.remove('hidden');
  },
});

btnStartRun!.addEventListener('click', () => {
  game.setCharacter(selectedCharacter);
  persistCharacter(selectedCharacter);
  characterSelectOverlay!.classList.add('hidden');
  game.startRun();
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
const difficultyInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="difficulty"]'),
);
const reduceMotionInput = document.querySelector<HTMLInputElement>('#chk-reduce-motion');

let settings: GameSettings = loadSettings();
hydrateDifficulty();

function applySettings(): void {
  game.applyGraphicsSettings(settings);
  game.applyCameraSettings(settings.camera);
  game.setReduceMotion(settings.reduceMotion);
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
  for (const input of difficultyInputs) {
    input.checked = input.value === current.difficulty;
  }
  if (reduceMotionInput) reduceMotionInput.checked = current.reduceMotion;
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

for (const input of difficultyInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    const next = input.value as Difficulty;
    settings = { ...settings, difficulty: next };
    setDifficulty(next);
  });
}

if (reduceMotionInput) {
  reduceMotionInput.addEventListener('change', () => {
    settings = { ...settings, reduceMotion: reduceMotionInput.checked };
    saveSettings(settings);
    applySettings();
  });
}

game.start();
applySettings();
