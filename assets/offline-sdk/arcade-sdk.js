/* Caleb's Arcade SDK v1. Load FIRST in <head>, before any game script:
 *   <script src="../assets/arcade-sdk.js"></script>
 *
 * With no game code at all it gives the game what qa/standard/STANDARD.md requires:
 * - pause and resume: animation frames, timers, performance.now(), Date.now() and Web Audio
 *   freeze together, so the game resumes without a time jump (new Date() stays on the real clock);
 * - mute: every Web Audio graph and media element goes through one master switch;
 * - a standard pause menu: Resume, Restart, How to play, Tips, Sound, Codes, Exit;
 * - the arcade page's Pause, Mute and Help buttons and automatic pause when the tab hides.
 *
 * Games go deeper by calling ArcadeSDK.init({...}), for example:
 *   ArcadeSDK.init({
 *     ownPauseUI: false,             // true if the game draws its own pause menu (then handle onPause)
 *     onPause(){}, onResume(){},     // optional: extra work beyond the automatic freeze
 *     onRestart(){},                 // restart the run without reloading (else the page reloads)
 *     onExit(){},                    // go back to the title screen (else the page reloads)
 *     onTutorial(){},                // replay the tutorial
 *     onHint(){ return 'Try the corner'; },    // or call ArcadeSDK.setHint(text) whenever the best hint changes
 *     onCheat(code){ return code==='GODMODE' ? {ok:true, message:'Invincible'} : {ok:false}; },
 *     // or declare the codes and just get told which one was entered (engines that can't return values):
 *     // cheats: [{code:'GODMODE', effect:'Invincible'}], onCheat(code){ ... },
 *     tricks: [{name:'Backflip', input:'Up + Space'}],
 *     theme: {bg:'#123', ink:'#fff', accent:'#f80', font:'Fredoka, sans-serif'},  // pause sheet look (also --arcade-sdk-* CSS variables)
 *     orientation: 'landscape',     // phones held upright get a "turn sideways" card, and the game waits
 *   });
 *   ArcadeSDK.state({scene:'play', score:120});  // title | play | over
 *   ArcadeSDK.event('tutorial-done');
 *   ArcadeSDK.gamePaused(true);                 // a game with its own pause menu (ownPauseUI) reports it
 *   if (ArcadeSDK.cheated) skipSavingBest();
 *   ArcadeSDK.sfx('coin');                      // a sound from the arcade's shared kit (assets/sfx/kit.json)
 *
 * The arcade-wide profile (XP, level, streak, daily quests, badges; see docs/PROGRESSION.md) needs NO game code:
 * the portal counts play time from this SDK's input heartbeats, counts a round when the game reports
 * ArcadeSDK.state({scene:'over', score}), and notices a new best saved under a key the game lists in its meta
 * `saves`. Games that want to do more can, and every call is safe to make when the profile is not there:
 *   ArcadeSDK.state({scene:'over', score:120, level:4, stars:2});   // also: lower:true when a smaller score is better
 *   ArcadeSDK.profile.award({xp:20, reason:'Beat the boss'});       // 1..30 XP, 60 a day per game
 *   ArcadeSDK.profile.achievement('first-win', {title:'First Win', desc:'Win a match', tier:'silver'});   // a badge in the Trophy room
 *   ArcadeSDK.profile.quest('clear-w5', 0.6, {title:'Clear wave 5'});   // 0..1 (1 = done): an extra goal on the quests card
 *   ArcadeSDK.profile.get();                                        // {level, xp, streak, stars, avatar, title} or null
 * Cheat codes on: every profile call is ignored and the run earns no XP (ArcadeSDK.cheated).
 *
 * Nothing in here may break a game: every hook is guarded and falls back to the original.
 */
(function () {
  'use strict';
  if (window.ArcadeSDK) return;
  var V = 1, W = window, D = document;
  var inFrame = false; try { inFrame = W.parent && W.parent !== W; } catch (e) { inFrame = true; }
  var sid = Math.random().toString(36).slice(2, 9);   // one per page load: tells the arcade a new game document started
  function post(type, data) { if (!inFrame) return; try { var m = {}; for (var k in data) m[k] = data[k]; m.arcade = V; m.type = type; if (type === 'ready') m.sid = sid; W.parent.postMessage(m, '*'); } catch (e) {} }

  var cfg = {}, meta = {}, paused = false, reason = '', muted = false, cheated = false, events = [], glTypes = [];
  var rawST = W.setTimeout.bind(W), rawCT = W.clearTimeout.bind(W), rawSI = W.setInterval.bind(W), rawCI = W.clearInterval.bind(W);
  try { muted = W.localStorage.getItem('arcade_muted') === '1'; } catch (e) {}

  /* ---------- clock: performance.now stands still while paused ---------- */
  var rawNow = W.performance && W.performance.now ? W.performance.now.bind(W.performance) : Date.now;
  var pausedAt = 0, pausedTotal = 0;
  function vnow() { return (paused && !soft ? pausedAt : rawNow()) - pausedTotal; }
  try { W.performance.now = vnow; } catch (e) {}
  // Date.now() skips paused time as well, so games that time runs with it do not jump on resume.
  // new Date() is left on the real clock: calendars, daily puzzles and save stamps want real dates.
  var rawDateNow = Date.now.bind(Date);
  try { Date.now = function () { return Math.floor(rawDateNow() - pausedTotal - (paused && !soft ? rawNow() - pausedAt : 0)); }; } catch (e) {}

  /* ---------- animation frames ---------- */
  var rawRAF = W.requestAnimationFrame ? W.requestAnimationFrame.bind(W) : null, rawCAF = W.cancelAnimationFrame ? W.cancelAnimationFrame.bind(W) : null;
  var nextId = 1, frames = new Map();
  function schedule(id, e) {
    e.raw = rawRAF(function () {
      e.raw = 0;
      if (paused && !soft) return;        // stays queued; flushed on resume
      frames.delete(id);
      try { e.cb(vnow()); } catch (err) { setTimeoutRaw(function () { throw err; }, 0); }
    });
  }
  function setTimeoutRaw(f, ms) { return rawST(f, ms); }
  if (rawRAF) {
    W.requestAnimationFrame = function (cb) { var id = nextId++, e = { cb: cb, raw: 0 }; frames.set(id, e); if (!paused || soft) schedule(id, e); return id; };
    W.cancelAnimationFrame = function (id) { var e = frames.get(id); if (e) { if (e.raw) rawCAF(e.raw); frames.delete(id); } else if (rawCAF) { try { rawCAF(id); } catch (x) {} } };
  }

  /* ---------- timers: they count active (unpaused) time only ----------
   * Every timeout and interval keeps its deadline on the game clock (vnow), so a pause simply stops it
   * and resume re-arms it with the time it still had left. Intervals re-arm themselves on that clock. */
  var timers = new Map(), tid = 1e6;
  function arm(id, t) { t.raw = rawST(function () { fire(id); }, Math.max(0, t.due - vnow())); }
  function fire(id) {
    var t = timers.get(id); if (!t) return;
    t.raw = 0;
    if (paused && !soft) return;                      // re-armed on resume
    if (vnow() < t.due - 1) { arm(id, t); return; }    // not yet due on the game clock
    if (t.every) { t.due += t.every; if (t.due < vnow()) t.due = vnow() + t.every; arm(id, t); } else timers.delete(id);
    try { t.fn.apply(W, t.args); } catch (e) { rawST(function () { throw e; }, 0); }
  }
  function addTimer(fn, ms, args, every) {
    var id = tid++, d = Math.max(0, +ms || 0);
    var t = { fn: fn, args: args, due: vnow() + (every ? Math.max(4, d) : d), every: every ? Math.max(4, d) : 0, raw: 0 };
    timers.set(id, t); if (!paused || soft) arm(id, t);
    return id;
  }
  function dropTimer(id) { var t = timers.get(id); if (!t) return false; if (t.raw) rawCT(t.raw); timers.delete(id); return true; }
  W.setTimeout = function (fn, ms) { if (typeof fn !== 'function') return rawST.apply(W, arguments); return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), false); };
  W.setInterval = function (fn, ms) { if (typeof fn !== 'function') return rawSI.apply(W, arguments); return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), true); };
  W.clearTimeout = function (id) { if (!dropTimer(id)) rawCT(id); };
  W.clearInterval = function (id) { if (!dropTimer(id)) rawCI(id); };
  function holdTimers() { timers.forEach(function (t) { if (t.raw) { rawCT(t.raw); t.raw = 0; } }); }
  function releaseTimers() { timers.forEach(function (t, id) { if (!t.raw) arm(id, t); }); }

  /* ---------- audio: one master gain per context, suspend on pause ---------- */
  var ctxs = new Set(), masters = new Map(), wasRunning = new Set(), media = new Set(), mediaWasPlaying = new Set();
  var AC = W.AudioContext || W.webkitAudioContext;
  function masterOf(ctx) {
    var m = masters.get(ctx);
    if (!m) { m = ctx.createGain(); rawConnect.call(m, ctx.destination); m.gain.value = muted ? 0 : 1; masters.set(ctx, m); ctxs.add(ctx); }
    return m;
  }
  var rawConnect = W.AudioNode && W.AudioNode.prototype.connect;
  if (AC && rawConnect) {
    try {
      var Wrapped = class extends AC { constructor(a) { super(a); ctxs.add(this); try { masterOf(this); } catch (e) {} if (paused && !soft) { try { this.suspend(); wasRunning.add(this); } catch (e) {} } } };
      W.AudioContext = Wrapped; if (W.webkitAudioContext) W.webkitAudioContext = Wrapped;
      W.AudioNode.prototype.connect = function (dest) {
        try {
          if (dest && W.AudioDestinationNode && dest instanceof W.AudioDestinationNode && !(W.OfflineAudioContext && dest.context instanceof W.OfflineAudioContext)) {
            var args = Array.prototype.slice.call(arguments); args[0] = masterOf(dest.context);
            return rawConnect.apply(this, args);
          }
        } catch (e) {}
        return rawConnect.apply(this, arguments);
      };
    } catch (e) {}
  }
  if (W.HTMLMediaElement) {
    var rawPlay = W.HTMLMediaElement.prototype.play;
    W.HTMLMediaElement.prototype.play = function () {
      media.add(this); if (muted) this.muted = true;
      if (paused && !soft) { mediaWasPlaying.add(this); return Promise.resolve(); }
      return rawPlay.apply(this, arguments);
    };
  }
  function applyMute() {
    masters.forEach(function (m) { try { m.gain.value = muted ? 0 : 1; } catch (e) {} });
    media.forEach(function (el) { try { el.muted = muted; } catch (e) {} });
    D.querySelectorAll && D.querySelectorAll('audio,video').forEach(function (el) { media.add(el); el.muted = muted; });
  }

  /* ---------- shared sound effects: ArcadeSDK.sfx('coin') ----------
   * The arcade hosts a kit of short sounds (assets/sfx/<name>.mp3, listed in assets/sfx/kit.json).
   * A game with no audio of its own calls ArcadeSDK.sfx(name, {volume, rate}) when something happens.
   * The sounds play through the SDK's master gain, so the arcade's mute and pause cover them; a name
   * that is not in the kit, or a kit that cannot load, is silent rather than an error. */
  var kitBase = (function () { try { var src = D.currentScript && D.currentScript.src; return src ? src.replace(/arcade-sdk\.js(\?.*)?$/, 'sfx/') : ''; } catch (e) { return ''; } })();
  var sfxCtx = null, sfxBuf = {}, sfxLoading = {}, sfxGain = null;
  function loadKit() {   // per-sound gains from kit.json even out the kit's loudness
    if (sfxGain) return sfxGain;
    sfxGain = (kitBase && W.fetch ? W.fetch(kitBase + 'kit.json').then(function (r) { return r.ok ? r.json() : {}; }) : Promise.resolve({}))
      .then(function (k) { var g = {}, s = (k && k.sounds) || {}; for (var n in s) g[n] = +s[n].gain || 1; return g; }, function () { return {}; });
    return sfxGain;
  }
  function sfxContext() {
    if (!sfxCtx && W.AudioContext) { try { sfxCtx = new W.AudioContext(); } catch (e) { sfxCtx = null; } }
    return sfxCtx;
  }
  function loadSfx(name) {
    if (sfxBuf[name] !== undefined) return Promise.resolve(sfxBuf[name]);
    if (sfxLoading[name]) return sfxLoading[name];
    var c = sfxContext(); if (!c || !kitBase || !W.fetch) return Promise.resolve(null);
    sfxLoading[name] = W.fetch(kitBase + encodeURIComponent(name) + '.mp3')
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); })
      .then(function (b) { return new Promise(function (res, rej) { c.decodeAudioData(b, res, rej); }); })
      .then(function (buf) { sfxBuf[name] = buf; return buf; }, function () { sfxBuf[name] = null; return null; });
    return sfxLoading[name];
  }
  var gains = {};
  function playBuf(buf, o, name) {
    var c = sfxContext(); if (!c || !buf || (paused && !soft)) return;
    try {
      if (c.state === 'suspended') c.resume();
      var src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; src.playbackRate.value = o.rate || 1; g.gain.value = (o.volume == null ? 0.8 : o.volume) * (gains[name] || 1);
      src.connect(g); g.connect(c.destination); src.start();
    } catch (e) {}
  }
  function playSfx(name, o) {
    o = o || {};
    if (sfxBuf[name]) return playBuf(sfxBuf[name], o, name);
    var asked = rawNow();
    loadKit().then(function (g) { gains = g; });
    loadSfx(name).then(function (buf) { if (rawNow() - asked < 250) playBuf(buf, o, name); });   // first use: play if it loaded quickly
  }
  // Browsers start audio only after a gesture; wake the kit's context on the first one.
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
    W.addEventListener(t, function () { if (sfxCtx && sfxCtx.state === 'suspended' && !(paused && !soft)) { try { sfxCtx.resume(); } catch (e) {} } }, { capture: true, passive: true });
  });

  /* ---------- graphics telemetry for the harness (which contexts the game asked for) ---------- */
  try {
    var rawGC = W.HTMLCanvasElement.prototype.getContext;
    W.HTMLCanvasElement.prototype.getContext = function (type) { var c = rawGC.apply(this, arguments); if (c && glTypes.length < 40) glTypes.push({ type: String(type), w: this.width, h: this.height }); return c; };
  } catch (e) {}

  /* ---------- pause / resume ---------- */
  // Hard pause: the SDK freezes frames, timers, the clock, audio and CSS. Soft pause (games with their own
  // pause menu, ownPauseUI): the game stops its own simulation in onPause and keeps drawing its menu.
  var soft = false;
  function pause(why) {
    if (paused) { if (why === 'user') reason = 'user'; return; }
    var at = rawNow();   // the moment of the pause, logged as such (building the menu takes time)
    paused = true; reason = why || 'user';
    soft = !!cfg.ownPauseUI && reason !== 'hidden';
    if (!soft) {
      pausedAt = at;
      ctxs.forEach(function (c) { if (c.state === 'running') { wasRunning.add(c); try { c.suspend(); } catch (e) {} } });
      media.forEach(function (el) { if (!el.paused) { mediaWasPlaying.add(el); try { el.pause(); } catch (e) {} } });
      holdTimers();
      freezeCss(true);
    }
    try { cfg.onPause && cfg.onPause(reason); } catch (e) {}
    if (!cfg.ownPauseUI && reason !== 'hidden') showMenu('pause');
    post('state', { paused: true, reason: reason }); log('pause', { reason: reason, soft: soft }, at);
  }
  function resume(why) {
    if (!paused) return;
    if (why === 'visible' && reason !== 'hidden') return;   // never un-pause a pause the player chose
    var wasSoft = soft, at = rawNow(); paused = false; reason = ''; soft = false;
    if (!wasSoft) {
      pausedTotal += at - pausedAt;
      wasRunning.forEach(function (c) { try { c.resume(); } catch (e) {} }); wasRunning.clear();
      mediaWasPlaying.forEach(function (el) { try { rawPlay.call(el); } catch (e) {} }); mediaWasPlaying.clear();
      frames.forEach(function (e, id) { if (!e.raw) schedule(id, e); });
      releaseTimers();
      freezeCss(false);
    }
    try { cfg.onResume && cfg.onResume(); } catch (e) {}
    hideMenu();
    post('state', { paused: false }); log('resume', null, at);
  }
  // A game with its own pause menu reports it here, so the arcade's Pause button stays in step.
  function gamePaused(on) {
    if (!!on === paused) return;
    if (on) { paused = true; soft = true; reason = 'game'; } else { paused = false; soft = false; reason = ''; }
    post('state', { paused: paused, reason: reason }); log(on ? 'pause' : 'resume', { reason: 'game', soft: true });
  }
  // Landscape games on a phone held upright: a full-screen "turn sideways" card, and the game waits
  // (a pause that ends by itself, like a hidden tab) until the phone is turned.
  var rotateEl = null, rotatePaused = false;
  function rotateCard() {
    try {
      if (rotateEl || !W.matchMedia) return;
      var mq = W.matchMedia('(orientation: portrait) and (pointer: coarse)');
      var phone = function () { try { return Math.min(W.screen.width, W.screen.height) < 700; } catch (e) { return false; } };   // phones only, not iPads
      rotateEl = el('div', { id: 'arcade-sdk-rotate', role: 'dialog', 'aria-label': 'Turn your phone sideways' });
      rotateEl.innerHTML = '<div class="ph"></div><b>Turn your phone sideways</b><span>This game plays across the screen.</span><button type="button" data-play-anyway>Play anyway</button>';
      var st = el('style', { text: '#arcade-sdk-rotate{position:fixed;inset:0;z-index:2147483646;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;background:#0b1024;color:#fff;font:700 22px/1.3 system-ui,-apple-system,sans-serif}' +
        '#arcade-sdk-rotate span{font-weight:500;font-size:17px;opacity:.8}' +
        '#arcade-sdk-rotate button{margin-top:6px;min-height:48px;padding:0 26px;border-radius:24px;border:2px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);color:#fff;font:700 17px system-ui,-apple-system,sans-serif}' +
        '#arcade-sdk-rotate .ph{width:70px;height:116px;border:6px solid #fff;border-radius:16px;animation:arcade-sdk-turn 2.2s ease-in-out infinite}' +
        '@keyframes arcade-sdk-turn{0%,20%{transform:rotate(0)}55%,80%{transform:rotate(-90deg)}100%{transform:rotate(0)}}' +
        '@media (prefers-reduced-motion:reduce){#arcade-sdk-rotate .ph{animation:none;transform:rotate(-90deg)}}' });
      (D.head || D.documentElement).appendChild(st); (D.body || D.documentElement).appendChild(rotateEl);
      var anyway = false; try { anyway = W.sessionStorage.getItem('arcade-sdk-play-anyway') === '1'; } catch (e) {}
      var sync = function () {
        var upright = mq.matches && phone() && !anyway;
        rotateEl.style.display = upright ? 'flex' : 'none';
        if (upright && !paused) { rotatePaused = true; pause('hidden'); }
        else if (!upright && rotatePaused) { rotatePaused = false; resume('visible'); }
      };
      rotateEl.querySelector('button').addEventListener('click', function () { anyway = true; try { W.sessionStorage.setItem('arcade-sdk-play-anyway', '1'); } catch (e) {} sync(); });
      if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
      W.addEventListener('resize', sync);
      sync();
    } catch (e) {}
  }
  var freezeEl = null, heldAnims = [];
  function freezeCss(on) {   // CSS animations stop with the game; the menu keeps its own
    try {
      if (on && !freezeEl) { freezeEl = el('style', { id: 'arcade-sdk-freeze', text: 'body *:not(#arcade-sdk):not(#arcade-sdk *):not(#arcade-sdk-btn){animation-play-state:paused!important}' }); (D.head || D.documentElement).appendChild(freezeEl); }
      else if (!on && freezeEl) { freezeEl.remove(); freezeEl = null; }
    } catch (e) {}
    freezeAnims(on);
  }
  // Web Animations (element.animate) and CSS transitions run on the document timeline, which the
  // stylesheet above does not reach: hold the running ones and play exactly those again on resume.
  // CSS animations are left to the stylesheet, so a game that sets animation-play-state keeps control.
  function freezeAnims(on) {
    try {
      if (on) {
        if (!D.getAnimations) return;
        D.getAnimations().forEach(function (a) {
          if (a.playState !== 'running' || (W.CSSAnimation && a instanceof W.CSSAnimation)) return;
          var t = a.effect && a.effect.target;
          if (t && t.nodeType === 1 && ((root && root.contains(t)) || t.id === 'arcade-sdk-btn')) return;
          try { a.pause(); heldAnims.push(a); } catch (e) {}
        });
      } else {
        var list = heldAnims; heldAnims = [];
        list.forEach(function (a) { try { if (a.playState === 'paused') a.play(); } catch (e) {} });
      }
    } catch (e) {}
  }
  // One capture-phase key listener. While the menu is open the game gets no keys, and Esc or P
  // steps back (or resumes). pauseKeys says which keys may open the menu: 'p+esc', 'p', 'esc' or ''
  // (game-meta sets it to the keys the game does not already use).
  var pauseKeys = '';
  W.addEventListener('keydown', function (e) {
    var k = e.key, inMenu = !!(root && e.target && e.target.nodeType && root.contains(e.target));
    if (panel) {
      if (k === 'Escape' || ((k === 'p' || k === 'P') && !(e.target && e.target.tagName === 'INPUT'))) {
        e.preventDefault(); e.stopPropagation(); if (panel === 'pause') resume('user'); else showMenu('pause');
      } else if (!inMenu) e.stopPropagation();
      return;
    }
    var t = e.target && e.target.tagName; if (!pauseKeys || t === 'INPUT' || t === 'TEXTAREA' || e.repeat) return;
    var useP = pauseKeys === 'p' || pauseKeys === 'p+esc', useEsc = pauseKeys === 'esc' || pauseKeys === 'p+esc';
    if ((useP && (k === 'p' || k === 'P')) || (useEsc && k === 'Escape')) { e.preventDefault(); e.stopPropagation(); if (paused) resume('user'); else pause('user'); }
  }, true);
  function setMuted(v) { muted = !!v; try { W.localStorage.setItem('arcade_muted', muted ? '1' : '0'); } catch (e) {} applyMute(); post('state', { muted: muted }); paintMenu(); }
  function restart() {
    hideMenu(); if (paused) resume('user');
    if (cfg.onRestart) { try { cfg.onRestart(); log('restart', { how: 'game' }); return; } catch (e) {} }
    if (inFrame) post('request-restart', {}); else W.location.reload();
  }
  function exitToTitle() {
    hideMenu(); if (paused) resume('user');
    if (cfg.onExit) { try { cfg.onExit(); log('exit', { how: 'game' }); return; } catch (e) {} }
    if (inFrame) post('request-restart', { toTitle: true }); else W.location.reload();
  }
  D.addEventListener('visibilitychange', function () { if (D.hidden) pause('hidden'); else resume('visible'); });

  /* ---------- the standard pause menu ---------- */
  var root = null, panel = '', tipIx = 0;
  function el(tag, attrs, kids) { var e = D.createElement(tag); for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
  var styled = false;
  function ensureStyle() {   // the pause button needs these rules before the menu ever opens
    if (styled || !(D.head || D.body)) return;
    styled = true;
    var css = el('style', { id: 'arcade-sdk-css', text:
      '#arcade-sdk{position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;background:var(--arcade-sdk-overlay,rgba(8,10,20,.62));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font:15px/1.45 var(--arcade-sdk-font,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--arcade-sdk-ink,#1c1f2e)}' +
      '#arcade-sdk.on{display:flex}#arcade-sdk .c{background:var(--arcade-sdk-bg,#fffdf7);border-radius:var(--arcade-sdk-radius,22px);box-shadow:0 24px 70px rgba(0,0,0,.45),inset 0 -5px 0 rgba(0,0,0,.08);padding:18px 20px 14px;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 20px);overflow:auto;text-align:center;box-sizing:border-box}' +
      '#arcade-sdk h2{margin:0 0 2px;font-size:22px;font-weight:900;letter-spacing:.2px}#arcade-sdk .sub{margin:0 0 10px;color:#6a6f86;font-size:13px}' +
      '#arcade-sdk button{display:block;width:100%;min-height:44px;margin:6px 0;border:0;border-radius:14px;font:800 16px var(--arcade-sdk-font,system-ui,sans-serif);cursor:pointer;color:var(--arcade-sdk-ink,#1c1f2e);background:var(--arcade-sdk-button,#eef0f8);box-shadow:inset 0 -4px 0 rgba(0,0,0,.12)}' +
      '#arcade-sdk button.p{background:var(--arcade-sdk-accent,linear-gradient(#5ee07c,#23b04b));color:var(--arcade-sdk-accent-ink,#fff);text-shadow:0 1px 0 rgba(0,0,0,.25)}#arcade-sdk button:focus-visible{outline:3px solid #6c7cff;outline-offset:2px}' +
      '#arcade-sdk .row{display:flex;gap:8px}#arcade-sdk .row button{flex:1}#arcade-sdk ol,#arcade-sdk ul{text-align:left;margin:6px 0 10px;padding-left:22px}#arcade-sdk li{margin:4px 0}' +
      '#arcade-sdk .tip{background:#fff4d6;border-radius:12px;padding:8px 12px;margin:8px 0;font-size:14px;text-align:left}#arcade-sdk input{width:100%;box-sizing:border-box;min-height:44px;border:2px solid #d9dcea;border-radius:12px;padding:0 12px;font:700 16px system-ui;text-transform:uppercase}' +
      '#arcade-sdk .msg{min-height:20px;font-weight:700;color:#23804a}#arcade-sdk table{width:100%;border-collapse:collapse;font-size:14px;text-align:left}#arcade-sdk td{padding:4px 6px;border-bottom:1px solid #eee}' +
      '#arcade-sdk-btn{position:fixed;z-index:2147483599;width:44px;height:44px;border-radius:50%;border:0;background:var(--arcade-sdk-btn-bg,rgba(10,12,24,.55));color:var(--arcade-sdk-btn-ink,#fff);font:900 15px system-ui;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.3)}' +
      '#arcade-sdk-btn:focus-visible{outline:3px solid #6c7cff}@media (prefers-reduced-motion:reduce){#arcade-sdk{backdrop-filter:none}}@media (max-height:540px) and (min-width:420px){#arcade-sdk .c{display:grid;grid-template-columns:1fr 1fr;column-gap:8px;align-content:start;width:min(600px,calc(100vw - 24px))}#arcade-sdk .c>h2,#arcade-sdk .c>.sub,#arcade-sdk .c>.tip,#arcade-sdk .c>ol,#arcade-sdk .c>ul,#arcade-sdk .c>table,#arcade-sdk .c>input,#arcade-sdk .c>.msg{grid-column:1/-1}#arcade-sdk .c>button[data-a=exit],#arcade-sdk .c>button[data-a=back]{grid-column:1/-1}#arcade-sdk button{min-height:40px;margin:4px 0}}' });
    D.head ? D.head.appendChild(css) : D.body.appendChild(css);
  }
  function ensureRoot() {
    if (root || !D.body) return root;
    ensureStyle();
    root = el('div', { id: 'arcade-sdk', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Game menu' });
    root.addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-a]') : null; if (b) act(b.getAttribute('data-a')); });
    D.body.appendChild(root);
    return root;
  }
  // theme: {bg, ink, font, accent, accentInk, button, overlay, radius, buttonBg, buttonInk} -> --arcade-sdk-* variables.
  // Games can also just set those variables in their own CSS (e.g. :root{--arcade-sdk-bg:#123}).
  function applyTheme() {
    try { var t = cfg.theme; if (!t || !D.documentElement) return; var map = { bg: 'bg', ink: 'ink', font: 'font', accent: 'accent', accentInk: 'accent-ink', button: 'button', overlay: 'overlay', radius: 'radius', buttonBg: 'btn-bg', buttonInk: 'btn-ink' };
      for (var k in map) if (t[k] != null) D.documentElement.style.setProperty('--arcade-sdk-' + map[k], String(t[k])); } catch (e) {}
  }
  function pauseButton() {
    if (cfg.ownPauseUI || cfg.pauseButton === 'none' || D.getElementById('arcade-sdk-btn') || !D.body) return;
    ensureStyle();
    var pos = cfg.pauseButton || meta.pauseButton || 'tr', b = el('button', { id: 'arcade-sdk-btn', type: 'button', 'aria-label': 'Pause', title: pauseKeys === 'esc' ? 'Pause (Esc)' : pauseKeys ? 'Pause (P)' : 'Pause' });
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.6" height="12" rx="1.2" fill="currentColor"/><rect x="9.4" y="2" width="3.6" height="12" rx="1.2" fill="currentColor"/></svg>';
    b.style[pos[0] === 't' ? 'top' : 'bottom'] = '10px'; b.style[pos[1] === 'l' ? 'left' : 'right'] = '10px';
    b.addEventListener('click', function (e) { e.stopPropagation(); pause('user'); });
    D.body.appendChild(b);
  }
  function list(tag, items) { return el(tag, {}, (items || []).map(function (t) { return el('li', { text: t }); })); }
  function paintMenu() { if (root && root.classList.contains('on')) render(); }
  function render() {
    var c = el('div', { class: 'c' }), title = meta.title || D.title || 'Paused', tips = meta.tips || [], howto = meta.howto || [], cheats = hasCheats();
    if (panel === 'pause') {
      c.appendChild(el('h2', { text: 'Paused' })); c.appendChild(el('p', { class: 'sub', text: title }));
      c.appendChild(el('button', { class: 'p', 'data-a': 'resume', text: 'Resume' }));
      c.appendChild(el('button', { 'data-a': 'restart', text: 'Restart' }));
      c.appendChild(el('div', { class: 'row' }, [el('button', { 'data-a': 'howto', text: 'How to play' }), el('button', { 'data-a': 'sound', text: muted ? 'Sound: off' : 'Sound: on', 'aria-pressed': String(!muted) })]));
      var extra = [];
      if (hasHints()) extra.push(el('button', { 'data-a': 'hint', text: 'Hint' }));
      if ((cfg.tricks || meta.tricks || []).length) extra.push(el('button', { 'data-a': 'tricks', text: 'Tricks' }));
      if (cheats) extra.push(el('button', { 'data-a': 'codes', text: 'Codes' }));
      if (extra.length) c.appendChild(el('div', { class: 'row' }, extra));
      if (tips.length) c.appendChild(el('div', { class: 'tip', text: '💡 ' + tips[tipIx++ % tips.length] }));
      c.appendChild(el('button', { 'data-a': 'exit', text: 'Exit to title' }));
    } else if (panel === 'howto') {
      c.appendChild(el('h2', { text: 'How to play' }));
      if (howto.length) c.appendChild(list('ol', howto)); else c.appendChild(el('p', { text: 'Explore and have fun!' }));
      var ctl = meta.controls || {}, rows = [];
      ['keyboard', 'touch', 'gamepad'].forEach(function (k) { if (ctl[k]) rows.push(el('tr', {}, [el('td', { text: k[0].toUpperCase() + k.slice(1) }), el('td', { text: ctl[k] })])); });
      if (rows.length) c.appendChild(el('table', {}, rows));
      if (tips.length) { c.appendChild(el('p', { class: 'sub', text: 'Tips' })); c.appendChild(list('ul', tips)); }
      if (cfg.onTutorial) c.appendChild(el('button', { 'data-a': 'tutorial', text: 'Replay tutorial' }));
      c.appendChild(el('button', { class: 'p', 'data-a': 'back', text: 'Back' }));
    } else if (panel === 'tricks') {
      c.appendChild(el('h2', { text: 'Trick list' }));
      c.appendChild(el('table', {}, (cfg.tricks || meta.tricks || []).map(function (t) { return el('tr', {}, [el('td', { text: t.name }), el('td', { text: t.input || '' })]); })));
      c.appendChild(el('button', { class: 'p', 'data-a': 'back', text: 'Back' }));
    } else if (panel === 'codes') {
      c.appendChild(el('h2', { text: 'Codes' })); c.appendChild(el('p', { class: 'sub', text: 'Codes are just for fun: a run with codes on never earns XP or replaces your best score.' }));
      var inp = el('input', { id: 'arcade-sdk-code', 'aria-label': 'Code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); act('enter-code'); } });
      c.appendChild(inp); c.appendChild(el('p', { class: 'msg', id: 'arcade-sdk-msg' }));
      c.appendChild(el('button', { class: 'p', 'data-a': 'enter-code', text: 'Enter code' })); c.appendChild(el('button', { 'data-a': 'back', text: 'Back' }));
    } else if (panel === 'hint') {
      var h = currentHint();
      c.appendChild(el('h2', { text: 'Hint' })); c.appendChild(el('div', { class: 'tip', text: h || 'Keep going, you are doing great!' }));
      c.appendChild(el('button', { class: 'p', 'data-a': 'back', text: 'Back' })); log('hint');
    }
    root.innerHTML = ''; root.appendChild(c);
    var f = root.querySelector('input,button.p,button'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function showMenu(which) { if (!ensureRoot()) return; panel = which || 'pause'; root.classList.add('on'); render(); }
  function hideMenu() { if (root) { root.classList.remove('on'); root.innerHTML = ''; } panel = ''; }
  function act(a) {
    if (a === 'resume') resume('user');
    else if (a === 'restart') restart();
    else if (a === 'exit') exitToTitle();
    else if (a === 'sound') setMuted(!muted);
    else if (a === 'back') showMenu('pause');
    else if (a === 'tutorial') { hideMenu(); if (paused) resume('user'); try { cfg.onTutorial(); log('tutorial'); } catch (e) { log('tutorial-error', { message: String(e) }); } }
    else if (a === 'enter-code') {
      var inp = D.getElementById('arcade-sdk-code'), msg = D.getElementById('arcade-sdk-msg'), code = (inp && inp.value || '').trim().toUpperCase(), r = { ok: false };
      r = tryCode(code);
      if (msg) { msg.textContent = r.ok ? (r.message || 'Code on!') : 'Not a code. Try again.'; msg.style.color = r.ok ? '#23804a' : '#b3261e'; }
    } else showMenu(a);
  }

  /* ---------- codes and hints ----------
   * A game either answers directly (onCheat returns {ok, message}; onHint returns text) or, when its
   * engine cannot return values into JavaScript (Godot's JavaScriptBridge), declares its codes up front
   * (init({cheats:[{code, effect}], onCheat})) and keeps the current hint fresh with setHint(text). */
  var hintText = '';
  function tryCode(code) {
    code = String(code || '').trim().toUpperCase();
    var r = { ok: false }, list = cfg.cheats;
    if (list && list.length) {
      var hit = null; for (var i = 0; i < list.length; i++) if (String(list[i].code).toUpperCase() === code) hit = list[i];
      if (hit) { r = { ok: true, message: hit.effect || 'Code on!' }; try { cfg.onCheat && cfg.onCheat(code); } catch (e) {} }
    } else if (cfg.onCheat) { try { r = cfg.onCheat(code) || { ok: false }; } catch (e) { r = { ok: false }; } }
    if (r.ok) { cheated = true; post('event', { name: 'cheat', data: { code: code } }); log('cheat', { code: code }); }
    return r;
  }
  function currentHint() { var h = ''; try { h = cfg.onHint ? cfg.onHint() : ''; } catch (e) {} return h || hintText || ''; }
  function hasHints() { return !!(cfg.onHint || hintText); }
  function hasCheats() { return !!(cfg.onCheat || (cfg.cheats && cfg.cheats.length)); }

  /* ---------- messages from the arcade page ---------- */
  W.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.arcade !== V || e.source !== W.parent) return;
    if (m.type === 'config') { meta = m.meta || {}; if (m.profile) setSnap(m.profile); pauseButton(); pauseKeys = cfg.pauseKeys != null ? cfg.pauseKeys : (meta.pauseKeys || ''); watchSaves(meta.saves); }
    else if (m.type === 'profile-state') setSnap(m.p);
    else if (m.type === 'pause') pause(m.reason || 'user');
    else if (m.type === 'resume') resume(m.reason || 'user');
    else if (m.type === 'mute') setMuted(true);
    else if (m.type === 'unmute') setMuted(false);
    else if (m.type === 'howto') { pause('user'); showMenu('howto'); }
    else if (m.type === 'menu') pause('user');
    else if (m.type === 'restart') restart();
    else if (m.type === 'exit') exitToTitle();
    else if (m.type === 'tutorial') act('tutorial');
    else if (m.type === 'cheat') { var r = tryCode(m.code); post('ack', { of: 'cheat', ok: !!r.ok, message: r.message || '' }); }
    else if (m.type === 'hint') { var h = currentHint(); if (h) log('hint'); post('ack', { of: 'hint', ok: !!h, message: h }); }
  });

  function caps() {
    return { sdk: V, pause: true, mute: true, menu: !cfg.ownPauseUI, ownPauseUI: !!cfg.ownPauseUI, restart: !!cfg.onRestart, exit: !!cfg.onExit,
      tutorial: !!cfg.onTutorial, hints: hasHints(), cheats: hasCheats(), tricks: (cfg.tricks || []).length, declared: !!cfg.declared, profile: true };
  }
  function log(name, data, at) { events.push({ t: Math.round(at == null ? rawNow() : at), name: name, data: data || null }); if (events.length > 200) events.shift(); }

  /* ---------- the arcade profile: heartbeats, saved bests, and the opt-in calls ---------- */
  var snap = null, snapCbs = [], lastBeat = 0, gpTimer = 0, doneAch = {}, hits = {}, saveKeys = [], saveLast = {}, saveTimer = 0;
  function setSnap(p) {
    if (!p || typeof p !== 'object') return; snap = { level: +p.level || 1, xp: +p.xp || 0, into: +p.into || 0, need: +p.need || 0, streak: +p.streak || 0, stars: +p.stars || 0, avatar: String(p.avatar || ''), title: String(p.title || '') };
    snapCbs.slice().forEach(function (f) { try { f(snap); } catch (e) {} });
  }
  function rate(kind, max, ms) {   // a game cannot flood the portal
    var t = rawNow(), a = (hits[kind] = (hits[kind] || []).filter(function (x) { return t - x < ms; }));
    if (a.length >= max) return false; a.push(t); return true;
  }
  function beat() { var t = rawNow(); if (t - lastBeat > 8000 && !(paused && !soft)) { lastBeat = t; post('profile', { op: 'active' }); } }
  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'touchmove', 'wheel'].forEach(function (n) { try { W.addEventListener(n, beat, { capture: true, passive: true }); } catch (e) {} });
  try {
    W.addEventListener('gamepadconnected', function () {   // a pad makes no DOM events: look at it every few seconds
      if (gpTimer) return;
      gpTimer = rawSI(function () { try { var pads = W.navigator.getGamepads ? W.navigator.getGamepads() : []; for (var i = 0; i < pads.length; i++) { var g = pads[i]; if (!g) continue; if (g.buttons.some(function (b) { return b.pressed; }) || g.axes.some(function (a) { return Math.abs(a) > 0.4; })) { beat(); return; } } } catch (e) {} }, 2500);
    });
  } catch (e) {}
  // A new best under a key the game declares in its meta `saves`: the number that looks like a best, found in the value.
  function readKey(k) { try { return W.localStorage.getItem(k); } catch (e) { return null; } }
  function bestIn(raw, key) {
    if (raw == null) return null; var val; try { val = JSON.parse(raw); } catch (e) { val = raw; }
    var low = /time|lap|rank|moves/i.test(key), found = [];
    (function walk(x, name, depth) {
      if (depth > 4 || found.length > 40) return;
      if (typeof x === 'number' && isFinite(x)) { if (/best|high|record|hi_?score|top/i.test(name) || (depth === 0 && /rec|score|best|high/i.test(key))) found.push(x); }
      else if (typeof x === 'string' && depth === 0 && x !== '' && isFinite(+x) && /rec|score|best|high/i.test(key)) found.push(+x);
      else if (x && typeof x === 'object' && !Array.isArray(x)) for (var k in x) walk(x[k], k, depth + 1);
    })(val, key, 0);
    if (!found.length) return null; return { v: low ? Math.min.apply(null, found) : Math.max.apply(null, found), low: low };
  }
  function pollSaves() {
    if (!inFrame) return;
    saveKeys.forEach(function (k) { var v = readKey(k); if (v === saveLast[k]) return; saveLast[k] = v; var b = bestIn(v, k); if (b && !cheated) post('profile', { op: 'saved', key: k, best: b.v, lower: b.low }); });
  }
  function watchSaves(list) {
    if (!inFrame || saveTimer || !Array.isArray(list)) return;
    saveKeys = list.filter(function (k) { return typeof k === 'string' && !/^idb:/.test(k); }).slice(0, 8); if (!saveKeys.length) return;
    saveKeys.forEach(function (k) { saveLast[k] = readKey(k); }); saveTimer = rawSI(pollSaves, 2500);
  }
  var profileApi = {
    award: function (o) { if (cheated || !inFrame || !o || !(+o.xp >= 1) || !rate('award', 8, 60000)) return false; post('profile', { op: 'award', xp: Math.min(30, Math.floor(+o.xp)), reason: String(o.reason || '').slice(0, 50) }); return true; },
    achievement: function (id, o) {
      id = String(id); if (cheated || !inFrame || !/^[A-Za-z0-9_.-]{1,32}$/.test(id) || doneAch[id] || !rate('ach', 10, 60000)) return false; doneAch[id] = 1; o = o || {};
      post('profile', { op: 'achievement', id: id, title: String(o.title || '').slice(0, 40), desc: String(o.desc || '').slice(0, 100), tier: /^(bronze|silver|gold|diamond)$/.test(o.tier) ? o.tier : 'bronze' }); return true;
    },
    quest: function (id, progress, o) {
      id = String(id); if (cheated || !inFrame || !/^[A-Za-z0-9_.-]{1,32}$/.test(id) || !rate('quest:' + id, 4, 5000)) return false; o = o || {};
      var p = progress && typeof progress === 'object' ? (+progress.value) / Math.max(1e-9, +progress.target || 1) : +progress; if (!(p >= 0)) return false;
      post('profile', { op: 'quest', id: id, progress: Math.min(1, p), title: String(o.title || '').slice(0, 60), xp: o.xp, stars: o.stars }); return true;
    },
    get: function () { return snap; },
    onChange: function (cb) { if (typeof cb === 'function') snapCbs.push(cb); if (inFrame && !snap) post('profile', { op: 'get' }); }
  };

  var api = {
    version: V,
    init: function (o) { o = o || {}; for (var k in o) cfg[k] = o[k]; cfg.declared = true; applyTheme(); if (cfg.pauseKeys != null) pauseKeys = cfg.pauseKeys; post('ready', { caps: caps() }); if (D.body) pauseButton(); if (cfg.orientation === 'landscape') rotateCard(); return api; },
    pause: function () { pause('user'); }, resume: function () { resume('user'); }, gamePaused: gamePaused,
    get paused() { return paused; }, get muted() { return muted; }, get cheated() { return cheated; },
    setMuted: setMuted, restart: restart, showMenu: function (w) { pause('user'); showMenu(w || 'pause'); },
    state: function (s) { var o = {}; s = s || {}; for (var k in s) o[k] = s[k]; if (typeof o.score === 'string' && o.score !== '' && isFinite(+o.score)) o.score = +o.score; if (cheated) o.cheated = true; post('state', o); if (s.scene) log('scene', { scene: s.scene, score: o.score, level: o.level, stars: o.stars }); },
    profile: profileApi,
    event: function (name, data) { log(name, data); post('event', { name: name, data: data || null }); },
    now: vnow,
    sfx: playSfx,
    preloadSfx: function (names) { loadKit().then(function (g) { gains = g; }); (names || []).forEach(loadSfx); },
    setHint: function (t) { var had = hasHints(); hintText = String(t || ''); if (!had && hintText) post('ready', { caps: caps() }); },
    tryCode: tryCode,
    debug: function () {
      return { version: V, paused: paused, soft: soft, reason: reason, pauseKeys: pauseKeys, muted: muted, cheated: cheated, clock: vnow(), raw: rawNow(), pausedTotal: pausedTotal, caps: caps(), meta: !!meta.title,
        audio: Array.from(ctxs).map(function (c) { var m = masters.get(c); return { state: c.state, master: m ? m.gain.value : null }; }),
        media: Array.from(media).map(function (el) { return { muted: el.muted, paused: el.paused }; }),
        gl: glTypes.slice(), profile: { snap: !!snap, watching: saveKeys.slice(), cheated: cheated }, frames: frames.size, timers: timers.size, heldAnims: heldAnims.length, events: events.slice(-40), menu: panel };
    }
  };
  W.ArcadeSDK = api;
  function boot() { applyMute(); post('ready', { caps: caps() }); if (!inFrame) pauseButton(); }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot); else boot();
  W.addEventListener('load', function () { post('ready', { caps: caps() }); });   // again, in case the arcade page was not listening yet
})();
