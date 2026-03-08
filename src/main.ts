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
          <li><span>Jump</span><strong>Space</strong></li>
          <li><span>Sprint</span><strong>Shift</strong></li>
          <li><span>Camera</span><strong>Right-drag</strong></li>
          <li><span>Restart</span><strong>R</strong></li>
        </ul>
      </div>
      <div class="card">
        <h2>Objective</h2>
        <p id="objective">Plant the tracker on the Baron's cane. Reach the Liquid Time sample.</p>
      </div>
      <div class="card eardar-card">
        <h2>Ear&#8209;dar</h2>
        <p id="eardar-status">Listening&hellip;</p>
      </div>
    </aside>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const statusElement = document.querySelector<HTMLDivElement>('#status');
const objectiveElement = document.querySelector<HTMLParagraphElement>('#objective');
const eardarElement = document.querySelector<HTMLParagraphElement>('#eardar-status');

if (!canvas || !statusElement || !objectiveElement || !eardarElement) {
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
  onEardarChange: (message) => {
    eardarElement.textContent = message;
  },
});

game.start();
