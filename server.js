import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { Telegraf, Markup } from 'telegraf';

const { BOT_TOKEN, BOT_USERNAME = '', CHANNEL = '', ADMIN_ID = '', PORT = 3000, DATA_DIR = '.' } = process.env;
// Render WEBAPP_URL ni o'zi beradi (RENDER_EXTERNAL_URL)
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL;
if (!BOT_TOKEN || !WEBAPP_URL) { console.error('.env: BOT_TOKEN va WEBAPP_URL kerak'); process.exit(1); }

// O'yin sozlamalari: public/index.html dagi UPG bilan bir xil bo'lsin
const UPG = [{ base: 50, inc: 0.5 }, { base: 400, inc: 3 }, { base: 3000, inc: 15 }, { base: 25000, inc: 80 }];
const CAP = 10800, DAY = 864e5, BONUS = 500, REF_BONUS = 1000;
const income = (l) => l.reduce((s, v, i) => s + v * UPG[i].inc, 0);
const cost = (i, lv) => Math.floor(UPG[i].base * 1.6 ** lv);
const TASKS = [{ id: 'channel', reward: 2000 }, { id: 'friends3', reward: 3000 }, { id: 'level10', reward: 1500 }];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT, coins REAL NOT NULL DEFAULT 100,
  levels TEXT NOT NULL DEFAULT '[0,0,0,0]', updated INTEGER NOT NULL,
  bonusAt INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
  refs INTEGER NOT NULL DEFAULT 0, ref INTEGER)`);
try { db.exec("ALTER TABLE users ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]'"); } catch {}
const get = db.prepare('SELECT * FROM users WHERE id = ?');
const add = db.prepare('INSERT OR IGNORE INTO users (id, name, updated, coins, ref) VALUES (?, ?, ?, ?, ?)');
const save = db.prepare('UPDATE users SET coins=?, levels=?, updated=?, bonusAt=?, streak=?, tasks=? WHERE id=?');
db.exec(`CREATE TABLE IF NOT EXISTS ads (id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER NOT NULL, channel TEXT NOT NULL,
  need INTEGER NOT NULL, price INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ad_claims (ad_id INTEGER, user_id INTEGER, PRIMARY KEY (ad_id, user_id))`);
const getAd = db.prepare('SELECT * FROM ads WHERE id = ?');
const addAd = db.prepare('INSERT INTO ads (owner, channel, need, price, created) VALUES (?, ?, ?, ?, ?)');
const hasClaim = db.prepare('SELECT 1 FROM ad_claims WHERE ad_id = ? AND user_id = ?');
const claimAd = db.prepare('INSERT INTO ad_claims (ad_id, user_id) VALUES (?, ?)');
const bumpAd = db.prepare('UPDATE ads SET done = done + 1, active = CASE WHEN done + 1 >= need THEN 0 ELSE 1 END WHERE id = ?');
const listAds = db.prepare(`SELECT id, channel, need, done, price FROM ads WHERE active = 1 AND owner != ?
  AND id NOT IN (SELECT ad_id FROM ad_claims WHERE user_id = ?) ORDER BY price DESC LIMIT 30`);
const myAds = db.prepare('SELECT id, channel, need, done, price FROM ads WHERE owner = ? ORDER BY id DESC LIMIT 10');
const normChannel = (c) => { const m = String(c || '').trim().match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/); return m ? '@' + m[1] : null; };
let BOT_ID;
const botId = async () => BOT_ID || (BOT_ID = (await bot.telegram.getMe()).id);
const top = db.prepare('SELECT name, coins FROM users ORDER BY coins DESC LIMIT 10');
const rank = db.prepare('SELECT COUNT(*) + 1 AS r FROM users WHERE coins > ?');

function verify(initData) {
  const p = new URLSearchParams(initData);
  const hash = p.get('hash'); if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const a = Buffer.from(crypto.createHmac('sha256', key).update(str).digest('hex')), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

// Oddiy so'rov cheklovi: har foydalanuvchiga 10 soniyada 30 ta
const hits = new Map();
function limited(id) {
  const now = Date.now(), arr = (hits.get(id) || []).filter((t) => now - t < 10000);
  arr.push(now); hits.set(id, arr);
  return arr.length > 30;
}
setInterval(() => hits.clear(), 60000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

app.post('/api/act', async (req, res) => {
  const u = verify(req.body.initData || '');
  if (!u) return res.status(401).json({ error: 'auth' });
  if (limited(u.id)) return res.status(429).json({ error: 'slow' });

  // Kanalga obunani Telegram orqali tekshiramiz (bot kanalda admin bo'lishi kerak)
  let member = false;
  if (req.body.action === 'task' && req.body.id === 'channel' && CHANNEL) {
    try {
      const m = await bot.telegram.getChatMember(CHANNEL, u.id);
      member = ['member', 'administrator', 'creator'].includes(m.status);
    } catch { /* bot kanalda admin emas */ }
  }

  // Reklama: bot kanalda admin ekanini va obunani Telegram orqali tekshiramiz
  let botAdmin = false, adMember = false;
  if (req.body.action === 'ad_add') {
    const ch = normChannel(req.body.channel);
    if (ch) {
      try { botAdmin = (await bot.telegram.getChatMember(ch, await botId())).status === 'administrator'; } catch {}
    }
  }
  if (req.body.action === 'ad_check') {
    const ad = getAd.get(Number(req.body.id));
    if (ad) {
      try {
        const m = await bot.telegram.getChatMember(ad.channel, u.id);
        adMember = ['member', 'administrator', 'creator'].includes(m.status);
      } catch {}
    }
  }

  const now = Date.now();
  add.run(u.id, u.first_name || '', now, 100, null);
  const row = get.get(u.id);
  const levels = JSON.parse(row.levels);
  const tasks = JSON.parse(row.tasks || '[]');
  const offline = Math.min((now - row.updated) / 1000, CAP) * income(levels);
  let coins = row.coins + offline, { bonusAt, streak } = row;
  const { action, i } = req.body;
  let err = null;

  if (action === 'buy' && Number.isInteger(i) && i >= 0 && i < UPG.length) {
    const c = cost(i, levels[i]);
    if (coins >= c) { coins -= c; levels[i]++; }
  } else if (action === 'bonus' && now - bonusAt >= DAY) {
    streak = now - bonusAt < 2 * DAY ? streak + 1 : 1;
    coins += BONUS * Math.min(streak, 7);
    bonusAt = now;
  } else if (action === 'task') {
    const T = TASKS.find((x) => x.id === req.body.id);
    const lv = levels.reduce((a, b) => a + b, 0);
    const ok = T && !tasks.includes(T.id) &&
      (T.id === 'channel' ? member : T.id === 'friends3' ? row.refs >= 3 : lv >= 10);
    if (ok) { coins += T.reward; tasks.push(T.id); }
  } else if (action === 'ad_add') {
    const ch = normChannel(req.body.channel);
    const need = Math.floor(Number(req.body.need)), price = Math.floor(Number(req.body.price));
    if (!ch || !(need >= 5 && need <= 10000) || !(price >= 10 && price <= 5000)) err = 'limits';
    else if (!botAdmin) err = 'not_admin';
    else if (coins < need * price) err = 'funds';
    else { coins -= need * price; addAd.run(u.id, ch, need, price, now); }
  } else if (action === 'ad_check') {
    const ad = getAd.get(Number(req.body.id));
    if (!ad || !ad.active || ad.owner === u.id) err = 'gone';
    else if (hasClaim.get(ad.id, u.id)) err = 'claimed';
    else if (!adMember) err = 'not_member';
    else { coins += ad.price; claimAd.run(ad.id, u.id); bumpAd.run(ad.id); }
  }
  save.run(coins, JSON.stringify(levels), now, bonusAt, streak, JSON.stringify(tasks), u.id);

  const out = { coins, levels, bonusAt, streak, refs: row.refs, me: u.id, bot: BOT_USERNAME, tasks, channel: CHANNEL, err, ads: listAds.all(u.id, u.id), myAds: myAds.all(u.id) };
  if (action === 'load') out.offline = offline;
  if (action === 'top') { out.top = top.all(); out.rank = rank.get(coins).r; }
  res.json(out);
});

app.get('/healthz', (req, res) => res.send('ok'));

const bot = new Telegraf(BOT_TOKEN);
bot.start((ctx) => {
  const ref = Number(String(ctx.payload || '').replace('ref_', ''));
  const id = ctx.from.id;
  if (ref && ref !== id && !get.get(id) && get.get(ref)) {
    add.run(id, ctx.from.first_name || '', Date.now(), 100 + REF_BONUS, ref);
    db.prepare('UPDATE users SET coins = coins + ?, refs = refs + 1 WHERE id = ?').run(REF_BONUS, ref);
  }
  ctx.reply('鉀忥笍 Coin Mine ga xush kelibsiz! Koningizni quring 馃憞',
    Markup.inlineKeyboard([Markup.button.webApp('鉀忥笍 O\'ynash', WEBAPP_URL)]));
});
bot.command('stats', (ctx) => {
  if (!ADMIN_ID || String(ctx.from.id) !== ADMIN_ID) return;
  const r = db.prepare('SELECT COUNT(*) n, SUM(coins) c, SUM(refs) f FROM users').get();
  ctx.reply(`馃懁 Foydalanuvchilar: ${r.n}\n馃獧 Jami coin: ${Math.floor(r.c || 0)}\n馃懃 Referallar: ${r.f || 0}`);
});
bot.catch((e) => console.error('Bot xatosi:', e.message));
// Render'da webhook (deploy paytida ikki nusxa to'qnashmaydi), lokalda polling
if (process.env.RENDER || process.env.USE_WEBHOOK === 'true') {
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 32);
  app.use(await bot.createWebhook({ domain: new URL(WEBAPP_URL).host, path: '/tg-webhook', secret_token: secret }));
  console.log('Webhook rejimi yoqildi');
} else {
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
app.listen(PORT, () => console.log(`Server ishga tushdi, port ${PORT}`));