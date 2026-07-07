import type { PlayerState, SceneMode } from '../net/network';
import { PLAYER_COLORS } from './player';

const cssColor = (colorIndex: number) =>
  '#' + PLAYER_COLORS[colorIndex % PLAYER_COLORS.length].toString(16).padStart(6, '0');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class HUD {
  onCreate: (name: string, mode: SceneMode) => void = () => {};
  onJoin: (code: string, name: string) => void = () => {};
  onStart: () => void = () => {};

  private menu = $('menu');
  private lobby = $('lobby');
  private hud = $('hud');
  private nameInput = $<HTMLInputElement>('name-input');
  private codeInput = $<HTMLInputElement>('code-input');
  private createBtn = $<HTMLButtonElement>('create-btn');
  private modeSelect = $<HTMLSelectElement>('mode-select');
  private joinBtn = $<HTMLButtonElement>('join-btn');
  private startBtn = $<HTMLButtonElement>('start-btn');

  constructor() {
    this.createBtn.addEventListener('click', () =>
      this.onCreate(this.playerName(), this.modeSelect.value as SceneMode),
    );
    this.joinBtn.addEventListener('click', () =>
      this.onJoin(this.codeInput.value.toUpperCase().trim(), this.playerName()),
    );
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinBtn.click();
    });
    this.startBtn.addEventListener('click', () => this.onStart());
  }

  private playerName(): string {
    return this.nameInput.value.trim() || 'Wino ' + Math.floor(Math.random() * 90 + 10);
  }

  setBusy(busy: boolean, label?: string) {
    this.createBtn.disabled = busy;
    this.joinBtn.disabled = busy;
    if (label) this.menuError(label);
  }

  menuError(message: string) {
    $('menu-error').textContent = message;
  }

  showLobby(code: string, isHost: boolean) {
    this.menu.classList.add('hidden');
    this.lobby.classList.remove('hidden');
    $('room-code').textContent = code;
    this.startBtn.classList.toggle('hidden', !isHost);
    $('lobby-note').textContent = isHost
      ? 'You can start solo — drunks welcome anytime.'
      : 'Waiting for the host to start…';
    // Keyboard should drive the game, not a focused input
    this.nameInput.blur();
    this.codeInput.blur();
  }

  updateLobby(players: PlayerState[]) {
    const list = $('player-list');
    list.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = cssColor(p.colorIndex);
      li.append(dot, document.createTextNode(p.name));
      list.append(li);
    }
  }

  showPlaying() {
    this.lobby.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  setScores(players: PlayerState[], myId: string) {
    const box = $('scores');
    box.innerHTML = '';
    const sorted = [...players].sort((a, b) => b.score - a.score);
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'srow' + (p.id === myId ? ' me' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = cssColor(p.colorIndex);
      const name = document.createElement('span');
      name.textContent = p.name;
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = String(p.score);
      row.append(dot, name, pts);
      box.append(row);
    }
  }
}
