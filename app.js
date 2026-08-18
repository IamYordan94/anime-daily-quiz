/* ═══════════════════════════════════════════════════════
   ANIME DAILY — game logic
   daily-seeded quiz · streak · share card · rewarded hints
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ── helpers ─────────────────────────────────────────── */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function amsDateString(d) {
  // Amsterdam wall-clock date, YYYY-MM-DD (quiz flips at NL midnight)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(d);
}

function msUntilAmsterdamMidnight() {
  const now = new Date();
  const amsNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const next = new Date(amsNow);
  next.setHours(24, 0, 0, 0);
  return next - amsNow;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ── daily puzzle selection ──────────────────────────── */

const TIER_RAMP = [1, 2, 3, 4, 5]; // easy → hard

function pickDailyPuzzle(questions, dateStr) {
  const rnd = mulberry32(hashStr('anime-daily:' + dateStr));
  const out = [];
  for (const tier of TIER_RAMP) {
    const pool = questions.filter(q => q.tier === tier);
    if (!pool.length) continue;
    const q = pool[Math.floor(rnd() * pool.length)];
    // shuffle options (track correct answer)
    const order = [0, 1, 2, 3].sort(() => rnd() - 0.5);
    out.push({
      q: q.q,
      hint: q.hint,
      tier: q.tier,
      options: order.map(i => q.options[i]),
      answer: order.indexOf(q.answer),
    });
  }
  return out;
}

/* ── storage ─────────────────────────────────────────── */

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const K = { streak: 'animeDaily.streak', last: 'animeDaily.lastDate', scores: 'animeDaily.scores' };

/* ── telegram ────────────────────────────────────────── */

const TG = window.Telegram && window.Telegram.WebApp;
if (TG) {
  TG.ready();
  TG.expand();
  TG.disableVerticalSwipes();
  TG.setHeaderColor('#1e2028');
  TG.setBackgroundColor('#f6f3ec');
}
function haptic(type) { if (TG && TG.HapticFeedback) TG.HapticFeedback.impactOccurred(type || 'light'); }

/* ── monetag adapter ───────────────────────────────────
   Rewarded ad = user watches ad → we reveal a hint.
   Until the Monetag tag is configured, the reward is granted
   immediately so the game is fully testable.                          */

async function showRewardedAd() {
  const cfg = window.AD_CONFIG || {};
  if (cfg.MONETAG_TAG && cfg.MONETAG_SDK_URL && !window.__monetagLoaded) {
    // load the SDK script Monetag provides for your Telegram Mini App
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = cfg.MONETAG_SDK_URL;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
      window.__monetagLoaded = true;
    }).catch(() => { /* SDK failed → fall through to free hint */ });
  }
  // ── TODO(monetag): wire the exact rewarded call ─────
  // Monetag's TMA SDK (Rewarded Popup / Rewarded Interstitial) exposes
  // an init + show call per the docs shown in the dashboard after you
  // add the app. Once the tag is in place, call it here and resolve
  // true only when the user finished the ad.
  //   e.g.  return await monetagRewarded.show();
  // Until wired: grant the hint (test mode).
  return true;
}

/* ── app state ───────────────────────────────────────── */

let puzzle = [];
let qIndex = 0;
let score = 0;
let answered = false;
let hintUsed = [];
let hintRevealed = false;

const $ = id => document.getElementById(id);

/* ── screens ─────────────────────────────────────────── */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('screen-active'));
  $('screen-' + name).classList.add('screen-active');
}

/* ── render: quiz question ───────────────────────────── */

function renderQuestion() {
  const q = puzzle[qIndex];
  answered = false;
  hintRevealed = hintUsed[qIndex];
  $('chip-progress').textContent = 'Q ' + (qIndex + 1) + '/' + puzzle.length;
  $('chip-score').textContent = '✓ ' + score;
  $('q-tier').textContent = 'TIER ' + q.tier;
  $('q-text').textContent = q.q;
  $('hint-text').hidden = !hintRevealed;
  $('hint-text').textContent = hintRevealed ? '🪄 ' + q.hint : '';
  $('btn-hint').disabled = hintRevealed;

  const box = $('options');
  box.innerHTML = '';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'option';
    b.textContent = opt;
    b.addEventListener('click', () => answer(i, b));
    box.appendChild(b);
  });
}

function answer(i, btnEl) {
  if (answered) return;
  answered = true;
  const q = puzzle[qIndex];
  const correct = i === q.answer;
  if (correct) { score++; haptic('medium'); } else { haptic('heavy'); }

  document.querySelectorAll('.option').forEach((el, idx) => {
    el.classList.add('locked');
    if (idx === q.answer) el.classList.add('correct');
    else if (idx === i) el.classList.add('wrong');
    else el.classList.add('dim');
  });
  $('chip-score').textContent = '✓ ' + score;

  setTimeout(() => {
    qIndex++;
    if (qIndex < puzzle.length) renderQuestion();
    else finish();
  }, correct ? 650 : 1100);
}

/* ── hint (rewarded ad) ──────────────────────────────── */

async function onHint() {
  if (answered || hintRevealed) return;
  const granted = await showRewardedAd();
  if (granted) {
    hintRevealed = true;
    hintUsed[qIndex] = true;
    $('hint-text').hidden = false;
    $('hint-text').textContent = '🪄 ' + puzzle[qIndex].hint;
    $('btn-hint').disabled = true;
    haptic('light');
  }
}

/* ── finish / results ────────────────────────────────── */

function finish() {
  const dateStr = amsDateString(new Date());
  const scores = store.get(K.scores, {});
  const alreadyDone = !!scores[dateStr];
  scores[dateStr] = score;
  store.set(K.scores, scores);

  let streak = store.get(K.streak, 0);
  const last = store.get(K.last, '');
  if (!alreadyDone) {
    if (last === dateStr) { /* same day replay */ }
    else if (last === yesterdayStr(dateStr)) streak += 1;
    else streak = 1;
    store.set(K.streak, streak);
    store.set(K.last, dateStr);
  }

  const total = puzzle.length;
  const grid = Array.from({ length: total }, (_, i) =>
    i < score ? '🟩' : '🟥'
  ).join(' ');

  const lines = [
    score === total ? 'OTAKU SUPREME! All correct.' :
    score >= total - 1 ? 'So close. So painful.' :
    score >= 3 ? 'Solid. But the weeb council is watching.' :
    'The anime gods are disappointed.',
  ];

  $('result-big').textContent = score + '/' + total;
  $('result-grid').textContent = grid;
  $('result-line').textContent = lines[0];
  $('chip-streak-result').textContent = '🔥 streak ' + streak;
  $('chip-streak').textContent = '🔥 streak ' + streak;

  window.__shareText = [
    '🎌 ANIME DAILY — ' + dateStr,
    grid + '  ' + score + '/' + total,
    'Play: ' + (TG ? 't.me/' + (window.AD_CONFIG.BOT_USERNAME || '') : location.origin),
  ].join('\n');

  showScreen('result');
  tickCountdown();
}

function yesterdayStr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function tickCountdown() {
  const ms = msUntilAmsterdamMidnight();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  $('countdown').textContent = 'next puzzle in ' + h + 'h ' + String(m).padStart(2, '0') + 'm';
  setTimeout(tickCountdown, 60000);
}

/* ── home init ───────────────────────────────────────── */

function initHome() {
  const dateStr = amsDateString(new Date());
  $('chip-today').textContent = '📅 ' + dateStr;
  $('chip-streak').textContent = '🔥 streak ' + store.get(K.streak, 0);
  const scores = store.get(K.scores, {});
  $('already-done').hidden = !scores[dateStr];
  $('tg-link').href = 'https://t.me/' + (window.AD_CONFIG.BOT_USERNAME || '');
}

function startQuiz() {
  if (!QUESTIONS.length) return;
  const dateStr = amsDateString(new Date());
  puzzle = pickDailyPuzzle(QUESTIONS, dateStr);
  qIndex = 0; score = 0; answered = false;
  hintUsed = puzzle.map(() => false); hintRevealed = false;
  showScreen('quiz');
  renderQuestion();
}

/* ── copy share card ─────────────────────────────────── */

async function onCopy() {
  const text = window.__shareText || '';
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  $('copy-ok').hidden = false;
  haptic('medium');
  setTimeout(() => { $('copy-ok').hidden = true; }, 2500);
}

/* ── wire it up ──────────────────────────────────────── */

let QUESTIONS = [];

document.addEventListener('DOMContentLoaded', () => {
  fetch('data/questions.json')
    .then(r => r.json())
    .then(data => { QUESTIONS = Array.isArray(data) ? data : []; })
    .catch(() => { QUESTIONS = []; })
    .finally(() => {
      initHome();
      $('btn-start').addEventListener('click', startQuiz);
      $('btn-hint').addEventListener('click', onHint);
      $('btn-copy').addEventListener('click', onCopy);
      $('btn-replay').addEventListener('click', startQuiz);
    });
});
