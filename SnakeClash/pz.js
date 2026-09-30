/* PZ: the puzzle-game kit shared by Block Blast, 2048, Tic Tac Toe, Connect Four and Minesweeper.
 * Dependency free, one script tag. What it gives a game:
 *   PZ.snd     WebAudio synth that unlocks on the first tap (iOS safe), shared mute (localStorage gamesMuted)
 *   PZ.fx      floating numbers, one capped particle canvas, confetti, shake, haptics
 *   PZ.daily   local-date key, seeded random, Monday-first week stamps
 *   PZ.profile a per-game profile: XP and levels, unlockable themes, three daily goals, weekly chest,
 *              a "progress" sheet, toasts and unlock cards.  Saved under localStorage "pz_<id>".
 * Nothing here throws: every storage and audio call is guarded, and it all works with reduced motion.
 * Research it follows: docs/playbook/progression-kit.js (XP curve, week stamps that reset without shame),
 * iphone-kit.js (audio gate, touch guards) and feel-kit ideas (capped particles, hit-stop free). */
(function (G) {
  'use strict';
  if (G.PZ) return;
  const D = document;
  const RM = () => { try { return G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setRaw(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  const cfg = { fontBase: 'assets/fonts/', texBase: 'assets/tex/' };

  /* ------------------------------------------------------------------ styles */
  const CSS = `
@font-face{font-family:'PZ Fredoka';src:url(FONTBASEfredoka.woff2) format('woff2');font-weight:300 700;font-display:swap}
@font-face{font-family:'PZ Nunito';src:url(FONTBASEnunito.woff2) format('woff2');font-weight:200 1000;font-display:swap}
:root{--pz-display:'PZ Fredoka','Fredoka',ui-rounded,'SF Pro Rounded',system-ui,-apple-system,'Segoe UI',sans-serif;--pz-text:'PZ Nunito','Nunito',ui-rounded,system-ui,-apple-system,'Segoe UI',sans-serif;
--pz-paper:url(TEXBASEpaper.jpg);--pz-oak:url(TEXBASEoak.jpg);--pz-walnut:url(TEXBASEwalnut.jpg);--pz-leather:url(TEXBASEleather.jpg);
--pz-ink:#4a2f17;--pz-sheet:#efdcaa;--pz-sheet2:rgba(120,78,30,.13);--pz-line:rgba(96,60,20,.28);--pz-accent:#c2571f;--pz-accent2:#f0b93a;--pz-good:#3f9d2a;--pz-mute:#7d5a33;--pz-gold:linear-gradient(180deg,#ffeaa3,#e6b53d 55%,#a8730f);--pz-navy:linear-gradient(180deg,rgba(28,52,96,.94),rgba(10,22,46,.96))}
.pz-parch{background-color:#f3e2b3;background-image:linear-gradient(180deg,rgba(255,250,232,.55),rgba(214,170,96,.18)),var(--pz-paper);background-blend-mode:normal,overlay;background-size:auto,220px}
.pz-layer{position:fixed;inset:0;pointer-events:none;z-index:9990;overflow:hidden}
#pzFx{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9991}
.pz-float{position:fixed;left:0;top:0;z-index:9992;pointer-events:none;font:700 22px/1 var(--pz-display);color:#fff;text-shadow:0 2px 0 rgba(30,15,0,.55),0 0 14px rgba(255,190,80,.55);white-space:nowrap;will-change:transform,opacity;animation:pzFloat var(--d,900ms) cubic-bezier(.2,.8,.3,1) forwards}
@keyframes pzFloat{0%{opacity:0;transform:translate(-50%,-30%) scale(.4)}14%{opacity:1;transform:translate(-50%,-70%) scale(1.25)}30%{transform:translate(-50%,-90%) scale(1)}100%{opacity:0;transform:translate(-50%,-260%) scale(1)}}
.pz-shake{animation:pzShake .34s cubic-bezier(.36,.07,.19,.97)}
@keyframes pzShake{10%,90%{transform:translate3d(calc(var(--a,3px)*-.3),0,0)}20%,80%{transform:translate3d(calc(var(--a,3px)*.6),calc(var(--a,3px)*-.3),0)}30%,50%,70%{transform:translate3d(calc(var(--a,3px)*-1),calc(var(--a,3px)*.4),0)}40%,60%{transform:translate3d(var(--a,3px),0,0)}}
.pz-toasts{position:fixed;left:0;right:0;top:max(10px,env(safe-area-inset-top));display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9995;pointer-events:none}
.pz-toast{max-width:min(92vw,420px);display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:16px;background:var(--pz-navy);color:#fff3d2;font:800 15px/1.25 var(--pz-text);box-shadow:0 10px 26px rgba(0,0,0,.45),inset 0 0 0 1.5px rgba(255,220,140,.55),inset 0 1px 0 rgba(255,255,255,.22);animation:pzToast 2.6s cubic-bezier(.2,1.2,.3,1) forwards}
.pz-toast b{font-family:var(--pz-display);font-weight:700;color:#ffd979}
.pz-toast i{font-style:normal;font-size:22px}
@keyframes pzToast{0%{opacity:0;transform:translateY(-16px) scale(.9)}10%{opacity:1;transform:none}88%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}
.pz-card-wrap{position:fixed;inset:0;z-index:9996;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(6,12,28,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:pzFade .2s ease}
@keyframes pzFade{from{opacity:0}to{opacity:1}}
.pz-card,.pz-res,.pz-sheet{background-color:#f3e2b3;background-image:linear-gradient(180deg,rgba(255,250,232,.55),rgba(214,170,96,.18)),var(--pz-paper);background-blend-mode:normal,overlay;background-size:auto,220px;color:var(--pz-ink)}
.pz-card{width:min(340px,100%);border-radius:24px;padding:26px 22px 20px;text-align:center;box-shadow:0 0 0 3px #6e4519,0 0 0 5px #e6bb55,0 24px 60px rgba(0,0,0,.55),inset 0 0 40px rgba(120,70,10,.22);font-family:var(--pz-text);animation:pzPop .5s cubic-bezier(.2,1.5,.35,1)}
@keyframes pzPop{0%{transform:scale(.6) rotate(-3deg);opacity:0}100%{transform:none;opacity:1}}
.pz-card .big{font:700 34px/1.05 var(--pz-display);margin:4px 0 6px;color:#8a3a12;text-shadow:0 1px 0 rgba(255,255,255,.5)}
.pz-card .sub{font:700 15px/1.4 var(--pz-text);color:var(--pz-mute);margin-bottom:14px}
.pz-card .ico{font-size:52px;line-height:1;filter:drop-shadow(0 4px 0 rgba(0,0,0,.18))}
.pz-btn{appearance:none;border:0;cursor:pointer;min-height:48px;padding:0 24px;border-radius:14px;font:700 17px/1 var(--pz-display);color:#fff;text-shadow:0 2px 0 rgba(20,60,10,.55);background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,0) 52%),linear-gradient(180deg,#8fe062,#3ea52d);box-shadow:0 0 0 2px #256f1b,0 5px 0 2px #1d5a14,0 10px 16px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.55);touch-action:manipulation;margin-bottom:5px}
.pz-btn:active{transform:translateY(3px);box-shadow:0 0 0 2px #256f1b,0 2px 0 2px #1d5a14,inset 0 1px 0 rgba(255,255,255,.4)}
.pz-btn.ghost{color:#fff3d2;text-shadow:0 2px 0 rgba(30,12,0,.6);background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0) 52%),linear-gradient(180deg,#a5773d,#6b4519);box-shadow:0 0 0 2px #4b2e10,0 5px 0 2px #3a230b,0 10px 16px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.4)}
.pz-btn:focus-visible,.pz-chip:focus-visible,.pz-sw:focus-visible,.pz-x:focus-visible,.pz-tab:focus-visible,.pz-node:focus-visible{outline:3px solid #ffd979;outline-offset:3px}
.pz-chip{appearance:none;border:0;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px 0 6px;border-radius:999px;font:700 15px/1 var(--pz-display);color:#fff3d2;background:var(--pz-navy);box-shadow:inset 0 0 0 1.5px rgba(255,220,140,.5),inset 0 1px 0 rgba(255,255,255,.2),0 4px 10px rgba(0,0,0,.3);touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.pz-chip .lv{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:conic-gradient(#ffd979 calc(var(--p,0)*1%),rgba(255,255,255,.2) 0);position:relative}
.pz-chip .lv::after{content:attr(data-lv);position:absolute;inset:4px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 40% 30%,#3b5d9e,#12244a);color:#fff;font:700 14px/1 var(--pz-display)}
.pz-chip .dot{position:absolute;top:4px;right:6px;width:11px;height:11px;border-radius:50%;background:#ff5a4d;box-shadow:0 0 0 2px #12244a;display:none}
.pz-chip.has .dot{display:block}
.pz-sheet-wrap{position:fixed;inset:0;z-index:9994;background:rgba(6,12,28,.6);animation:pzFade .2s ease;display:flex;align-items:flex-end;justify-content:center}
.pz-sheet{width:min(520px,100%);max-height:min(86vh,720px);overflow:auto;overscroll-behavior:contain;border-radius:26px 26px 0 0;padding:18px 18px calc(22px + env(safe-area-inset-bottom));font-family:var(--pz-text);box-shadow:0 -4px 0 #6e4519,0 -7px 0 #e6bb55,0 -14px 40px rgba(0,0,0,.5),inset 0 0 50px rgba(120,70,10,.2);animation:pzUp .32s cubic-bezier(.2,1,.3,1);touch-action:pan-y}
@keyframes pzUp{from{transform:translateY(60px);opacity:0}to{transform:none;opacity:1}}
.pz-sheet h2{font:700 24px/1.1 var(--pz-display);margin:0;color:#6d3410}
.pz-sheet h3{font:700 15px/1 var(--pz-display);letter-spacing:.08em;text-transform:uppercase;color:var(--pz-mute);margin:20px 0 10px}
.pz-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.pz-x{appearance:none;border:0;width:44px;height:44px;border-radius:50%;background:linear-gradient(180deg,#a5773d,#6b4519);color:#fff3d2;font:700 22px/1 var(--pz-display);cursor:pointer;box-shadow:0 0 0 2px #4b2e10,inset 0 1px 0 rgba(255,255,255,.4)}
.pz-lvbar{display:flex;align-items:center;gap:12px}
.pz-lvbadge{flex:none;width:60px;height:60px;border-radius:18px;display:grid;place-items:center;background:var(--pz-gold);color:#5b3300;font:700 28px/1 var(--pz-display);text-shadow:0 1px 0 rgba(255,255,255,.6);box-shadow:0 0 0 2px #8a5a0c,0 4px 0 2px #6b4408,inset 0 1px 0 rgba(255,255,255,.7)}
.pz-bar{height:16px;border-radius:99px;background:linear-gradient(180deg,#4b2e10,#6b4519);overflow:hidden;box-shadow:inset 0 2px 3px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.4)}
.pz-bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,0) 55%),linear-gradient(180deg,#8fe062,#3ea52d);transition:width .5s cubic-bezier(.2,1,.3,1);box-shadow:inset 0 -2px 0 rgba(0,0,0,.18)}
.pz-xpl{font:800 13px/1.3 var(--pz-text);color:var(--pz-mute);margin-top:6px}
.pz-week{display:flex;gap:6px;justify-content:space-between}
.pz-day{flex:1;text-align:center;font:800 12px/1 var(--pz-text);color:var(--pz-mute)}
.pz-day span{display:grid;place-items:center;height:40px;margin-bottom:5px;border-radius:12px;background:rgba(120,78,30,.14);font-size:19px;box-shadow:inset 0 2px 3px rgba(80,40,0,.28),0 1px 0 rgba(255,255,255,.45);color:transparent}
.pz-day.on span{background:var(--pz-gold);color:#6b3d00;box-shadow:0 0 0 2px #8a5a0c,0 2px 0 2px #6b4408,inset 0 1px 0 rgba(255,255,255,.7)}
.pz-day.today span{box-shadow:inset 0 0 0 2.5px #c2571f,inset 0 2px 3px rgba(80,40,0,.28)}
.pz-day.today.on span{box-shadow:0 0 0 2px #c2571f,0 2px 0 2px #6b4408,inset 0 1px 0 rgba(255,255,255,.7)}
.pz-q{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;background:rgba(120,78,30,.13);margin-bottom:8px;box-shadow:inset 0 1px 3px rgba(80,40,0,.22),0 1px 0 rgba(255,255,255,.45)}
.pz-q .t{flex:1;min-width:0;font:800 15px/1.25 var(--pz-text)}
.pz-q .t small{display:block;font-weight:700;color:var(--pz-mute);margin-top:2px}
.pz-q .bar{height:9px;margin-top:6px;border-radius:9px;background:linear-gradient(180deg,#4b2e10,#6b4519);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.5)}
.pz-q .bar i{display:block;height:100%;background:linear-gradient(180deg,#8fe062,#3ea52d);border-radius:9px;transition:width .4s}
.pz-q .x{flex:none;font:700 14px/1 var(--pz-display);color:#8a3a12}
.pz-q.done{background:rgba(63,157,42,.2)}
.pz-q.done .x{color:var(--pz-good)}
.pz-chest{width:100%;margin-top:10px}
.pz-themes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.pz-sw{appearance:none;border:0;cursor:pointer;position:relative;border-radius:16px;padding:8px 8px 10px;background:rgba(120,78,30,.13);color:var(--pz-ink);font:800 13px/1.15 var(--pz-text);text-align:center;box-shadow:inset 0 1px 3px rgba(80,40,0,.22),0 1px 0 rgba(255,255,255,.45);touch-action:manipulation;min-height:44px}
.pz-sw .sw{display:flex;height:44px;border-radius:11px;overflow:hidden;margin-bottom:6px;box-shadow:0 0 0 1.5px rgba(60,30,0,.5),0 3px 5px rgba(0,0,0,.3)}
.pz-sw .sw i{flex:1}
.pz-sw.cur{box-shadow:0 0 0 3px #c2571f,inset 0 1px 3px rgba(80,40,0,.22)}
.pz-sw.lock{opacity:.7}
.pz-sw.lock .sw{filter:grayscale(.75) brightness(.8)}
.pz-sw .lk{position:absolute;top:15px;left:0;right:0;font:700 15px/1 var(--pz-display);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.pz-extra{margin-top:4px}
/* ---- shared screens: overlay, level map, result card ---- */
.pz-ov{position:fixed;inset:0;z-index:30;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:max(16px,env(safe-area-inset-top)) 18px max(16px,env(safe-area-inset-bottom));text-align:center;background:radial-gradient(120% 80% at 50% 0,var(--pz-ov1,#24406e),var(--pz-ov2,#0a1428));color:var(--pz-ovink,#fff3d2);overflow:auto;-webkit-overflow-scrolling:touch}
.pz-ov.on{display:flex}
.pz-ov.dim{background:rgba(6,12,28,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.pz-ov h2{font:700 30px/1.05 var(--pz-display);text-shadow:0 2px 0 rgba(0,0,0,.4)}
.pz-tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.pz-tab{appearance:none;border:0;min-height:44px;min-width:48px;padding:0 14px;border-radius:12px;cursor:pointer;color:#fff3d2;font:700 15px/1 var(--pz-display);background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0) 52%),linear-gradient(180deg,#a5773d,#6b4519);box-shadow:0 0 0 2px #4b2e10,0 4px 0 2px #3a230b,inset 0 1px 0 rgba(255,255,255,.4);touch-action:manipulation;margin-bottom:4px;text-shadow:0 2px 0 rgba(30,12,0,.6)}
.pz-tab.on{color:#5b3300;background:var(--pz-gold);text-shadow:0 1px 0 rgba(255,255,255,.6);box-shadow:0 0 0 2px #8a5a0c,0 4px 0 2px #6b4408,inset 0 1px 0 rgba(255,255,255,.7)}
.pz-tab.lock{opacity:.65}
.pz-world{width:min(360px,100%);border-radius:24px;padding:16px 14px 24px;color:#4a2f17;background-color:#f3e2b3;background-image:linear-gradient(160deg,var(--w1,#ffd6a5),var(--w2,#ffb37a)),var(--pz-paper);background-blend-mode:soft-light,multiply;background-size:auto,220px;box-shadow:0 0 0 3px #6e4519,0 0 0 5px #e6bb55,0 18px 40px rgba(0,0,0,.45),inset 0 0 40px rgba(120,70,10,.25)}
.pz-world h3{font:700 22px/1 var(--pz-display);color:#6d3410}
.pz-world p{font:800 14px/1.3 var(--pz-text);opacity:.75;margin:3px 0 14px}
.pz-nodes{display:grid;grid-template-columns:repeat(3,1fr);gap:16px 10px}
.pz-node{appearance:none;border:0;cursor:pointer;aspect-ratio:1;min-height:58px;border-radius:50%;color:#fff3d2;font:700 24px/1 var(--pz-display);position:relative;text-shadow:0 2px 0 rgba(30,12,0,.7);background-color:#b58447;background-image:radial-gradient(circle at 35% 25%,rgba(255,255,255,.45),rgba(255,255,255,0) 55%),var(--pz-oak);background-size:auto,150px;background-blend-mode:normal;box-shadow:0 0 0 3px #e6bb55,0 0 0 5px #7a4d10,0 6px 0 5px #4b2e10,0 10px 12px rgba(0,0,0,.35);touch-action:manipulation}
.pz-node:active{transform:translateY(3px)}
.pz-node.lock{background-color:#8b8577;background-image:radial-gradient(circle at 35% 25%,rgba(255,255,255,.25),rgba(255,255,255,0) 55%);color:rgba(255,255,255,.7);box-shadow:0 0 0 3px #b9b3a4,0 0 0 5px #666,0 6px 0 5px #444;cursor:default;filter:saturate(.4)}
.pz-node.cur{animation:pzPulse 1.1s ease-in-out infinite;box-shadow:0 0 0 3px #fff2b0,0 0 0 5px #e6a520,0 6px 0 5px #4b2e10,0 0 22px 6px rgba(255,205,90,.75)}
.pz-node.boss{background-color:#a3392b;background-image:radial-gradient(circle at 35% 25%,rgba(255,255,255,.5),rgba(255,255,255,0) 55%),var(--pz-oak);background-blend-mode:normal,multiply}
.pz-node .st{position:absolute;left:-6px;right:-6px;bottom:-24px;font:700 15px/1 var(--pz-display);letter-spacing:1px;color:#ffc934;text-shadow:0 1px 0 rgba(90,50,0,.9),0 0 3px rgba(90,50,0,.8)}
.pz-node .st.z{color:rgba(90,50,0,.35);text-shadow:none}
@keyframes pzPulse{50%{transform:scale(1.07)}}
.pz-stars{display:flex;gap:6px;justify-content:center;margin:2px 0 8px}
.pz-stars svg{width:60px;height:60px;filter:drop-shadow(0 4px 0 rgba(60,30,0,.35))}
.pz-stars svg.pop{animation:pzStar .6s cubic-bezier(.2,1.7,.3,1) backwards}
@keyframes pzStar{from{transform:scale(0) rotate(-90deg);opacity:0}}
.pz-res{width:min(340px,100%);border-radius:24px;padding:22px 20px 20px;box-shadow:0 0 0 3px #6e4519,0 0 0 5px #e6bb55,0 24px 60px rgba(0,0,0,.55),inset 0 0 40px rgba(120,70,10,.22);text-align:center;font-family:var(--pz-text);animation:pzPop .45s cubic-bezier(.2,1.5,.35,1)}
.pz-res h2{font:700 32px/1.05 var(--pz-display);color:#8a3a12;text-shadow:0 1px 0 rgba(255,255,255,.5)}
.pz-res .big{font:700 50px/1.05 var(--pz-display);font-variant-numeric:tabular-nums;margin:2px 0;color:#4a2f17;text-shadow:0 2px 0 rgba(255,255,255,.5)}
.pz-res p{font:800 15px/1.4 var(--pz-text);color:var(--pz-mute);margin:6px 0}
.pz-res .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.pz-res .stats div{background:rgba(120,78,30,.14);border-radius:12px;padding:8px 4px;box-shadow:inset 0 1px 3px rgba(80,40,0,.25),0 1px 0 rgba(255,255,255,.45)}
.pz-res .stats b{display:block;font:700 22px/1 var(--pz-display)}
.pz-res .stats small{font:800 12px/1.2 var(--pz-text);color:var(--pz-mute)}
.pz-res .xp{font:700 16px/1 var(--pz-display);color:#3f7f1f;margin:4px 0 12px}
.pz-res .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.pz-badge{display:inline-block;padding:4px 12px;border-radius:999px;background:linear-gradient(180deg,#ff8a6d,#d63b1f);color:#fff;font:700 14px/1 var(--pz-display);animation:pzPulse .9s ease-in-out infinite;margin:2px 0 4px;box-shadow:0 0 0 2px #8a1f0c,0 3px 0 2px #6b1808;text-shadow:0 1px 0 rgba(0,0,0,.4)}
@media (prefers-reduced-motion:reduce){.pz-node.cur,.pz-badge,.pz-stars svg.pop,.pz-res{animation:none!important}.pz-float,.pz-toast,.pz-card,.pz-sheet,.pz-card-wrap,.pz-sheet-wrap,.pz-shake{animation-duration:.01s!important}.pz-bar>i{transition:none}}
`;
  function injectCss() {
    if (D.getElementById('pzCss')) return;
    if (!D.getElementById('pzDefs')) { const d = D.createElement('div'); d.id = 'pzDefs'; d.setAttribute('aria-hidden', 'true'); d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; d.innerHTML = '<svg width="0" height="0"><defs><linearGradient id="pzGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".55" stop-color="#f0b93a"/><stop offset="1" stop-color="#b57a10"/></linearGradient></defs></svg>'; (D.body || D.documentElement).appendChild(d); }
    const st = D.createElement('style'); st.id = 'pzCss'; st.textContent = CSS.replace(/FONTBASE/g, cfg.fontBase).replace(/TEXBASE/g, cfg.texBase);
    D.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ sound */
  const snd = {
    ctx: null, master: null, muted: store.raw('gamesMuted') === '1', last: {},
    ac() {
      if (!snd.ctx) {
        const A = G.AudioContext || G.webkitAudioContext; if (!A) return null;
        try {
          snd.ctx = new A(); snd.master = snd.ctx.createGain(); snd.master.gain.value = 0.85;
          const c = snd.ctx.createDynamicsCompressor(); c.threshold.value = -14; c.ratio.value = 6;
          snd.master.connect(c); c.connect(snd.ctx.destination);
        } catch (e) { snd.ctx = null; return null; }
      }
      if (snd.ctx.state !== 'running') { try { snd.ctx.resume(); } catch (e) {} }
      return snd.ctx;
    },
    setMuted(m) { snd.muted = !!m; store.setRaw('gamesMuted', m ? '1' : '0'); },
    isMuted() { snd.muted = store.raw('gamesMuted') === '1'; return snd.muted; },
    /* one soft voice: sine/triangle body with an optional octave shimmer, lowpassed, exponential decay */
    note(f, o) {
      if (snd.isMuted()) return; const c = snd.ac(); if (!c) return; o = o || {};
      const t = c.currentTime + (o.delay || 0), dur = o.dur || 0.18, vol = o.vol == null ? 0.16 : o.vol;
      try {
        const g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp || 5200;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.att || 0.008)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const mk = (freq, type, v) => {
          const os = c.createOscillator(), gg = c.createGain(); os.type = type; os.frequency.setValueAtTime(freq, t);
          if (o.slide) os.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
          gg.gain.value = v; os.connect(gg); gg.connect(g); os.start(t); os.stop(t + dur + 0.05);
        };
        mk(f, o.type || 'sine', 1);
        if (o.shimmer) mk(f * 2, 'sine', o.shimmer);
        g.connect(lp); lp.connect(snd.master);
      } catch (e) {}
    },
    noise(o) {
      if (snd.isMuted()) return; const c = snd.ac(); if (!c) return; o = o || {};
      try {
        const n = Math.floor(c.sampleRate * (o.dur || 0.08)), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const s = c.createBufferSource(); s.buffer = b; const g = c.createGain(), f = c.createBiquadFilter();
        f.type = o.type || 'bandpass'; f.frequency.value = o.freq || 1800; g.gain.value = o.vol || 0.1;
        s.connect(f); f.connect(g); g.connect(snd.master); s.start(c.currentTime + (o.delay || 0));
      } catch (e) {}
    },
    /* a pentatonic ladder so streaks always sound pleasant */
    scale: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1567.98],
    step(i) { return snd.scale[clamp(i, 0, snd.scale.length - 1)]; },
    play(name, a) {
      const nowT = performance.now(); if (snd.last[name] && nowT - snd.last[name] < 35) return; snd.last[name] = nowT;
      switch (name) {
        case 'tap': snd.note(720, { dur: 0.06, type: 'triangle', vol: 0.07, slide: 980 }); break;
        case 'pick': snd.note(560, { dur: 0.09, type: 'triangle', vol: 0.08, slide: 840 }); break;
        case 'place': snd.note(190, { dur: 0.13, vol: 0.2, slide: 90 }); snd.noise({ dur: 0.04, freq: 2400, vol: 0.05 }); break;
        case 'drop': snd.note(150, { dur: 0.16, vol: 0.24, slide: 70 }); snd.noise({ dur: 0.05, freq: 900, vol: 0.06 }); break;
        case 'pop': snd.note(380 + (a || 0) * 60, { dur: 0.11, vol: 0.13, slide: 900 + (a || 0) * 90, shimmer: 0.25 }); break;
        case 'merge': { const k = clamp(a || 0, 0, 11); snd.note(snd.step(k), { dur: 0.32, vol: 0.15, shimmer: 0.4, type: 'triangle' }); snd.note(snd.step(k + 2), { dur: 0.3, vol: 0.09, delay: 0.05, shimmer: 0.3 }); break; }
        case 'clear': { const n = clamp(a || 1, 1, 6); for (let i = 0; i < n + 2; i++) snd.note(snd.step(i * 1 + 2), { dur: 0.26, vol: 0.13, delay: i * 0.055, shimmer: 0.5, type: 'triangle' }); break; }
        case 'combo': { const k = clamp(a || 1, 1, 9); for (let i = 0; i < 3; i++) snd.note(snd.step(k + i * 2), { dur: 0.22, vol: 0.12, delay: i * 0.06, shimmer: 0.6 }); break; }
        case 'coin': snd.note(988, { dur: 0.07, type: 'square', vol: 0.05 }); snd.note(1319, { dur: 0.22, type: 'square', vol: 0.05, delay: 0.07 }); break;
        case 'win': [0, 2, 4, 5, 7].forEach((s, i) => snd.note(snd.step(s + 3), { dur: 0.38, vol: 0.14, delay: i * 0.09, shimmer: 0.4, type: 'triangle' })); break;
        case 'lose': [0, -2, -4].forEach((s, i) => snd.note(330 * Math.pow(2, s / 12), { dur: 0.36, vol: 0.14, delay: i * 0.16, type: 'triangle', lp: 1400, slide: 330 * Math.pow(2, (s - 1) / 12) })); break;
        case 'unlock': [0, 4, 7, 12].forEach((s, i) => snd.note(523.25 * Math.pow(2, s / 12), { dur: 0.45, vol: 0.12, delay: i * 0.08, shimmer: 0.5, type: 'triangle' })); break;
        case 'error': snd.note(150, { dur: 0.14, type: 'square', vol: 0.07, lp: 700 }); break;
        case 'flag': snd.note(660, { dur: 0.05, type: 'square', vol: 0.05 }); snd.note(880, { dur: 0.08, type: 'square', vol: 0.05, delay: 0.05 }); break;
        case 'boom': snd.note(110, { dur: 0.5, vol: 0.3, slide: 38 }); snd.noise({ dur: 0.35, freq: 500, vol: 0.2, type: 'lowpass' }); break;
        case 'reveal': snd.note(420 + (a || 0) * 40, { dur: 0.07, type: 'triangle', vol: 0.06, slide: 620 + (a || 0) * 40 }); break;
        default: snd.note(600, { dur: 0.08, vol: 0.08 });
      }
    },
  };
  /* iOS: create and resume the context inside the first real gesture, then never think about it again. */
  (function gate() {
    const go = () => { snd.ac(); };
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach(t => D.addEventListener(t, go, { passive: true, capture: true }));
    D.addEventListener('visibilitychange', () => { if (!D.hidden && snd.ctx && snd.ctx.state !== 'running') { try { snd.ctx.resume(); } catch (e) {} } });
  })();

  /* ------------------------------------------------------------------ effects */
  const fx = {
    cv: null, cx: null, ps: [], raf: 0, last: 0, dpr: 1, W: 0, H: 0,
    haptic(p) { try { if (!snd.isMuted() && navigator.vibrate) navigator.vibrate(p); } catch (e) {} },
    ensure() {
      if (fx.cv) return true;
      injectCss();
      const c = D.createElement('canvas'); c.id = 'pzFx'; c.setAttribute('aria-hidden', 'true'); D.body.appendChild(c);
      fx.cv = c; fx.cx = c.getContext('2d'); fx.size();
      G.addEventListener('resize', fx.size);
      return true;
    },
    size() {
      if (!fx.cv) return;
      fx.dpr = Math.min(G.devicePixelRatio || 1, 2); fx.W = G.innerWidth; fx.H = G.innerHeight;
      fx.cv.width = Math.round(fx.W * fx.dpr); fx.cv.height = Math.round(fx.H * fx.dpr);
    },
    /* n particles from (x,y) in viewport pixels */
    burst(x, y, o) {
      if (RM()) return; o = o || {}; fx.ensure();
      const cols = o.colors || ['#ffd166', '#ff7a59', '#4dd4ac', '#6fa8ff', '#ff8fd0'], n = Math.min(o.n || 14, 40), sp = o.speed || 280;
      for (let i = 0; i < n; i++) {
        const a = o.dir != null ? o.dir + (Math.random() - 0.5) * (o.spread || 1.6) : Math.random() * Math.PI * 2, v = sp * (0.35 + Math.random() * 0.8);
        fx.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.lift || 60), g: o.gravity == null ? 900 : o.gravity, life: 0, max: (o.life || 0.7) * (0.7 + Math.random() * 0.6), s: (o.size || 7) * (0.6 + Math.random() * 0.8), c: cols[i % cols.length], shape: o.shape || 'circle', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
      }
      if (fx.ps.length > 260) fx.ps.splice(0, fx.ps.length - 260);
      if (!fx.raf) { fx.last = performance.now(); fx.raf = requestAnimationFrame(fx.tick); }
    },
    confetti(n) {
      if (RM()) return; fx.ensure(); n = Math.min(n || 70, 110);
      const cols = ['#ffd166', '#ff7a59', '#4dd4ac', '#6fa8ff', '#ff8fd0', '#b48bff'];
      for (let i = 0; i < n; i++) fx.ps.push({ x: Math.random() * fx.W, y: -10 - Math.random() * 60, vx: (Math.random() - 0.5) * 140, vy: 120 + Math.random() * 200, g: 260, life: 0, max: 1.8 + Math.random() * 1.2, s: 6 + Math.random() * 6, c: cols[i % cols.length], shape: 'rect', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
      if (fx.ps.length > 260) fx.ps.splice(0, fx.ps.length - 260);
      if (!fx.raf) { fx.last = performance.now(); fx.raf = requestAnimationFrame(fx.tick); }
    },
    tick(now) {
      fx.raf = 0; const dt = Math.min(0.05, (now - fx.last) / 1000); fx.last = now;
      const c = fx.cx; c.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0); c.clearRect(0, 0, fx.W, fx.H);
      let w = 0;
      for (let i = 0; i < fx.ps.length; i++) {
        const p = fx.ps[i]; p.life += dt; if (p.life >= p.max) continue;
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; fx.ps[w++] = p;
        const k = 1 - p.life / p.max; c.globalAlpha = Math.min(1, k * 1.6); c.fillStyle = p.c;
        if (p.shape === 'rect') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); c.restore(); }
        else if (p.shape === 'star') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.beginPath(); for (let j = 0; j < 8; j++) { const r = (j % 2 ? 0.45 : 1) * p.s * k; const a = j * Math.PI / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); c.restore(); }
        else { c.beginPath(); c.arc(p.x, p.y, Math.max(0.5, p.s * (0.4 + k * 0.6)), 0, 6.283); c.fill(); }
      }
      fx.ps.length = w; c.globalAlpha = 1;
      if (w > 0) fx.raf = requestAnimationFrame(fx.tick); else c.clearRect(0, 0, fx.W, fx.H);
    },
    floats: [],
    float(x, y, text, o) {
      injectCss(); o = o || {};
      if (fx.floats.length >= 9) { const old = fx.floats.shift(); old.remove(); }
      const e = D.createElement('div'); e.className = 'pz-float'; e.textContent = text;
      e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.color = o.color || '#fff'; e.style.fontSize = (o.size || 22) + 'px'; e.style.setProperty('--d', (o.ms || 900) + 'ms');
      if (RM()) e.style.animation = 'none';
      D.body.appendChild(e); fx.floats.push(e);
      const done = () => { e.remove(); const i = fx.floats.indexOf(e); if (i >= 0) fx.floats.splice(i, 1); };
      e.addEventListener('animationend', done); setTimeout(done, (o.ms || 900) + 400);
    },
    shake(el, amp) {
      if (RM() || !el) return; injectCss();
      el.style.setProperty('--a', (amp || 4) + 'px'); el.classList.remove('pz-shake'); void el.offsetWidth; el.classList.add('pz-shake');
      clearTimeout(el._pzS); el._pzS = setTimeout(() => el.classList.remove('pz-shake'), 400);
    },
  };

  /* ------------------------------------------------------------------ daily helpers */
  const daily = {
    today: () => iso(new Date()),
    rng: (salt) => mulberry(hashStr(String(salt) + '|' + iso(new Date()))),
    seed: (salt, day) => hashStr(String(salt) + '|' + (day || iso(new Date()))),
    mulberry, hashStr, iso,
    /* Monday-first week containing `day`; `played` is an array of ISO days */
    week(played, day) {
      const [y, m, d] = (day || iso(new Date())).split('-').map(Number), t = new Date(y, m - 1, d), dow = (t.getDay() + 6) % 7, out = [];
      for (let i = 0; i < 7; i++) { const dd = new Date(y, m - 1, d - dow + i); out.push({ day: iso(dd), on: played.includes(iso(dd)), today: i === dow, label: 'MTWTFSS'[i] }); }
      return { days: out, count: out.filter(x => x.on).length, key: out[0].day };
    },
  };

  /* ------------------------------------------------------------------ toast + card */
  let toastBox = null;
  function toast(html, o) {
    injectCss(); o = o || {};
    if (!toastBox) { toastBox = D.createElement('div'); toastBox.className = 'pz-toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); D.body.appendChild(toastBox); }
    while (toastBox.children.length >= 2) toastBox.firstChild.remove();
    const e = D.createElement('div'); e.className = 'pz-toast'; e.innerHTML = html; toastBox.appendChild(e);
    const done = () => e.remove(); e.addEventListener('animationend', done); setTimeout(done, 3000);
  }
  const cardQueue = []; let cardOpen = false;
  function card(o) { cardQueue.push(o); if (!cardOpen) nextCard(); }
  function nextCard() {
    const o = cardQueue.shift(); if (!o) { cardOpen = false; return; }
    cardOpen = true; injectCss();
    const w = D.createElement('div'); w.className = 'pz-card-wrap'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = '<div class="pz-card">' + (o.icon ? '<div class="ico">' + o.icon + '</div>' : '') + '<div class="big">' + esc(o.title || '') + '</div><div class="sub">' + (o.sub || '') + '</div>' +
      (o.extra || '') + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="pz-btn" data-ok>' + esc(o.button || 'Nice!') + '</button>' + (o.button2 ? '<button class="pz-btn ghost" data-no>' + esc(o.button2) + '</button>' : '') + '</div></div>';
    D.body.appendChild(w);
    const close = (which) => { w.remove(); try { if (which === 'ok' && o.onOk) o.onOk(); if (which === 'no' && o.onNo) o.onNo(); } catch (e) {} nextCard(); };
    w.querySelector('[data-ok]').addEventListener('click', () => close('ok'));
    const no = w.querySelector('[data-no]'); if (no) no.addEventListener('click', () => close('no'));
    try { w.querySelector('[data-ok]').focus({ preventScroll: true }); } catch (e) {}
    if (o.sound !== false) snd.play(o.sound || 'unlock');
    if (o.confetti) fx.confetti(o.confetti);
  }


  /* ------------------------------------------------------------------ shared screens */
  const STAR = on => '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3l4.8 10.2L36 14.6l-8.2 7.6L30 33 20 27.6 10 33l2.2-10.8L4 14.6l11.2-1.4z" fill="' + (on ? 'url(#pzGold)' : 'rgba(70,40,10,.28)') + '" stroke="' + (on ? '#8a5a0c' : 'rgba(60,30,0,.4)') + '" stroke-width="2.2" stroke-linejoin="round"/>' + (on ? '<path d="M13 12l3.5-4.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>' : '') + '</svg>';
  const ui = {
    star: STAR,
    /* an overlay screen you fill yourself; toggle with .on */
    overlay(id, dim) { injectCss(); let e = D.getElementById(id); if (!e) { e = D.createElement('div'); e.id = id; e.className = 'pz-ov' + (dim ? ' dim' : ''); D.body.appendChild(e); } return e; },
    /* Pack tabs + a grid of numbered level nodes with stars.  o: { el, packs:[{name,sub,sky:[a,b]}], per, stars:[n...], open(pack)->bool, playable(i)->bool, cur (index), onPick(i), onLocked(pack) } */
    worldMap(o, pack) {
      const el = o.el; if (pack == null) pack = o.startPack || 0; injectCss();
      const tabs = o.packs.map((p, k) => '<button class="pz-tab' + (k === pack ? ' on' : '') + (o.open(k) ? '' : ' lock') + '" data-pk="' + k + '" role="tab" aria-selected="' + (k === pack) + '" aria-label="' + esc(p.name) + (o.open(k) ? '' : ', locked') + '">' + (o.open(k) ? '' : '🔒 ') + (k + 1) + '</button>').join('');
      const P = o.packs[pack]; let nodes = '';
      for (let n = 0; n < o.per; n++) {
        const i = pack * o.per + n, ok = o.open(pack) && o.playable(i), st = o.stars[i] || 0, cur = ok && i === o.cur;
        nodes += '<button class="pz-node' + (ok ? '' : ' lock') + (cur ? ' cur' : '') + (n === o.per - 1 ? ' boss' : '') + '" data-i="' + i + '" aria-label="Level ' + (n + 1) + (ok ? (st ? ', ' + st + ' stars' : ', new') : ', locked') + '">' + (ok ? (n + 1) : '🔒') + (ok ? '<span class="st' + (st ? '' : ' z') + '">' + (st ? '★'.repeat(st) : '☆☆☆') + '</span>' : '') + '</button>';
      }
      el.innerHTML = '<div class="pz-tabs" role="tablist">' + tabs + '</div><div class="pz-world" style="--w1:' + P.sky[0] + ';--w2:' + P.sky[1] + '"><h3>' + esc(P.name) + '</h3><p>' + esc(P.sub || '') + '</p><div class="pz-nodes" style="grid-template-columns:repeat(' + (o.cols || 3) + ',1fr)">' + nodes + '</div></div>';
      el.querySelectorAll('[data-pk]').forEach(b => b.addEventListener('click', () => { const k = +b.dataset.pk; snd.play(o.open(k) ? 'tap' : 'error'); if (o.open(k)) ui.worldMap(o, k); else o.onLocked && o.onLocked(k); }));
      el.querySelectorAll('.pz-node').forEach(b => b.addEventListener('click', () => { if (b.classList.contains('lock')) { snd.play('error'); return; } snd.play('tap'); o.onPick(+b.dataset.i); }));
    },
    /* result card. o: { title, big, sub, stars (0-3 or undefined), stats:[{v,l}], xp, newBest, buttons:[{id,label,primary}] } */
    result(el, o, cb) {
      injectCss();
      el.innerHTML = '<div class="pz-res"><h2>' + esc(o.title) + '</h2>' + (o.newBest ? '<div class="pz-badge">NEW BEST</div>' : '') + (o.stars != null ? '<div class="pz-stars">' + [0, 1, 2].map(k => '<span data-k="' + k + '">' + STAR(k < o.stars) + '</span>').join('') + '</div>' : '') +
        (o.big != null ? '<div class="big">' + o.big + '</div>' : '') + (o.sub ? '<p>' + o.sub + '</p>' : '') +
        (o.stats ? '<div class="stats">' + o.stats.map(x => '<div><b>' + x.v + '</b><small>' + esc(x.l) + '</small></div>').join('') + '</div>' : '') +
        (o.xp ? '<div class="xp">+' + o.xp + ' XP</div>' : '') + '<div class="btns">' + o.buttons.map(b => '<button class="pz-btn' + (b.primary ? '' : ' ghost') + '" data-a="' + b.id + '">' + esc(b.label) + '</button>').join('') + '</div></div>';
      el.classList.add('on', 'dim'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      if (o.stars) el.querySelectorAll('.pz-stars [data-k]').forEach((sp, k) => { if (k < o.stars) { const sv = sp.firstChild; sv.classList.add('pop'); sv.style.animationDelay = (0.25 + k * 0.28) + 's'; setTimeout(() => snd.play('merge', 4 + k * 2), 250 + k * 280); } });
      el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { snd.play('tap'); cb(b.dataset.a); }));
      const f = el.querySelector('.pz-btn:not(.ghost)'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
    },
  };

  /* ------------------------------------------------------------------ profile */
  /* opts: id, name, xp:{base,p}, themes:[{id,name,level,colors:[c,c,c]}], quests:[{id,key,text,goal,xp,kind}],
   *       accent, onTheme(theme), onLevel(level), extra(el) to add a game-specific section to the sheet */
  function profile(opts) {
    injectCss();
    const KEY = 'pz_' + opts.id, xpc = Object.assign({ base: 70, p: 1.5 }, opts.xp || {});
    const themes = opts.themes || [], pool = opts.quests || [];
    const need = n => Math.round(xpc.base * Math.pow(n, xpc.p));
    let S = store.get(KEY, null); if (!S || typeof S !== 'object') S = {};
    S = Object.assign({ xp: 0, days: [], theme: themes[0] ? themes[0].id : '', seenLevel: 1, chest: '', q: { day: '', prog: {}, done: {} }, life: {} }, S);
    const P = { S, cheated: () => !!(G.ArcadeSDK && G.ArcadeSDK.cheated) };
    const save = () => { if (!P.cheated()) store.set(KEY, S); };
    const lvOf = xp => { let l = 1, left = xp; while (left >= need(l) && l < 99) { left -= need(l); l++; } return { level: l, into: left, need: need(l) }; };
    P.level = () => lvOf(S.xp).level; P.info = () => lvOf(S.xp);
    P.themeById = id => themes.find(t => t.id === id) || themes[0];
    P.unlocked = t => (typeof t === 'string' ? P.themeById(t) : t) && P.level() >= (typeof t === 'string' ? P.themeById(t) : t).level;
    P.theme = () => { const t = P.themeById(S.theme); return t && P.unlocked(t) ? t : themes[0]; };
    P.setTheme = id => { const t = P.themeById(id); if (!t || !P.unlocked(t)) return false; S.theme = t.id; save(); apply(); return true; };
    function apply() { const t = P.theme(); if (!t) return; D.documentElement.setAttribute('data-theme', t.id); try { opts.onTheme && opts.onTheme(t); } catch (e) {} }
    /* today's three goals: chosen by date so everyone sees the same three, easiest first */
    function ensureDay() {
      const day = daily.today(); if (S.q.day === day) return;
      const r = mulberry(hashStr(opts.id + '|q|' + day)), bag = pool.slice(), pick = [];
      while (pick.length < Math.min(3, pool.length)) pick.push(bag.splice(Math.floor(r() * bag.length), 1)[0]);
      pick.sort((a, b) => a.xp - b.xp);
      S.q = { day, ids: pick.map(p => p.id), prog: {}, done: {} }; save();
    }
    P.quests = () => { ensureDay(); return S.q.ids.map(id => pool.find(q => q.id === id)).filter(Boolean); };
    P.stamp = () => { const d = daily.today(); if (!S.days.includes(d)) { S.days.push(d); if (S.days.length > 400) S.days.splice(0, S.days.length - 400); save(); refresh(); } };
    P.week = () => daily.week(S.days);
    P.chestReady = () => { const w = P.week(); return w.count >= 5 && S.chest !== w.key; };
    P.claimChest = () => { const w = P.week(); if (!P.chestReady()) return; S.chest = w.key; save(); P.addXp(120, 'weekly chest', true); card({ icon: '🎁', title: 'Weekly chest!', sub: 'You played ' + w.count + ' days this week. +120 XP', confetti: 50 }); refresh(); if (sheet) renderSheet(); };
    P.addXp = (n, why, silent) => {
      if (P.cheated() || !n) return; n = Math.round(n);
      const before = lvOf(S.xp).level; S.xp += n; const after = lvOf(S.xp).level; P.stamp();
      if (!silent) toast('<i>⭐</i><span><b>+' + n + ' XP</b>' + (why ? ' · ' + esc(why) : '') + '</span>');
      if (after > before) levelUp(before, after);
      save(); refresh();
    };
    function levelUp(from, to) {
      const fresh = themes.filter(t => t.level > from && t.level <= to);
      setTimeout(() => card({ icon: '🏅', title: 'Level ' + to + '!', sub: fresh.length ? 'You unlocked a new look:<br><b>' + esc(fresh.map(t => t.name).join(', ')) + '</b>' : 'Keep going: ' + (themes.find(t => t.level > to) ? 'the next look unlocks at level ' + themes.find(t => t.level > to).level + '.' : 'you have every look!'), button: fresh.length ? 'Use ' + fresh[0].name : 'Nice!', button2: fresh.length ? 'Later' : '', confetti: 60, sound: 'unlock',
        onOk: () => { if (fresh.length) P.setTheme(fresh[0].id); } }), 1100);
      try { opts.onLevel && opts.onLevel(to); } catch (e) {}
    }
    /* daily goal progress. kind 'sum' adds, kind 'max' keeps the best value seen today */
    P.count = (key, n) => bump(key, n == null ? 1 : n, false);
    P.max = (key, v) => bump(key, v, true);
    function bump(key, v, isMax) {
      if (P.cheated()) return; ensureDay(); let changed = false;
      P.quests().forEach(q => {
        if (q.key !== key || S.q.done[q.id]) return;
        const cur = S.q.prog[q.id] || 0, nx = isMax ? Math.max(cur, v) : cur + v; if (nx === cur) return;
        S.q.prog[q.id] = Math.min(q.goal, nx); changed = true;
        if (nx >= q.goal) { S.q.done[q.id] = true; setTimeout(() => { toast('<i>🎯</i><span><b>Goal done!</b> ' + esc(q.text.replace('{n}', q.goal)) + ' · +' + q.xp + ' XP</span>'); snd.play('coin'); P.addXp(q.xp, '', true); }, 400); }
      });
      if (changed) { save(); refresh(); if (sheet) renderSheet(); }
    }
    P.life = (k, v) => { if (v === undefined) return S.life[k] || 0; if (!P.cheated()) { S.life[k] = v; save(); } return v; };
    P.lifeAdd = (k, n) => P.life(k, (S.life[k] || 0) + (n == null ? 1 : n));
    P.lifeMax = (k, v) => { if (v > (S.life[k] || 0)) P.life(k, v); return S.life[k] || 0; };

    /* the little "Lv N" button that lives in the game's HUD (call chip() once per place you want one) */
    const chips = [];
    P.chip = (parent) => {
      const el = D.createElement('button'); el.className = 'pz-chip'; el.type = 'button'; el.setAttribute('aria-label', 'Your progress, goals and looks');
      el.innerHTML = '<span class="lv" data-lv="1"></span><span class="txt">Goals</span><span class="dot"></span>';
      el.addEventListener('click', () => { snd.play('tap'); P.open(); });
      chips.push(el); if (parent) parent.appendChild(el); refresh(); return el;
    };
    function refresh() {
      if (!chips.length) return; const li = lvOf(S.xp), open = P.quests().some(q => !S.q.done[q.id]);
      chips.forEach(chipEl => {
        const lv = chipEl.querySelector('.lv'); lv.setAttribute('data-lv', li.level); lv.style.setProperty('--p', Math.round(li.into / li.need * 100));
        chipEl.classList.toggle('has', P.chestReady()); chipEl.querySelector('.txt').textContent = open ? 'Goals' : 'All done';
      });
    }
    /* the progress sheet */
    let sheet = null, lastFocus = null;
    P.open = () => {
      if (sheet) return; lastFocus = D.activeElement; ensureDay(); injectCss();
      sheet = D.createElement('div'); sheet.className = 'pz-sheet-wrap'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Your progress');
      D.body.appendChild(sheet); renderSheet();
      sheet.addEventListener('pointerdown', e => { if (e.target === sheet) P.close(); });
      D.addEventListener('keydown', escClose, true);
      try { opts.onOpen && opts.onOpen(); } catch (e) {}
    };
    function escClose(e) { if (e.key === 'Escape' && sheet) { e.stopPropagation(); P.close(); } }
    P.close = () => { if (!sheet) return; sheet.remove(); sheet = null; D.removeEventListener('keydown', escClose, true); try { lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true }); } catch (e) {} try { opts.onClose && opts.onClose(); } catch (e) {} };
    P.isOpen = () => !!sheet;
    function renderSheet() {
      if (!sheet) return; const li = lvOf(S.xp), w = P.week();
      const qs = P.quests().map(q => {
        const pr = S.q.prog[q.id] || 0, done = !!S.q.done[q.id], pct = Math.round(pr / q.goal * 100);
        return '<div class="pz-q' + (done ? ' done' : '') + '"><div class="t">' + esc(q.text.replace('{n}', q.goal)) + '<div class="bar"><i style="width:' + pct + '%"></i></div><small>' + (done ? 'Done' : pr + ' of ' + q.goal) + '</small></div><div class="x">' + (done ? '✓' : '+' + q.xp + ' XP') + '</div></div>';
      }).join('');
      const th = themes.map(t => {
        const ok = P.unlocked(t), cur = P.theme() && P.theme().id === t.id;
        return '<button class="pz-sw' + (cur ? ' cur' : '') + (ok ? '' : ' lock') + '" data-th="' + esc(t.id) + '" aria-label="' + esc(t.name) + (ok ? (cur ? ', in use' : '') : ', unlocks at level ' + t.level) + '"><div class="sw">' + t.colors.map(c => '<i style="background:' + c + '"></i>').join('') + '</div>' + (ok ? '' : '<div class="lk">🔒 Lv ' + t.level + '</div>') + esc(t.name) + '</button>';
      }).join('');
      sheet.innerHTML = '<div class="pz-sheet"><div class="pz-head"><h2>' + esc(opts.name || 'Your progress') + '</h2><button class="pz-x" aria-label="Close">×</button></div>' +
        '<div class="pz-lvbar"><div class="pz-lvbadge">' + li.level + '</div><div style="flex:1"><div class="pz-bar"><i style="width:' + Math.round(li.into / li.need * 100) + '%"></i></div><div class="pz-xpl">' + li.into + ' / ' + li.need + ' XP to level ' + (li.level + 1) + '</div></div></div>' +
        '<h3>This week</h3><div class="pz-week">' + w.days.map(d => '<div class="pz-day' + (d.on ? ' on' : '') + (d.today ? ' today' : '') + '"><span>' + (d.on ? '★' : '') + '</span>' + d.label + '</div>').join('') + '</div>' +
        '<div class="pz-xpl">' + w.count + ' of 7 days this week · ' + new Set(S.days).size + ' days played in all. Play 5 days for a chest.</div>' + (P.chestReady() ? '<button class="pz-btn pz-chest" data-chest>🎁 Open the weekly chest (+120 XP)</button>' : '') +
        '<h3>Today\'s goals</h3>' + qs + '<div class="pz-extra"></div><h3>Looks</h3><div class="pz-themes">' + th + '</div></div>';
      sheet.querySelector('.pz-x').addEventListener('click', () => { snd.play('tap'); P.close(); });
      sheet.querySelectorAll('[data-th]').forEach(b => b.addEventListener('click', () => { const ok = P.setTheme(b.dataset.th); snd.play(ok ? 'pick' : 'error'); if (!ok) { const t = P.themeById(b.dataset.th); toast('<i>🔒</i><span>Reach <b>level ' + t.level + '</b> to unlock ' + esc(t.name) + '</span>'); } else renderSheet(); }));
      const ch = sheet.querySelector('[data-chest]'); if (ch) ch.addEventListener('click', P.claimChest);
      try { opts.extra && opts.extra(sheet.querySelector('.pz-extra')); } catch (e) {}
      try { sheet.querySelector('.pz-x').focus({ preventScroll: true }); } catch (e) {}
    }
    apply(); ensureDay();
    return P;
  }

  G.PZ = { store, snd, fx, daily, toast, card, profile, ui, cfg, iso, clamp, esc, hashStr, mulberry, RM, injectCss };
})(window);
