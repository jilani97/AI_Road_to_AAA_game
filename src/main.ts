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
      <h1>Rooftop Heist</h1>
      <p class="subtitle">Babylon.js stealth prototype</p>
      <div id="status" class="card">Sneak past the guard and grab the crystal.</div>
      <div class="card">
        <h2>Controls</h2>
        <ul>
          <li><span>Move</span><strong>W A S D</strong></li>
          <li><span>Sprint</span><strong>Shift</strong></li>
          <li><span>Camera</span><strong>Right-drag</strong></li>
          <li><span>Restart</span><strong>R</strong></li>
        </ul>
      </div>
      <div class="card">
        <h2>Objective</h2>
        <p id="objective">Reach the crystal without entering the guard's vision cone.</p>
      </div>
    </aside>
  </div>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const statusElement = document.querySelector<HTMLDivElement>('#status');
const objectiveElement = document.querySelector<HTMLParagraphElement>('#objective');

if (!canvas || !statusElement || !objectiveElement) {
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
});

game.start();
