/* ═══════════════════════════════════════════════════════
   ANIME DAILY — game logic
   daily-seeded quiz · speed bonus · bonus round · badges
   streaks · share card · rewarded hints · sfx
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

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── daily puzzle selection ──────────────────────────── */

const TIER_RAMP = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]; // two per tier, easy → hard
const BONUS_TIERS = [2, 3, 4];
const MAIN_TIME = 12;   // seconds per question (main round)
const BONUS_TIME = 7;   // seconds per question (bonus round)

function makePuzzle(q, order) {
  return {
    q: q.q, hint: q.hint, tier: q.tier,
    options: order.map(i => q.options[i]),
    answer: order.indexOf(q.answer),
  };
}

function pickDailyPuzzle(questions, dateStr) {
  const rnd = mulberry32(hashStr('anime-daily:' + dateStr));
  return TIER_RAMP.map(tier => {
    const pool = questions.filter(q => q.tier === tier);
    const q = pool[Math.floor(rnd() * pool.length)];
    return makePuzzle(q, shuffle([0, 1, 2, 3], rnd));
  });
}

function pickBonus(questions, dateStr) {
  const rnd = mulberry32(hashStr('anime-daily-bonus:' + dateStr));
  const pool = shuffle(questions.filter(q => BONUS_TIERS.includes(q.tier)), rnd);
  return pool.slice(0, 3).map(q => makePuzzle(q, shuffle([0, 1, 2, 3], rnd)));
}

/* ── storage ─────────────────────────────────────────── */

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const K = {
  streak: 'animeDaily.streak', last: 'animeDaily.lastDate',
  scores: 'animeDaily.scores', points: 'animeDaily.points',
  badges: 'animeDaily.badges', sound: 'animeDaily.sound',
};

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

/* ── sound (WebAudio synth, lazy init) ───────────────── */

let SOUND_ON = store.get(K.sound, true);
let audioCtx = null;
function ac() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (typeof Ctor === 'undefined') return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}
function tone(freq, dur, type, gain, when) {
  const ctx = ac();
  if (!ctx) return;
  const t0 = ctx.currentTime + (when || 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain || 0.08, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function sfx(kind) {
  if (!SOUND_ON) return;
  try {
    if (kind === 'correct') { tone(660, 0.09); tone(880, 0.12, 'square', 0.08, 0.09); }
    else if (kind === 'wrong') { tone(160, 0.22, 'sawtooth', 0.1); }
    else if (kind === 'click') { tone(440, 0.05, 'square', 0.05); }
    else if (kind === 'hint') { tone(520, 0.08); tone(700, 0.1, 'square', 0.07, 0.08); }
    else if (kind === 'bonus') { tone(523, 0.08); tone(659, 0.08, 'square', 0.07, 0.08); tone(784, 0.14, 'square', 0.08, 0.16); }
    else if (kind === 'badge') { tone(392, 0.1); tone(523, 0.1, 'square', 0.08, 0.1); tone(659, 0.2, 'square', 0.09, 0.2); }
  } catch {}
}

/* ── monetag adapter ───────────────────────────────────
   Rewarded ad = user watches ad → we reveal a hint.
   Until the Monetag tag is configured, the reward is granted
   immediately so the game is fully testable.                          */

async function showRewardedAd() {
  const cfg = window.AD_CONFIG || {};
  if (cfg.MONETAG_TAG && cfg.MONETAG_SDK_URL && !window.__monetagLoaded) {
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
  return true;
}

/* ── badges ──────────────────────────────────────────── */

const BADGES = [
  { id: 'first',    icon: '🎌', name: 'FIRST QUIZ',   cond: s => s.daysPlayed >= 1 },
  { id: 'streak3',  icon: '🔥', name: '3-DAY STREAK', cond: s => s.streak >= 3 },
  { id: 'streak7',  icon: '⚡', name: '7-DAY STREAK', cond: s => s.streak >= 7 },
  { id: 'perfect',  icon: '👑', name: 'PERFECT 10',   cond: s => s.perfect },
  { id: 'speed',    icon: '🚀', name: 'SPEED DEMON',  cond: s => s.speedBonus >= 10 },
  { id: 'days5',    icon: '🗓️', name: '5 DAYS PLAYED', cond: s => s.daysPlayed >= 5 },
];

function earnedBadges() { return store.get(K.badges, []); }

function checkBadges(stats) {
  const have = new Set(earnedBadges());
  const fresh = [];
  for (const b of BADGES) {
    if (!have.has(b.id) && b.cond(stats)) { have.add(b.id); fresh.push(b); }
  }
  store.set(K.badges, [...have]);
  return fresh;
}

/* ── app state ───────────────────────────────────────── */

let mainPuzzle = [], bonusPuzzle = [];
let mode = 'main';        // 'main' | 'bonus'
let qIndex = 0;
let score = 0;            // correct answers (main round)
let speedBonus = 0;
let bonusScore = 0;
let answered = false;
let hintUsed = [];
let hintRevealed = false;
let timerId = 0;
let timeLeft = 0;
let timeLimit = MAIN_TIME;

const $ = id => document.getElementById(id);

/* ── screens ─────────────────────────────────────────── */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('screen-active'));
  $('screen-' + name).classList.add('screen-active');
}

function currentPuzzle() { return mode === 'main' ? mainPuzzle : bonusPuzzle; }

/* ── timer ───────────────────────────────────────────── */

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = 0; } }

function startTimer() {
  stopTimer();
  timeLeft = timeLimit;
  paintTimer();
  timerId = setInterval(() => {
    timeLeft--;
    paintTimer();
    if (timeLeft <= 0) onTimeout();
  }, 1000);
}

function paintTimer() {
  const bar = $('timer-bar');
  const pct = Math.max(0, (timeLeft / timeLimit) * 100);
  bar.style.width = pct + '%';
  bar.classList.toggle('low', pct <= 30);
  $('timer-label').textContent = timeLeft + 's';
}

function onTimeout() {
  if (answered) return;
  answered = true;
  stopTimer();
  const q = currentPuzzle()[qIndex];
  document.querySelectorAll('.option').forEach((el, idx) => {
    el.classList.add('locked');
    if (idx === q.answer) el.classList.add('correct');
    else el.classList.add('dim');
  });
  sfx('wrong'); haptic('heavy');
  setTimeout(advance, 1100);
}

/* ── render: quiz question ───────────────────────────── */

function renderQuestion() {
  const q = currentPuzzle()[qIndex];
  answered = false;
  hintRevealed = hintUsed[qIndex];
  const isBonus = mode === 'bonus';
  timeLimit = isBonus ? BONUS_TIME : MAIN_TIME;

  $('chip-progress').textContent = (isBonus ? 'BONUS ' : 'Q ') + (qIndex + 1) + '/' + currentPuzzle().length;
  $('chip-mode').textContent = isBonus ? '⚡ BONUS' : '🎌 ROUND 1';
  $('chip-score').textContent = '✓ ' + score + (speedBonus ? ' +' + speedBonus + '⚡' : '');
  $('q-tier').textContent = 'TIER ' + q.tier + (isBonus ? ' · ×2 POINTS' : ' · SPEED = BONUS ⚡');
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
    b.addEventListener('click', () => { sfx('click'); answer(i, b); });
    box.appendChild(b);
  });

  startTimer();
}

function speedPoints() {
  // remaining time fractions: fast = +2, ok = +1, slow = 0
  const f = timeLeft / timeLimit;
  return f >= 0.75 ? 2 : f >= 0.4 ? 1 : 0;
}

function answer(i, btnEl) {
  if (answered) return;
  answered = true;
  stopTimer();
  const q = currentPuzzle()[qIndex];
  const correct = i === q.answer;

  if (correct) {
    if (mode === 'main') {
      score++;
      speedBonus += speedPoints();
    } else {
      bonusScore += 2;
    }
    sfx('correct'); haptic('medium');
  } else {
    sfx('wrong'); haptic('heavy');
  }

  document.querySelectorAll('.option').forEach((el, idx) => {
    el.classList.add('locked');
    if (idx === q.answer) el.classList.add('correct');
    else if (idx === i) el.classList.add('wrong');
    else el.classList.add('dim');
  });
  $('chip-score').textContent = '✓ ' + score + (speedBonus ? ' +' + speedBonus + '⚡' : '');

  setTimeout(advance, correct ? 650 : 1100);
}

function advance() {
  qIndex++;
  if (qIndex < currentPuzzle().length) { renderQuestion(); return; }
  if (mode === 'main') {
    mode = 'bonus';
    qIndex = 0;
    hintUsed = bonusPuzzle.map(() => false);
    hintRevealed = false;
    $('bonus-banner').hidden = false;
    sfx('bonus');
    setTimeout(() => { $('bonus-banner').hidden = true; renderQuestion(); }, 1200);
  } else {
    finish();
  }
}

/* ── hint (rewarded ad) ──────────────────────────────── */

async function onHint() {
  if (answered || hintRevealed) return;
  const granted = await showRewardedAd();
  if (granted) {
    hintRevealed = true;
    hintUsed[qIndex] = true;
    $('hint-text').hidden = false;
    $('hint-text').textContent = '🪄 ' + currentPuzzle()[qIndex].hint;
    $('btn-hint').disabled = true;
    sfx('hint'); haptic('light');
  }
}

/* ── finish / results ────────────────────────────────── */

function finish() {
  const dateStr = amsDateString(new Date());
  const scores = store.get(K.scores, {});
  const points = store.get(K.points, {});
  const alreadyDone = !!scores[dateStr];
  scores[dateStr] = score;
  points[dateStr] = score + speedBonus + bonusScore;
  store.set(K.scores, scores);
  store.set(K.points, points);

  let streak = store.get(K.streak, 0);
  const last = store.get(K.last, '');
  if (!alreadyDone) {
    streak = last === yesterdayStr(dateStr) ? streak + 1 : 1;
    store.set(K.streak, streak);
    store.set(K.last, dateStr);
  }

  const total = score + speedBonus + bonusScore;
  const grid = Array.from({ length: mainPuzzle.length }, (_, i) =>
    i < score ? '🟩' : '🟥'
  ).join(' ');

  const verdict =
    score === mainPuzzle.length ? 'OTAKU SUPREME! All correct.' :
    score >= mainPuzzle.length - 2 ? 'So close. So painful.' :
    score >= Math.ceil(mainPuzzle.length / 2) ? 'Solid. But the weeb council is watching.' :
    'The anime gods are disappointed.';

  const breakdown = [
    score + '/' + mainPuzzle.length + ' correct',
    speedBonus ? '+' + speedBonus + '⚡ speed' : '',
    bonusScore ? '+' + bonusScore + '🔥 bonus' : '',
  ].filter(Boolean).join(' · ');

  $('result-big').textContent = total + ' pts';
  $('result-grid').textContent = grid;
  $('result-line').textContent = verdict;
  $('result-breakdown').textContent = breakdown;
  $('chip-streak-result').textContent = '🔥 streak ' + streak;
  $('chip-streak').textContent = '🔥 streak ' + streak;

  // badges
  const fresh = checkBadges({
    daysPlayed: Object.keys(scores).length,
    streak,
    perfect: score === mainPuzzle.length,
    speedBonus,
  });
  if (fresh.length) {
    $('result-badges').textContent = 'NEW BADGE: ' + fresh.map(b => b.icon + ' ' + b.name).join(' · ');
    sfx('badge');
  } else {
    $('result-badges').textContent = '';
  }
  renderBadges();

  const extra = (speedBonus || bonusScore) ? '\n' + breakdown + ' = ' + total + ' pts' : '';
  window.__shareText = [
    '🎌 ANIME DAILY — ' + dateStr,
    grid + '  ' + score + '/' + mainPuzzle.length + extra,
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

/* ── badges row (home) ───────────────────────────────── */

function renderBadges() {
  const have = new Set(earnedBadges());
  const row = $('badges-row');
  row.innerHTML = '';
  for (const b of BADGES) {
    const chip = document.createElement('span');
    chip.className = 'badge-chip' + (have.has(b.id) ? '' : ' locked');
    chip.title = b.name;
    chip.textContent = have.has(b.id) ? b.icon + ' ' + b.name : '❓ ' + b.name;
    row.appendChild(chip);
  }
}

/* ── home init ───────────────────────────────────────── */

function initHome() {
  const dateStr = amsDateString(new Date());
  $('chip-today').textContent = '📅 ' + dateStr;
  $('chip-streak').textContent = '🔥 streak ' + store.get(K.streak, 0);
  $('already-done').hidden = !store.get(K.scores, {})[dateStr];
  $('tg-link').href = 'https://t.me/' + (window.AD_CONFIG.BOT_USERNAME || '');
  $('btn-sound').textContent = SOUND_ON ? '🔊' : '🔇';
  renderBadges();
}

function toggleSound() {
  SOUND_ON = !SOUND_ON;
  store.set(K.sound, SOUND_ON);
  $('btn-sound').textContent = SOUND_ON ? '🔊' : '🔇';
  if (SOUND_ON) sfx('click');
}

/* ── start ───────────────────────────────────────────── */

let QUESTIONS = [];

function startQuiz() {
  if (!QUESTIONS.length) return;
  const dateStr = amsDateString(new Date());
  mainPuzzle = pickDailyPuzzle(QUESTIONS, dateStr);
  bonusPuzzle = pickBonus(QUESTIONS, dateStr);
  mode = 'main'; qIndex = 0;
  score = 0; speedBonus = 0; bonusScore = 0; answered = false;
  hintUsed = mainPuzzle.map(() => false); hintRevealed = false;
  $('bonus-banner').hidden = true;
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
      $('btn-sound').addEventListener('click', toggleSound);
    });
});
