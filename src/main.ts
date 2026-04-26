import './style.css';
import { GameApp } from './game/GameApp';

declare global {
  interface Window {
    game?: GameApp;
  }
}
import { getDifficulty, hydrateDifficulty, setDifficulty } from './game/difficulty';
import {
  CHARACTER_ORDER,
  getCharacter,
  isCharacterId,
  loadPersistedCharacter,
  persistCharacter,
  type CharacterId,
} from './game/characters';
import {
  SKILL_IDS,
  addActive,
  canAddActive,
  canUnlock,
  getSkill,
  getSkillState,
  refundAllSkills,
  removeActive,
  setSkillState,
  unlockSkill,
  type SkillBranch,
  type SkillDef,
} from './game/skills';
import { earn, getBalance, spend } from './game/currency';
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
    <div class="canvas-area">
      <canvas id="game-canvas"></canvas>
      <div class="game-hud" aria-hidden="false">
        <div class="game-hud-corner top-left">
          <div class="game-hud-pill" aria-label="Alarm tier">
            <span class="game-hud-pill-label">Alarm</span>
            <span id="alarm-tier" class="alarm-tier" data-tier="normal">Normal</span>
          </div>
        </div>
        <div class="game-hud-corner top-right">
          <div class="game-hud-pill sonar-pill" aria-label="Sonic Crest">
            <span class="game-hud-pill-label">Sonic Crest</span>
            <span id="sonar-status" class="sonar-readout">Scanning&hellip;</span>
          </div>
        </div>
        <div class="game-hud-corner bottom-left">
          <div class="game-hud-stack">
            <div class="game-hud-pill health-pill" aria-label="Health">
              <div id="hp-pips" class="hp-pips"></div>
            </div>
            <div class="medkit-counter" id="medkit-counter" aria-label="Medkits">
              <span class="medkit-icon" aria-hidden="true">+</span>
              <span id="medkit-held">0</span>
              <span class="medkit-hint">· Press H</span>
            </div>
          </div>
        </div>
        <div class="game-hud-corner bottom-right">
          <div class="game-hud-stack">
            <div id="currency" class="currency">
              <span class="currency-icon" aria-hidden="true">⬢</span>
              <span id="currency-amount">0</span>
            </div>
            <div class="game-hud-pill loadout-pill" aria-label="Loadout">
              <span class="game-hud-pill-label">Loadout</span>
              <span id="weapon-status" class="loadout-readout">Sting Sword</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <aside class="hud">
      <h1>Neon Tail</h1>
      <p class="subtitle">The Midnight Syndicate</p>
      <div id="status" class="card">Act I — The Rainy Rooftops. Slip past the Baron's guards.</div>
      <div class="card">
        <h2>Objective</h2>
        <p id="objective">Plant the tracker on the Baron's cane. Reach the Liquid Time sample.</p>
      </div>
      <div class="card">
        <h2>Controls</h2>
        <ul>
          <li><span>Move</span><strong>W A S D</strong></li>
          <li><span>Attack/Fire</span><strong>Left Click</strong></li>
          <li><span>Ascension Dash</span><strong>Space</strong></li>
          <li><span>Sprint</span><strong>Shift</strong></li>
          <li><span>Camera</span><strong>Right-drag</strong></li>
          <li><span>Weapon</span><strong>1 - 4</strong></li>
          <li><span>Medkit</span><strong>H</strong></li>
          <li><span>Pause</span><strong>Esc</strong></li>
          <li><span>Restart</span><strong>R</strong></li>
        </ul>
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
  <div id="skill-tree" class="overlay hidden">
    <div class="menu-box skill-tree-box">
      <h2>Skill Tree</h2>
      <div class="skill-tree-meta">
        <span>Balance: <strong id="skill-tree-balance">0</strong> ⬢</span>
        <span>Difficulty: <strong id="skill-tree-difficulty">Medium</strong></span>
      </div>
      <div id="skill-branches" class="skill-branches"></div>
      <div id="skill-loadout" class="skill-loadout hidden">
        <h3>Active Loadout (Hard — max 4)</h3>
        <p class="skill-loadout-hint">Starting skills are always active on top of your loadout.</p>
        <div id="skill-loadout-list"></div>
      </div>
      <div class="skill-tree-actions">
        <button id="btn-skill-respec" type="button">Respec (refund all)</button>
        <button id="btn-skill-close" type="button">Back to Pause</button>
      </div>
    </div>
  </div>
  <div id="shop" class="overlay hidden">
    <div class="menu-box shop-box">
      <h2>Field Supplies</h2>
      <p class="shop-subtitle">Medkits restore HP. Stock resets every run.</p>
      <div class="shop-item">
        <div class="shop-item-info">
          <h3>Medkit</h3>
          <p class="shop-item-desc">Instant +2 HP. Use with <strong>H</strong> during a run.</p>
          <p class="shop-item-meta">
            Price: <strong id="shop-medkit-price">—</strong> ⬢
            · Remaining this run: <strong id="shop-medkit-remaining">—</strong>
            · Held: <strong id="shop-medkit-held">—</strong>
          </p>
        </div>
        <button id="btn-shop-buy-medkit" type="button">Buy Medkit</button>
      </div>
      <p class="shop-balance">Balance: <strong id="shop-balance">0</strong> ⬢</p>
      <p id="shop-feedback" class="shop-feedback" aria-live="polite"></p>
      <div class="shop-actions">
        <button id="btn-shop-close" type="button">Back to Pause</button>
      </div>
    </div>
  </div>
  <div id="pause-menu" class="overlay hidden">
    <div class="menu-box">
      <h2>Paused</h2>
      <button id="btn-resume">Resume</button>
      <button id="btn-shop">Shop</button>
      <button id="btn-skill-tree">Skill Tree</button>
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
const sonarElement = document.querySelector<HTMLElement>('#sonar-status');
const weaponElement = document.querySelector<HTMLElement>('#weapon-status');
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
const skillTreeOverlay = document.querySelector<HTMLDivElement>('#skill-tree');
const skillBranchesElement = document.querySelector<HTMLDivElement>('#skill-branches');
const skillLoadoutElement = document.querySelector<HTMLDivElement>('#skill-loadout');
const skillLoadoutListElement = document.querySelector<HTMLDivElement>('#skill-loadout-list');
const skillTreeBalanceElement = document.querySelector<HTMLElement>('#skill-tree-balance');
const skillTreeDifficultyElement = document.querySelector<HTMLElement>('#skill-tree-difficulty');
const btnSkillTree = document.querySelector<HTMLButtonElement>('#btn-skill-tree');
const btnSkillRespec = document.querySelector<HTMLButtonElement>('#btn-skill-respec');
const btnSkillClose = document.querySelector<HTMLButtonElement>('#btn-skill-close');
const medkitHeldElement = document.querySelector<HTMLSpanElement>('#medkit-held');
const shopOverlay = document.querySelector<HTMLDivElement>('#shop');
const shopMedkitPrice = document.querySelector<HTMLElement>('#shop-medkit-price');
const shopMedkitRemaining = document.querySelector<HTMLElement>('#shop-medkit-remaining');
const shopMedkitHeld = document.querySelector<HTMLElement>('#shop-medkit-held');
const shopBalanceElement = document.querySelector<HTMLElement>('#shop-balance');
const shopFeedbackElement = document.querySelector<HTMLParagraphElement>('#shop-feedback');
const btnShop = document.querySelector<HTMLButtonElement>('#btn-shop');
const btnShopBuyMedkit = document.querySelector<HTMLButtonElement>('#btn-shop-buy-medkit');
const btnShopClose = document.querySelector<HTMLButtonElement>('#btn-shop-close');

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
  !btnStartRun ||
  !skillTreeOverlay ||
  !skillBranchesElement ||
  !skillLoadoutElement ||
  !skillLoadoutListElement ||
  !skillTreeBalanceElement ||
  !skillTreeDifficultyElement ||
  !btnSkillTree ||
  !btnSkillRespec ||
  !btnSkillClose ||
  !medkitHeldElement ||
  !shopOverlay ||
  !shopMedkitPrice ||
  !shopMedkitRemaining ||
  !shopMedkitHeld ||
  !shopBalanceElement ||
  !shopFeedbackElement ||
  !btnShop ||
  !btnShopBuyMedkit ||
  !btnShopClose
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

// ---------------------------------------------------------------------------
// Skill tree UI
// ---------------------------------------------------------------------------

const SKILL_BRANCH_LABELS: Record<SkillBranch, string> = {
  mobility: 'Mobility',
  senses: 'Senses',
  silence: 'Silence',
  gadgets: 'Gadgets',
};

const SKILL_BRANCHES_ORDER: SkillBranch[] = ['mobility', 'senses', 'silence', 'gadgets'];

function refreshCurrencyHud(): void {
  currencyAmountElement!.textContent = String(getBalance());
}

function classifySkill(
  skillId: string,
  state = getSkillState(),
): 'unlocked' | 'available' | 'locked' | 'unaffordable' {
  if (state.unlocked.includes(skillId)) return 'unlocked';
  const reason = canUnlock(skillId, state, getBalance());
  if (reason === null) return 'available';
  if (reason === 'insufficient_funds') return 'unaffordable';
  return 'locked';
}

function skillCardMarkup(
  def: SkillDef,
  status: 'unlocked' | 'available' | 'locked' | 'unaffordable',
): string {
  const statusLabel = {
    unlocked: 'Unlocked',
    available: `Unlock · ${def.cost} ⬢`,
    locked: 'Locked (prereq)',
    unaffordable: `Need ${def.cost} ⬢`,
  }[status];
  const tierClass = `skill-card tier-${def.tier} status-${status}`;
  const buttonAttrs = status === 'available' ? '' : 'disabled';
  const buttonLabel = status === 'unlocked' ? 'Unlocked' : statusLabel;
  return `
    <div class="${tierClass}" data-skill="${def.id}">
      <div class="skill-card-head">
        <h4>${escapeHtml(def.name)}</h4>
        <span class="skill-card-tier">T${def.tier}</span>
      </div>
      <p class="skill-card-desc">${escapeHtml(def.description)}</p>
      <div class="skill-card-footer">
        <button type="button" class="skill-unlock-btn" data-skill="${def.id}" ${buttonAttrs}>${escapeHtml(buttonLabel)}</button>
      </div>
    </div>
  `;
}

function renderSkillTree(): void {
  skillTreeBalanceElement!.textContent = String(getBalance());
  const difficulty = getDifficulty();
  skillTreeDifficultyElement!.textContent =
    difficulty === 'easy' ? 'Easy' : difficulty === 'medium' ? 'Medium' : 'Hard';

  const state = getSkillState();
  skillBranchesElement!.innerHTML = SKILL_BRANCHES_ORDER.map((branch) => {
    const defs = SKILL_IDS.map((id) => getSkill(id)).filter(
      (d): d is SkillDef => !!d && d.branch === branch,
    );
    defs.sort((a, b) => a.tier - b.tier);
    const cards = defs.map((d) => skillCardMarkup(d, classifySkill(d.id, state))).join('');
    return `
      <section class="skill-branch" data-branch="${branch}">
        <h3>${SKILL_BRANCH_LABELS[branch]}</h3>
        ${cards}
      </section>
    `;
  }).join('');

  if (difficulty === 'hard') {
    skillLoadoutElement!.classList.remove('hidden');
    const unlockedDefs = state.unlocked
      .map((id) => getSkill(id))
      .filter((d): d is SkillDef => !!d);
    if (unlockedDefs.length === 0) {
      skillLoadoutListElement!.innerHTML =
        '<p class="skill-loadout-empty">Unlock skills first — then pick up to 4 to run.</p>';
    } else {
      skillLoadoutListElement!.innerHTML = unlockedDefs
        .map((d) => {
          const isActive = state.active.includes(d.id);
          const canAdd = isActive ? true : canAddActive(d.id, state, 'hard');
          const disabled = !isActive && !canAdd ? 'disabled' : '';
          const checked = isActive ? 'checked' : '';
          return `
            <label class="skill-loadout-item">
              <input type="checkbox" data-skill="${d.id}" ${checked} ${disabled}>
              <span>${escapeHtml(d.name)}</span>
            </label>
          `;
        })
        .join('');
    }
  } else {
    skillLoadoutElement!.classList.add('hidden');
  }
}

skillBranchesElement!.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const btn = target.closest<HTMLButtonElement>('.skill-unlock-btn');
  if (!btn || btn.disabled) return;
  const skillId = btn.dataset.skill;
  if (!skillId) return;
  const state = getSkillState();
  const result = unlockSkill(skillId, state, getBalance());
  if (!result.ok) return;
  const def = getSkill(skillId);
  if (!def) return;
  const spendResult = spend(def.cost);
  if (!spendResult.ok) return;
  setSkillState(result.state);
  refreshCurrencyHud();
  game.refreshActiveRunSkills();
  renderSkillTree();
});

skillLoadoutListElement!.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | null;
  if (!target || target.type !== 'checkbox') return;
  const skillId = target.dataset.skill;
  if (!skillId) return;
  const state = getSkillState();
  if (target.checked) {
    if (!canAddActive(skillId, state, 'hard')) {
      target.checked = false;
      return;
    }
    setSkillState(addActive(skillId, state));
  } else {
    setSkillState(removeActive(skillId, state));
  }
  game.refreshActiveRunSkills();
  renderSkillTree();
});

btnSkillRespec!.addEventListener('click', () => {
  const { state, refunded } = refundAllSkills(getSkillState());
  setSkillState(state);
  if (refunded > 0) {
    earn(refunded, 'refund');
    refreshCurrencyHud();
  }
  game.refreshActiveRunSkills();
  renderSkillTree();
});

btnSkillTree!.addEventListener('click', () => {
  pauseMenu!.classList.add('hidden');
  renderSkillTree();
  skillTreeOverlay!.classList.remove('hidden');
});

btnSkillClose!.addEventListener('click', () => {
  skillTreeOverlay!.classList.add('hidden');
  pauseMenu!.classList.remove('hidden');
});

// ---------------------------------------------------------------------------
// Shop UI (Task 5 consumables)
// ---------------------------------------------------------------------------

function renderShop(): void {
  shopMedkitPrice!.textContent = String(game.getMedkitPrice());
  shopMedkitRemaining!.textContent = String(game.getMedkitsRemaining());
  shopMedkitHeld!.textContent = String(game.getMedkitsHeld());
  shopBalanceElement!.textContent = String(getBalance());
  const canBuy =
    game.getMedkitsRemaining() > 0 && getBalance() >= game.getMedkitPrice();
  btnShopBuyMedkit!.disabled = !canBuy;
  shopFeedbackElement!.textContent = '';
}

btnShop!.addEventListener('click', () => {
  pauseMenu!.classList.add('hidden');
  renderShop();
  shopOverlay!.classList.remove('hidden');
});

btnShopClose!.addEventListener('click', () => {
  shopOverlay!.classList.add('hidden');
  pauseMenu!.classList.remove('hidden');
});

btnShopBuyMedkit!.addEventListener('click', () => {
  if (game.purchaseMedkit()) {
    shopFeedbackElement!.textContent = 'Medkit purchased.';
  } else if (game.getMedkitsRemaining() <= 0) {
    shopFeedbackElement!.textContent = 'Out of stock this run.';
  } else {
    shopFeedbackElement!.textContent = 'Not enough coins.';
  }
  renderShop();
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
    weaponElement.textContent = weapon;
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
  onMedkitsChange: (held) => {
    medkitHeldElement!.textContent = String(held);
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
    // Recompute active skills so the Hard 4-cap engages / disengages on-demand.
    game.refreshActiveRunSkills();
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

if (import.meta.env.DEV) {
  window.game = game;
}
