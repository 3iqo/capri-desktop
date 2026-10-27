// How close she is to you: her sync with you, like a neural link. It grows with the days you spend
// together, the time you're at your PC with her out, talking to her, the work Claude gets done with
// her watching, the reminders you keep. Each source counts up to so much a day, so it takes a few
// weeks to go all the way. Five stages; she tells you when you reach a new one, and it shows in what
// she says, how her chat talks to you, and how jealous she gets.
//
// Jealous: she sees you on another AI (the window in front is one of them: windows.ps1 checks the
// title of the window in front against a short list of AI names, on your PC, and only says which
// one matched), or Codex working while she watches Claude Code. A moment in front and she notices;
// a while on it and, once she's attached enough, she goes and sits on its window, glares at you and
// takes it over for a moment. Then she sulks for a bit: click her and she turns her back on you.

import { pick, fmt, today } from './util.js';

// the xp each stage starts at; 1000 is 100 %
export const STAGES = [0, 100, 300, 550, 850];
const FULL = 1000;
// the most a day from each source
const CAPS = { day: 10, time: 18, chat: 20, click: 4, claude: 10, remind: 6 };
const SAVE_MS = 15000;

export class Bond {
  constructor({ host, data }) {
    this.host = host;
    const day = today();
    this.data = { xp: 0, first: day, last: day, days: 1, streak: 1, caps: { date: day }, ...(data || {}) };
    this.away = 0;       // days since you were last together, when this run started
    this.onStage = null; // (stage) => a new stage reached
    this.saveTimer = 0;
    this.arrive();
  }

  get stage() {
    let stage = 0;
    STAGES.forEach((xp, i) => {
      if (this.data.xp >= xp) stage = i;
    });
    return stage;
  }

  get percent() {
    return Math.min(100, Math.floor((this.data.xp / FULL) * 100));
  }

  get days() {
    return this.data.days;
  }

  // A new day together: a little sync for it, a bit more for every day in a row.
  arrive() {
    const d = this.data;
    const day = today();
    if (d.last === day) return;
    const gap = Math.max(1, Math.round((Date.parse(day) - Date.parse(d.last)) / 86400000));
    this.away = gap;
    d.days += 1;
    d.streak = gap === 1 ? d.streak + 1 : 1;
    d.last = day;
    this.add('day', 6 + Math.min(4, d.streak - 1));
    this.save(true);
  }

  add(source, n = 1) {
    this.arrive();
    const d = this.data;
    if (d.caps.date !== today()) d.caps = { date: today() };
    const got = Math.max(0, Math.min(n, (CAPS[source] ?? 10) - (d.caps[source] || 0)));
    if (!got) return;
    d.caps[source] = (d.caps[source] || 0) + got;
    const before = this.stage;
    d.xp = Math.min(FULL, d.xp + got);
    if (this.stage > before) {
      this.save(true);
      this.onStage?.(this.stage);
    } else {
      this.save();
    }
  }

  // A little sync lost (thrown around once too often, caught on another AI). Never below the
  // stage she's at: she doesn't forget you.
  lose(n) {
    const d = this.data;
    d.xp = Math.max(STAGES[this.stage], d.xp - n);
    this.save();
  }

  save(now = false) {
    clearTimeout(this.saveTimer);
    const write = () => this.host.setConfig({ bond: { ...this.data } });
    if (now) write();
    else this.saveTimer = setTimeout(write, SAVE_MS);
  }

  // For her chat: how she is with you by now.
  persona() {
    const how = [
      'You only just met the user: curious about them, a little guarded.',
      'You know the user a little now: friendly, teasing.',
      'You and the user get along well: warm and teasing, at ease with them.',
      'You are attached to the user: protective, a little possessive, you miss them when they are away.',
      'The user feels like one of the minds in you now: deeply fond of them, playful, fiercely loyal.',
    ][this.stage];
    return `${how} You have spent ${this.days} day${this.days > 1 ? 's' : ''} together.`;
  }
}

// The other AIs she can spot, by the key windows.ps1 gives them.
export const RIVALS = {
  chatgpt: 'ChatGPT', claude: 'Claude', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot', perplexity: 'Perplexity',
  deepseek: 'DeepSeek', grok: 'Grok', lechat: 'Le Chat', characterai: 'Character.AI', metaai: 'Meta AI',
};
// the one she watches is no rival of hers (Antigravity runs on Gemini)
const OWN = { claude: ['claude'], codex: ['codex'], agy: ['gemini'] };

const NOTICE_AFTER = 4000;           // in front this long: she notices
const ACT_AFTER = 45000;             // this long on it, lately: she does something about it
const NOTICE_EVERY = 20 * 60 * 1000; // per AI
const ACT_EVERY = 40 * 60 * 1000;
const ACTS_A_DAY = 3;
const SULK_MS = 3 * 60 * 1000;
const TALLY = 'capri.rivals'; // today's minutes on each of them, for her chat

export class Jealousy {
  constructor({ capri, panel, brain, bond, chat, guide }) {
    this.capri = capri;
    this.panel = panel;
    this.brain = brain;
    this.bond = bond;
    this.chat = chat;
    this.guide = guide;
    this.enabled = true;  // her menu: Jealous of other AIs
    this.front = null;    // the AI in front: { key, id, since }
    this.lately = {};     // key -> ms on it lately (forgotten slowly)
    this.noticed = {};    // key -> when she last said something about it
    this.acted = { at: 0, date: today(), n: 0 };
    this.sulk = null;     // { key, until, clicks }
    try {
      this.tally = JSON.parse(localStorage.getItem(TALLY)) || null;
    } catch {
      this.tally = null;
    }
    if (this.tally?.date !== today()) this.tally = { date: today(), ms: {} };
    setInterval(() => this.tick(), 1000);
  }

  get t() {
    return this.brain.t.jealous;
  }

  // The first of these AIs (keys) that's a rival of hers, or null.
  rivalOf(keys) {
    const own = OWN[this.brain.assistant] || [];
    return (keys || []).find((k) => RIVALS[k] && !own.includes(k)) || null;
  }

  onWindows(data) {
    const key = this.enabled ? this.rivalOf(data.ai) : null;
    if (key === this.front?.key && data.fg === this.front.id) return;
    this.front = key ? { key, id: data.fg, since: Date.now() } : null;
  }

  // Codex at work while she watches Claude Code (its hooks still reach her): like seeing it in front.
  onRivalEvent(key) {
    if (!this.enabled || this.rivalOf([key]) !== key) return;
    this.lately[key] = (this.lately[key] || 0) + 4000;
    this.count(key, 4000);
    if (Date.now() - (this.noticed[key] || 0) > NOTICE_EVERY && this.free()) this.notice(key, null);
  }

  count(key, ms) {
    if (this.tally.date !== today()) this.tally = { date: today(), ms: {} };
    this.tally.ms[key] = (this.tally.ms[key] || 0) + ms;
    if (this.tally.ms[key] % 30000 < ms) {
      try {
        localStorage.setItem(TALLY, JSON.stringify(this.tally));
      } catch {
        // nothing kept: today's minutes start over next run
      }
    }
  }

  tick() {
    const now = Date.now();
    const f = this.front;
    for (const k of Object.keys(this.lately)) if (k !== f?.key) this.lately[k] *= 0.9989; // about half every 10 min
    if (this.sulk && now > this.sulk.until) this.sulk = null;
    if (!f) return;
    this.lately[f.key] = (this.lately[f.key] || 0) + 1000;
    this.count(f.key, 1000);
    if (!this.free()) return;
    if (this.acted.date !== today()) this.acted = { at: 0, date: today(), n: 0 };
    const stage = this.bond.stage;
    if (now - f.since >= NOTICE_AFTER && now - (this.noticed[f.key] || 0) > NOTICE_EVERY) {
      this.notice(f.key, f.id);
    } else if (stage >= 2 && this.lately[f.key] >= ACT_AFTER && now - this.acted.at > ACT_EVERY && this.acted.n < ACTS_A_DAY) {
      this.act(f);
    }
  }

  // Nothing more important going on, and she's out where you can see her.
  free() {
    const { capri, panel } = this;
    if (capri.busy || capri.dragging || capri.stowed || capri.dormant || capri.hidden || capri.act) return false;
    if (!['stand', 'sit'].includes(capri.stance) || capri.mode === 'alert' || capri.mode === 'sleep' || capri.pointing) return false;
    if (this.chat.open || this.guide.running) return false;
    return !panel.visible || ['idle', 'info'].includes(panel.current?.kind);
  }

  // She saw it: she turns to it and says something. The more attached, the less she lets it go.
  notice(key, id) {
    this.noticed[key] = Date.now();
    const stage = this.bond.stage;
    const tier = stage >= 4 ? 'high' : stage >= 2 ? 'mid' : 'low';
    const win = id && this.capri.windows.wins.find((w) => w.id === id);
    const toward = win ? Math.sign(win.x + win.w / 2 - this.capri.pos.x) || 1 : this.capri.towardCenter();
    this.capri.perform(stage >= 2 ? 'glare' : 'curious', toward);
    this.panel.say({ kind: 'info', face: ['aside', 'aside', 'look', 'look', 'many'][stage], line: fmt(pick(this.t[tier]), { rival: RIVALS[key] }), hold: 4500 });
  }

  // A while on it: she goes and sits on its window, glares at you, and takes it over.
  async act(f) {
    const win = this.capri.windows.wins.find((w) => w.id === f.id);
    if (!win) return;
    this.acted.at = Date.now();
    this.acted.n += 1;
    this.lately[f.key] = 0;
    this.noticed[f.key] = Date.now();
    this.bond.lose(2);
    this.panel.hide();
    const say = fmt(pick(this.t.say), { rival: RIVALS[f.key] });
    if (await this.capri.jealous(win, { say })) this.sulk = { key: f.key, until: Date.now() + SULK_MS, clicks: 0 };
  }

  // A click on her while she sulks: she turns her back on you. After a few (fewer the more she
  // likes you), she lets it go. True if she sulked.
  onClick() {
    const s = this.sulk;
    if (!s) return false;
    s.clicks += 1;
    const rival = RIVALS[s.key];
    if (s.clicks >= (this.bond.stage >= 3 ? 2 : 3)) {
      this.sulk = null;
      this.capri.perform('hop');
      this.panel.say({ kind: 'idle', face: 'smug', line: pick(this.t.forgive), hold: 3500 });
      return true;
    }
    const pointer = this.capri.mouse?.x ?? this.capri.pos.x;
    this.capri.perform('huff', pointer < this.capri.pos.x ? 1 : -1); // her head turned away from it
    this.panel.say({ kind: 'idle', face: 'aside', line: fmt(pick(this.t.sulk), { rival }), hold: 3500 });
    return true;
  }

  // Talking it over in her chat makes it better.
  forgive() {
    this.sulk = null;
  }

  // For her chat: the other AIs you used today, and how she takes it.
  context() {
    const used = Object.entries(this.tally.ms).filter(([k, ms]) => ms >= 60000 && this.rivalOf([k]));
    if (!used.length || !this.enabled) return '';
    const list = used.sort((a, b) => b[1] - a[1]).map(([k, ms]) => `${RIVALS[k]} (${Math.round(ms / 60000)} min)`).join(', ');
    const mood = this.sulk
      ? 'You are sulking about it right now: let it show, then let it go if they are nice to you.'
      : 'You are a little jealous: tease them about it once, playfully, if it fits.';
    return `Today the user also used another AI: ${list}. ${mood}`;
  }
}
