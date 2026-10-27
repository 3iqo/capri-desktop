// Your PC as she feels it (her menu › React to my PC). She lives in it, after all:
// - the processor at full tilt for a while: she overheats, fanning herself, heat coming off her;
// - the battery running low (a laptop on battery): she sags and flickers, and perks up once plugged in;
// - the network gone, then back: cut off from the Net, she takes the hit, and is glad when it's back;
// - a USB stick plugged in: she dives into it to have a look, and comes back with her verdict;
// - a game in front (from Steam, Epic, Riot, Xbox, GOG: windows.ps1): she says something about it
//   and puts herself away while you play (always on top, she'd be in the way), and she's back,
//   asking how it went, once you're done.

import { pick, fmt } from './util.js';

const HOT = 90;                       // % of the processor…
const HOT_FOR = 20000;                // …this long: she overheats
const COOL = 55;                      // back under this: it's over
const HOT_EVERY = 30 * 60 * 1000;
const LOW = 0.15;                     // battery left: she says so…
const CRITICAL = 0.05;                // …and again
const OFFLINE_AFTER = 4000;           // the network gone this long (not a blip)
const GAME_AFTER = 6000;              // a game in front this long: you're playing
const GAME_OVER = 8000;               // and gone from the front this long: you're done

export class Pc {
  constructor({ capri, panel, brain, host, voice, chat, guide }) {
    this.capri = capri;
    this.panel = panel;
    this.brain = brain;
    this.host = host;
    this.voice = voice;
    this.chat = chat;
    this.guide = guide;
    this.enabled = true;
    this.wantsOut = () => true; // she isn't put away in your settings (Ctrl+Alt+C)
    this.hotSince = 0;
    this.hot = false;
    this.hotAt = -Infinity;
    this.warned = 1;      // the lowest battery level she's warned about (1: none)
    this.offlineTimer = 0;
    this.cutOff = false;
    this.drives = null;   // USB sticks plugged in, by letter (null: not known yet)
    this.game = null;     // { name, since, gone, played, put } the game in front
    setInterval(() => this.cpuTick(), 3000);
    setInterval(() => this.gameTick(), 1000);
    this.watchBattery();
    window.addEventListener('offline', () => this.offline());
    window.addEventListener('online', () => this.online());
  }

  get t() {
    return this.brain.t.pc;
  }

  say(line, face = 'smug', hold = 4500) {
    this.panel.say({ kind: 'info', face, line, hold });
  }

  // nothing more important going on (Claude needing you, a chat, her guide)
  quiet() {
    return this.enabled && this.capri.mode !== 'alert' && !this.chat.open && !this.guide.running;
  }

  // ---- the processor ----

  async cpuTick() {
    if (!this.enabled) return;
    const cpu = await this.host.cpu().catch(() => null);
    if (cpu == null) return;
    const now = Date.now();
    if (cpu >= HOT) {
      this.hotSince ||= now;
      if (!this.hot && now - this.hotSince >= HOT_FOR && now - this.hotAt > HOT_EVERY && this.quiet() && this.capri.free) {
        this.hot = true;
        this.hotAt = now;
        this.capri.wake();
        this.capri.perform('overheat');
        this.voice.play('charge');
        this.say(fmt(pick(this.t.hot), { cpu }), 'wide', 5000);
      }
    } else {
      this.hotSince = 0;
      if (this.hot && cpu < COOL) {
        this.hot = false;
        if (this.quiet() && !this.panel.visible) this.say(pick(this.t.cool), 'calm', 3000);
      }
    }
  }

  // ---- the battery ----

  async watchBattery() {
    const battery = await navigator.getBattery?.().catch(() => null);
    if (!battery) return;
    const check = () => this.battery(battery);
    battery.addEventListener('levelchange', check);
    battery.addEventListener('chargingchange', check);
    check();
  }

  battery({ level, charging }) {
    if (!this.enabled) return;
    if (charging) {
      if (this.warned < 1) {
        this.warned = 1;
        this.capri.recharge();
        this.say(pick(this.t.charging), 'laugh', 3500);
      }
      return;
    }
    const at = level <= CRITICAL ? CRITICAL : level <= LOW ? LOW : 1;
    if (at >= this.warned || at === 1) return;
    this.warned = at;
    this.capri.wake();
    this.capri.drain();
    this.say(fmt(pick(at === CRITICAL ? this.t.critical : this.t.low), { level: Math.round(level * 100) }), 'aside', 6000);
  }

  // ---- the network ----

  offline() {
    clearTimeout(this.offlineTimer);
    this.offlineTimer = setTimeout(() => {
      if (navigator.onLine || !this.enabled) return;
      this.cutOff = true;
      this.capri.hurt();
      this.voice.play('error');
      this.say(pick(this.t.offline), 'wide', 5000);
    }, OFFLINE_AFTER);
  }

  online() {
    clearTimeout(this.offlineTimer);
    if (!this.cutOff) return;
    this.cutOff = false;
    if (this.capri.free) this.capri.perform('hop');
    this.voice.play('hello');
    this.say(pick(this.t.online), 'laugh', 3500);
  }

  // ---- USB sticks and games (windows.ps1, through the window watch) ----

  onWindows({ usb = [], game = null }) {
    const before = this.drives;
    this.drives = usb;
    if (before && this.enabled) {
      const added = usb.find((d) => !before.includes(d));
      const removed = before.find((d) => !usb.includes(d));
      if (added) this.plugged(added);
      else if (removed && this.quiet() && !this.capri.busy) this.say(pick(this.t.usbOut), 'smug', 3500);
    }
    // the game in front
    const g = this.game;
    if (game) {
      if (g?.name === game) g.gone = 0;
      else this.game = { name: game, since: Date.now(), gone: 0, played: false, put: false };
    } else if (g && !g.gone) {
      g.gone = Date.now();
    }
  }

  async plugged(drive) {
    if (!this.quiet() || !this.capri.free) return;
    this.say(fmt(pick(this.t.usb), { drive }), 'look', 2500);
    await new Promise((r) => setTimeout(r, 1200));
    const { w, h } = this.capri.view;
    if (await this.capri.visit({ x: w - 140, y: h - 6 })) this.say(pick(this.t.usbBack), 'smug', 4500);
  }

  gameTick() {
    const g = this.game;
    if (!g || !this.enabled) return;
    const now = Date.now();
    // playing: a word about it, then out of the way
    if (!g.played && !g.gone && now - g.since >= GAME_AFTER) {
      g.played = true;
      if (this.capri.stowed || this.capri.mode === 'alert') return;
      this.capri.wake();
      this.say(fmt(pick(this.t.game), { game: g.name }), 'smug', 3000);
      setTimeout(() => {
        if (this.game !== g || g.gone || this.capri.stowed || this.capri.mode === 'alert') return;
        g.put = true;
        this.capri.stow();
      }, 2600);
    }
    // done playing: back, if she was the one who left
    if (g.gone && now - g.gone >= GAME_OVER) {
      this.game = null;
      if (g.put && this.capri.stowed && this.wantsOut()) {
        this.capri.unstow().then(() => this.say(pick(this.t.gameBack), 'look', 5000));
      }
    }
  }
}
