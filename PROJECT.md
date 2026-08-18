# ANIME DAILY 🎌

A Telegram Mini App: one anime quiz per day, 10 questions (two per difficulty tier, easy → hard).
Built for the Monetag Telegram Mini App monetization pipeline.

**Live:** https://anime-daily-quiz.vercel.app
**Repo:** https://github.com/IamYordan94/anime-daily-quiz
**Local:** `C:\Users\veria\Desktop\anime-daily-quiz`

---

## What it is

- Static web app (no backend): `index.html` + `style.css` + `app.js` + `config.js` + `data/questions.json`
- Deployed on Vercel; Telegram opens it as a Mini App via a bot's menu button
- Daily puzzle is **deterministic** — seeded by the Amsterdam date (`hashStr('anime-daily:' + date)`)
- 150 questions, 5 difficulty tiers, 30 per tier
- Streak + score history in `localStorage` (per device)
- Share card: emoji grid (🟩/🟥) + score, copy to clipboard
- Hints are **rewarded**: 1 hint per question → `showRewardedAd()` in `app.js`
- Hints are currently FREE (test mode) until the Monetag tag is configured in `config.js`

## The money plan (Monetag)

1. Monetag dashboard → **Telegram Mini Apps** → add app (this URL) → get **Ad Tag + SDK snippet**
2. Paste tag + SDK URL into `config.js` (`MONETAG_TAG`, `MONETAG_SDK_URL`)
3. Wire the rewarded call in `showRewardedAd()` per Monetag's TMA SDK docs (TODO comment marks the spot)
4. Revenue = impressions × CPM. Rewarded Popup ≈ $5–6 CPM, Rewarded Interstitial ≈ $2+, In-App Interstitial passive
5. 10 questions/day → up to 10 rewarded hints per user per day
6. Payout: min $5 PayPal, biweekly (4th & 19th)

**Growth loop:** play → share card → friends play → daily streak → hints (ads) → revenue

**Policy (critical):** real users only. No bots, no self-clicks, no paid-to-click, no traffic exchanges.

## TODO / next steps

- [ ] Create bot via BotFather → set menu button to this URL (or paste token for API setup)
- [ ] Add app in Monetag dashboard → wire tag in `config.js` + SDK call in `app.js`
- [ ] Daily reminder via bot (backend webhook needed)
- [ ] Leaderboard (needs backend/DB)
- [ ] Share-to-story (Telegram native, needs a hosted share image)
- [ ] Category packs later (Pokémon, Gaming…) — add `cat` field to questions
- [ ] Cron job: top up question bank (agent-generated)

## Design system

Sticker Pack neo-brutalist: paper `#f6f3ec`, ink `#141414`, sakura pink `#ff5fa2`, sticker yellow `#ffd23f`,
2.5px borders, 12px radius, 4–6px hard shadows, JetBrains Mono labels / Bahnschrift body.
