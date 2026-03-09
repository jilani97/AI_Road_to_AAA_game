import './style.css';
import { GameApp } from './game/GameApp';

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
        <label><input type="checkbox" id="chk-shadows" checked> Enable Shadows</label>
        <label><input type="checkbox" id="chk-postfx" checked> Enable Post-Processing</label>
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

game.start();
