import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { Telegraf, Markup } from 'telegraf';

const { BOT_TOKEN, CHANNEL = '', ADMIN_ID = '', PORT = 3000, DATABASE_URL } = process.env;
const BOT_USERNAME = (process.env.BOT_USERNAME || '').trim().replace(/^@/, '');   // @ belgisi bo'lsa ham olib tashlanadi
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL; // Render o'zi beradi
if (!BOT_TOKEN || !WEBAPP_URL || !DATABASE_URL) {
  console.error('.env: BOT_TOKEN, DATABASE_URL va WEBAPP_URL kerak');
  process.exit(1);
}

// Tanga turlari (public/index.html dagi SK bilan bir xil): narx (olmos), x click, kunlik energiya limiti
const SKINS = [
  { cost: 0, mult: 1, cap: 500 }, { cost: 199, mult: 2, cap: 500 }, { cost: 199, mult: 2, cap: 500 },
  { cost: 499, mult: 3, cap: 800 }, { cost: 899, mult: 3, cap: 800 }, { cost: 899, mult: 3, cap: 800 },
  { cost: 1299, mult: 4, cap: 1000 }, { cost: 1599, mult: 4, cap: 1000 }, { cost: 1999, mult: 5, cap: 1200 },
];
const DAY = 864e5, BONUS = 500, REF_BONUS = 1000;
const REFILL = 20;           // energiyani to'ldirish = 20 olmos
const AD_COST = 2;           // reklama beruvchi: 1 obunachi = 2 olmos
const P2P_FEE = Math.min(50, Math.max(0, Number(process.env.P2P_FEE || 0)));   // P2P bozor komissiyasi (foiz), standart 0
const AD_REWARD = 1;         // obunachi oladi: 1 olmos
const TASKS = [{ id: 'channel', reward: 2000 }, { id: 'friends3', reward: 3000 }, { id: 'level10', reward: 1500 }];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STARS_COIN = 1000, STARS_DIA = 20;   // 1 Stars = 1000 coin yoki 20 olmos
// Boost xizmatlari (public/index.html dagi SV bilan bir xil): p = bitta paket narxi (olmos)
const SERVICES = {   // p = bitta paket narxi (olmos), q = paket hajmi; buyurtma miqdori q ning ko'paytmasi bo'ladi
  ig_views: { p: 10, q: 1000, label: "Instagram ko'rishlar" }, ig_subs: { p: 20, q: 50, label: 'Instagram obunachi' }, ig_likes: { p: 10, q: 50, label: 'Instagram like' },
  tg_views: { p: 5, q: 1000, label: "Telegram ko'rishlar" }, tg_react: { p: 1, q: 10, label: 'Telegram reaksiya' }, tg_subs: { p: 10, q: 50, label: 'Telegram obunachi' },
  yt_subs: { p: 100, q: 1000, label: 'YouTube obunachi' }, yt_likes: { p: 1, q: 10, label: 'YouTube like' }, yt_views: { p: 10, q: 1000, label: "YouTube ko'rishlar" },
  pubg_uc: { p: 500, q: 60, unit: 'UC', label: 'PUBG Mobile', soon: true },   // hozircha Coming soon
};

pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  max: 5,
});
await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY, name TEXT, coins BIGINT NOT NULL DEFAULT 100, diamonds BIGINT NOT NULL DEFAULT 100,
  skins TEXT NOT NULL DEFAULT '[0]', skin INT NOT NULL DEFAULT 0, taps INT NOT NULL DEFAULT 0, tapday INT NOT NULL DEFAULT 0,
  bonus_at BIGINT NOT NULL DEFAULT 0, streak INT NOT NULL DEFAULT 0, refs INT NOT NULL DEFAULT 0, ref BIGINT,
  tasks TEXT NOT NULL DEFAULT '[]', code TEXT UNIQUE, updated BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ads (
  id SERIAL PRIMARY KEY, owner BIGINT NOT NULL, channel TEXT NOT NULL, need INT NOT NULL, price INT NOT NULL,
  done INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE, created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS ad_claims (ad_id INT, user_id BIGINT, PRIMARY KEY (ad_id, user_id));
CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY, reward BIGINT NOT NULL, max INT NOT NULL, used INT NOT NULL DEFAULT 0, created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS promo_uses (code TEXT, user_id BIGINT, PRIMARY KEY (code, user_id));
CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, svc TEXT NOT NULL, count INT NOT NULL, target TEXT NOT NULL,
  total INT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id BIGINT NOT NULL, kind TEXT NOT NULL, stars INT NOT NULL, created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS codes_used (code TEXT PRIMARY KEY);   -- berilgan yoki tanlangan har bir kod bir marta ishlatiladi
ALTER TABLE users ADD COLUMN IF NOT EXISTS code_locked BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS auctions (id SERIAL PRIMARY KEY, title TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', image BYTEA, mime TEXT,
  status TEXT NOT NULL DEFAULT 'active', winner_name TEXT, win_amount BIGINT, created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS bids (id SERIAL PRIMARY KEY, auction_id INT NOT NULL, user_id BIGINT NOT NULL, name TEXT, amount BIGINT NOT NULL, created BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS bids_auction ON bids (auction_id, amount DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stars_bal BIGINT NOT NULL DEFAULT 0;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS ends_at BIGINT;
ALTER TABLE p2p_offers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'diamond';
ALTER TABLE promos ADD COLUMN IF NOT EXISTS msg_id BIGINT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS username TEXT;
CREATE TABLE IF NOT EXISTS p2p_offers (id SERIAL PRIMARY KEY, seller BIGINT NOT NULL, seller_name TEXT, diamonds INT NOT NULL, stars INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', buyer BIGINT, reserved_by BIGINT, reserved_until BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL, sold_at BIGINT);
CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, amount INT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'new', created BIGINT NOT NULL);
INSERT INTO codes_used (code) SELECT code FROM users WHERE code IS NOT NULL ON CONFLICT DO NOTHING;
`);

const Q = async (c, sql, p = []) => (await c.query(sql, p)).rows;
const isExpired = async (c, id, now) => {
  const r = (await Q(c, 'SELECT ends_at FROM auctions WHERE id=$1', [id]))[0];
  return Boolean(r && r.ends_at && Number(r.ends_at) <= now);
};
const norm = (c) => { const m = String(c || '').trim().match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/); return m ? '@' + m[1] : null; };
const isMember = async (ch, id) => ['member', 'administrator', 'creator'].includes((await bot.telegram.getChatMember(ch, id)).status);
let BOT_ID;
const botId = async () => BOT_ID || (BOT_ID = (await bot.telegram.getMe()).id);
async function genCode(c) {
  for (;;) {
    let k = '';
    for (let j = 0; j < 5; j++) k += ALPHA[crypto.randomInt(ALPHA.length)];
    if (!(await Q(c, 'SELECT 1 FROM codes_used WHERE code=$1', [k])).length) return k;
  }
}

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

// So'rov cheklovi: har foydalanuvchiga 10 soniyada 30 ta
const hits = new Map();
function limited(id) {
  const now = Date.now(), arr = (hits.get(id) || []).filter((t) => now - t < 10000);
  arr.push(now); hits.set(id, arr);
  return arr.length > 30;
}
setInterval(() => hits.clear(), 60000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));   // auksion rasmi uchun (rasm 600 KB gacha)
app.use(express.static('public'));
app.get('/healthz', (req, res) => res.send('ok'));
// Auksion rasmlari bazadan beriladi (brauzer keshlaydi)
app.get('/img/:id', async (req, res) => {
  try {
    const r = (await pool.query('SELECT image, mime FROM auctions WHERE id=$1', [Number(req.params.id) || 0])).rows[0];
    if (!r || !r.image) return res.status(404).end();
    res.set('Content-Type', r.mime || 'image/jpeg').set('Cache-Control', 'public, max-age=86400').send(r.image);
  } catch { res.status(500).end(); }
});

app.post('/api/act', async (req, res) => {
  const b = req.body || {};
  const u = verify(b.initData || '');
  if (!u) return res.status(401).json({ error: 'auth' });
  if (limited(u.id)) return res.status(429).json({ error: 'slow' });
  const action = b.action;

  // Telegram tekshiruvlari (bot kanalda admin ekani, obuna) tranzaksiyadan oldin
  let member = false, botAdmin = false, adMember = false;
  try {
    if (action === 'task' && b.id === 'channel' && CHANNEL) member = await isMember(CHANNEL, u.id);
    if (action === 'ad_add') {
      const ch = norm(b.channel);
      if (ch) botAdmin = (await bot.telegram.getChatMember(ch, await botId())).status === 'administrator';
    }
    if (action === 'ad_check') {
      const ad = (await pool.query('SELECT channel FROM ads WHERE id=$1', [Number(b.id) || 0])).rows[0];
      if (ad) adMember = await isMember(ad.channel, u.id);
    }
  } catch { /* bot kanalda admin emas yoki kanal topilmadi */ }

  // Telegram Stars: to'lov havolasini yaratamiz (balans to'lov tasdiqlangach bot orqali qo'shiladi)
  let invoice = null, payErr = null;
  if (action === 'buy_stars') {
    const kind = b.kind === 'diamond' ? 'diamond' : 'coin', stars = Math.floor(Number(b.stars));
    if (!(stars >= 1 && stars <= 2500)) payErr = 'limits';
    else {
      const what = kind === 'coin' ? `${stars * STARS_COIN} coin` : `${stars * STARS_DIA} olmos`;
      try {
        invoice = await bot.telegram.createInvoiceLink({
          title: what, description: `${what} sotib olish`, payload: `${kind}:${u.id}`,
          provider_token: '', currency: 'XTR', prices: [{ label: kind === 'coin' ? 'Coin' : 'Olmos', amount: stars }],
        });
      } catch (e) { console.error('invoice xatosi:', e.message); payErr = 'pay_fail'; }
    }
  }

  if (['auctions', 'auction', 'bid'].includes(action)) await sweepAuctions();   // muddati tugagan auksionlarni yakunlaymiz

  // P2P: xaridor uchun Stars to'lov havolasi (olmos to'lov tasdiqlangach o'tkaziladi)
  if (action === 'p2p_buy') {
    const o = (await pool.query('SELECT id, seller, diamonds, stars, status, kind FROM p2p_offers WHERE id=$1', [Number(b.id) || 0])).rows[0];
    if (!o || o.status !== 'active') payErr = 'p2p_gone';
    else if (Number(o.seller) === u.id) payErr = 'p2p_own';
    else {
      try {
        invoice = await bot.telegram.createInvoiceLink({
          title: `${o.diamonds} ${o.kind === 'coin' ? 'coin' : 'olmos'}`, description: `P2P bozor: ${o.diamonds} ${o.kind === 'coin' ? 'coin' : 'olmos'} uchun ${o.stars} Stars`, payload: `p2p:${o.id}:${u.id}`,
          provider_token: '', currency: 'XTR', prices: [{ label: 'Olmos', amount: o.stars }],
        });
      } catch (e) { console.error('p2p invoice xatosi:', e.message); payErr = 'pay_fail'; }
    }
  }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const now = Date.now(), day = Math.floor(now / DAY);
    await c.query('INSERT INTO users (id, name, updated) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [u.id, u.first_name || '', now]);
    const row = (await Q(c, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [u.id]))[0];
    let { coins, diamonds, skin, taps, streak } = row;
    let starsBal = row.stars_bal;
    let bonusAt = row.bonus_at, myCode = row.code, codeLocked = row.code_locked;
    const skins = JSON.parse(row.skins), tasks = JSON.parse(row.tasks);
    const isAdmin = Boolean(ADMIN_ID) && String(u.id) === String(ADMIN_ID);
    if (row.tapday !== day) taps = 0;               // kunlik limit har kuni yangilanadi (UTC)
    if (!myCode) {          // birinchi kirishda tasodifiy kod beriladi
      myCode = await genCode(c);
      await c.query('INSERT INTO codes_used (code) VALUES ($1)', [myCode]);
    }
    let err = null, notify = null, adminMsg = null;
    const notes = [];
    let adminWd = null, promoPost = null, promoTouch = null, promoDel = null;
    const winners = [];
    const S = SKINS[skin];

    if (action === 'tap') {
      // x necha bo'lsa, energiya ham shuncha kamayadi
      const n = Math.max(0, Math.min(Math.floor(Number(b.n)) || 0, Math.floor((S.cap - taps) / S.mult), 200));
      coins += n * S.mult; taps += n * S.mult;
    } else if (action === 'buy') {
      const k = Number(b.id);
      if (!Number.isInteger(k) || k < 1 || k >= SKINS.length || skins.includes(k)) err = 'gone';
      else if (!skins.includes(k - 1)) err = 'locked';        // oldingi tanga olinmasa, keyingisi yopiq
      else if (diamonds < SKINS[k].cost) err = 'diamonds';
      else { diamonds -= SKINS[k].cost; skins.push(k); skin = k; }
    } else if (action === 'select') {
      const k = Number(b.id);
      if (skins.includes(k)) skin = k; else err = 'locked';
    } else if (action === 'refill') {
      if (diamonds < REFILL) err = 'diamonds'; else { diamonds -= REFILL; taps = 0; }
    } else if (action === 'bonus' && now - bonusAt >= DAY) {
      streak = now - bonusAt < 2 * DAY ? streak + 1 : 1;
      coins += BONUS * Math.min(streak, 7);
      bonusAt = now;
    } else if (action === 'task') {
      const T = TASKS.find((x) => x.id === b.id);
      const ok = T && !tasks.includes(T.id) &&
        (T.id === 'channel' ? member : T.id === 'friends3' ? row.refs >= 3 : skins.length >= 3);
      if (ok) { coins += T.reward; tasks.push(T.id); }
    } else if (action === 'ad_add') {
      const ch = norm(b.channel), need = Math.floor(Number(b.need));
      if (!ch || !(need >= 5 && need <= 10000)) err = 'limits';
      else if (!botAdmin) err = 'not_admin';
      else if (diamonds < need * AD_COST) err = 'diamonds';
      else {
        diamonds -= need * AD_COST;
        await c.query('INSERT INTO ads (owner, channel, need, price, created) VALUES ($1,$2,$3,$4,$5)', [u.id, ch, need, AD_REWARD, now]);
      }
    } else if (action === 'ad_check') {
      const ad = (await Q(c, 'SELECT * FROM ads WHERE id=$1 FOR UPDATE', [Number(b.id) || 0]))[0];
      if (!ad || !ad.active || Number(ad.owner) === u.id) err = 'gone';
      else if ((await Q(c, 'SELECT 1 FROM ad_claims WHERE ad_id=$1 AND user_id=$2', [ad.id, u.id])).length) err = 'claimed';
      else if (!adMember) err = 'not_member';
      else {
        diamonds += ad.price;
        await c.query('INSERT INTO ad_claims (ad_id, user_id) VALUES ($1,$2)', [ad.id, u.id]);
        await c.query('UPDATE ads SET done = done + 1, active = (done + 1 < need) WHERE id=$1', [ad.id]);
      }
    } else if (action === 'code_set') {
      const k = String(b.code || '').toUpperCase();
      if (codeLocked) err = 'code_locked';                       // faqat 1 marta o'zgartiriladi
      else if (!/^[A-Z0-9]{5}$/.test(k)) err = 'code_bad';
      else if (k === myCode) err = 'code_same';
      else if ((await Q(c, 'SELECT 1 FROM codes_used WHERE code=$1', [k])).length) err = 'code_taken';   // boshqa hech kim ishlata olmaydi
      else {
        myCode = k; codeLocked = true;
        await c.query('INSERT INTO codes_used (code) VALUES ($1)', [k]);   // eski kod ham boshqalarga berilmaydi
      }
    } else if (action === 'send') {
      const k = String(b.to || '').trim().toUpperCase(), amt = Math.floor(Number(b.amount));
      const rec = /^[A-Z0-9]{5}$/.test(k) ? (await Q(c, 'SELECT id FROM users WHERE code=$1', [k]))[0] : null;
      if (!rec) err = 'send_none';
      else if (Number(rec.id) === u.id) err = 'send_self';
      else if (!(amt >= 10)) err = 'send_min';
      else if (coins < amt) err = 'funds';
      else {
        coins -= amt;
        await c.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [amt, rec.id]);
        notify = [rec.id, `Sizga ${amt} coin yuborildi (kod: ${myCode}).`];
      }
    } else if (action === 'promo') {
      const k = String(b.code || '').trim().toUpperCase();
      const pr = (await Q(c, 'SELECT * FROM promos WHERE code=$1 FOR UPDATE', [k]))[0];
      if (!pr) err = 'promo_none';
      else if ((await Q(c, 'SELECT 1 FROM promo_uses WHERE code=$1 AND user_id=$2', [k, u.id])).length) err = 'promo_used';
      else if (pr.max > 0 && pr.used >= pr.max) err = 'promo_end';   // max = 0 bo'lsa cheksiz
      else {
        coins += pr.reward;
        await c.query('INSERT INTO promo_uses (code, user_id) VALUES ($1,$2)', [k, u.id]);
        await c.query('UPDATE promos SET used = used + 1 WHERE code=$1', [k]);
        promoTouch = k;
      }
    } else if (action === 'p2p_create') {
      // Olmos yoki coin darhol yechiladi (ushlab turiladi); sotilsa xaridorga o'tadi, bekor qilinsa qaytadi
      const kind = b.kind === 'coin' ? 'coin' : 'diamond', qty = Math.floor(Number(b.qty)), st = Math.floor(Number(b.stars));
      const min = kind === 'coin' ? 1000 : 10, have = kind === 'coin' ? coins : diamonds;
      if (!(qty >= min && qty <= 1e9) || !(st >= 1 && st <= 5000)) err = 'p2p_bad';
      else if (have < qty) err = kind === 'coin' ? 'funds' : 'diamonds';
      else if (Number((await Q(c, "SELECT COUNT(*) AS n FROM p2p_offers WHERE seller=$1 AND status='active'", [u.id]))[0].n) >= 5) err = 'p2p_many';
      else {
        if (kind === 'coin') coins -= qty; else diamonds -= qty;
        await c.query('INSERT INTO p2p_offers (seller, seller_name, diamonds, stars, kind, created) VALUES ($1,$2,$3,$4,$5,$6)', [u.id, u.first_name || 'Foydalanuvchi', qty, st, kind, now]);
      }
    } else if (action === 'p2p_cancel') {
      const o = (await Q(c, 'SELECT id, seller, diamonds, status, kind, reserved_by, reserved_until FROM p2p_offers WHERE id=$1 FOR UPDATE', [Number(b.id) || 0]))[0];
      if (!o || Number(o.seller) !== u.id || o.status !== 'active') err = 'p2p_gone';
      else if (o.reserved_by && Number(o.reserved_until) > now) err = 'p2p_busy';      // xaridor hozir to'layapti
      else { await c.query("UPDATE p2p_offers SET status='cancelled' WHERE id=$1", [o.id]); if (o.kind === 'coin') coins += o.diamonds; else diamonds += o.diamonds; }
    } else if (action === 'stars_withdraw') {
      const amt = Math.floor(Number(b.amount)), note = String(b.note || '').trim();
      if (!(amt >= 50)) err = 'wd_min';
      else if (amt > starsBal) err = 'wd_funds';
      else if (!/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(note) && !/^\d{5,15}$/.test(note)) err = 'wd_note';   // faqat Telegram username yoki ID
      else {
        starsBal -= amt;
        const wid = (await Q(c, 'INSERT INTO withdrawals (user_id, amount, note, created) VALUES ($1,$2,$3,$4) RETURNING id', [u.id, amt, note, now]))[0].id;
        adminWd = { wid, text: `Stars yechish so'rovi #${wid}\nFoydalanuvchi: ${u.first_name || ''} (${u.id})\nMiqdor: ${amt} Stars\nTelegram: ${note}` };
      }
    } else if (action === 'bid') {
      // Tikilgan coin ushlab turiladi; ustidan oshib ketilsa, avvalgi yetakchiga qaytariladi
      const id = Number(b.id) || 0, amt = Math.floor(Number(b.amount));
      const au = (await Q(c, 'SELECT id, title, status FROM auctions WHERE id=$1 FOR UPDATE', [id]))[0];
      if (!au || au.status !== 'active' || await isExpired(c, id, now)) err = 'auction_gone';
      else {
        const top = (await Q(c, 'SELECT user_id, amount FROM bids WHERE auction_id=$1 ORDER BY amount DESC LIMIT 1', [id]))[0];
        const topAmt = top ? Number(top.amount) : 0, mine = Boolean(top) && Number(top.user_id) === u.id;
        if (!(amt >= 1 && amt <= 1e12) || amt <= topAmt) err = 'bid_low';           // oldingisidan ko'p bo'lishi shart
        else if (coins + (mine ? topAmt : 0) < amt) err = 'funds';
        else {
          coins = coins + (mine ? topAmt : 0) - amt;
          if (top && !mine) {
            await c.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [topAmt, top.user_id]);
            notes.push([top.user_id, `"${au.title}" auksionida sizning tikishingiz ustidan oshib ketildi (${amt} coin). Coiningiz qaytarildi.`]);
          }
          await c.query('INSERT INTO bids (auction_id, user_id, name, username, amount, created) VALUES ($1,$2,$3,$4,$5,$6)', [id, u.id, u.first_name || 'Foydalanuvchi', u.username || null, amt, now]);
        }
      }
    } else if (action === 'admin_auction_add' && isAdmin) {
      const title = String(b.title || '').trim(), descr = String(b.descr || '').trim();
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
      const buf = m ? Buffer.from(m[2], 'base64') : null;
      if (title.length < 2 || title.length > 80 || descr.length > 600) err = 'bad_auction';
      else if (b.image && (!buf || buf.length > 600 * 1024)) err = 'bad_image';
      else if (!(Number(b.hours) >= 1 && Number(b.hours) <= 720)) err = 'bad_hours';   // auksion necha soat turishi
      else await c.query('INSERT INTO auctions (title, descr, image, mime, created, ends_at) VALUES ($1,$2,$3,$4,$5,$6)', [title, descr, buf, m ? m[1] : null, now, now + Math.round(Number(b.hours) * 3600000)]);
    } else if ((action === 'admin_auction_end' || action === 'admin_auction_cancel') && isAdmin) {
      const id = Number(b.id) || 0;
      const au = (await Q(c, 'SELECT id, title, status FROM auctions WHERE id=$1 FOR UPDATE', [id]))[0];
      if (!au || au.status !== 'active') err = 'auction_gone';
      else {
        const top = (await Q(c, 'SELECT user_id, name, username, amount FROM bids WHERE auction_id=$1 ORDER BY amount DESC LIMIT 1', [id]))[0];
        if (action === 'admin_auction_end') {
          await c.query("UPDATE auctions SET status='ended', winner_name=$2, win_amount=$3 WHERE id=$1", [id, top ? top.name : null, top ? top.amount : null]);
          if (top) notes.push([top.user_id, `Tabriklaymiz! Siz "${au.title}" auksionida g'olib bo'ldingiz (${top.amount} coin). Admin siz bilan bog'lanadi.`]);
          if (top) winners.push([au.id, au.title, top]);
        } else {
          await c.query("UPDATE auctions SET status='cancelled' WHERE id=$1", [id]);
          if (top) {
            if (Number(top.user_id) === u.id) coins += Number(top.amount);
            else await c.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [top.amount, top.user_id]);
            notes.push([top.user_id, `"${au.title}" auksioni bekor qilindi, ${top.amount} coin qaytarildi.`]);
          }
        }
      }
    } else if (action === 'order') {
      const sv = SERVICES[b.svc], qty = Math.floor(Number(b.qty)), tgt = String(b.target || '').trim();
      const cnt = sv && qty > 0 && qty % sv.q === 0 ? qty / sv.q : 0;   // miqdor paket hajmining ko'paytmasi bo'lishi shart
      if (!sv) err = 'gone';
      else if (sv.soon) err = 'soon';
      else if (tgt.length < 3 || tgt.length > 200) err = 'bad_target';
      else if (!(cnt >= 1 && cnt <= 100)) err = 'bad_count';
      else if (diamonds < sv.p * cnt) err = 'diamonds';
      else {
        diamonds -= sv.p * cnt;
        const oid = (await Q(c, 'INSERT INTO orders (user_id, svc, count, target, total, created) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [u.id, b.svc, cnt, tgt, sv.p * cnt, now]))[0].id;
        adminMsg = { oid, text: `Yangi buyurtma #${oid}\nFoydalanuvchi: ${u.first_name || ''} (${u.id})\nXizmat: ${sv.label}: ${qty} ${sv.unit || 'ta'}\nMaqsad: ${tgt}\nTo'lov: ${sv.p * cnt} olmos` };
      }
    } else if (/^admin_/.test(String(action)) && !isAdmin) {
      err = 'forbidden';                 // admin amallari faqat ADMIN_ID egasiga
    } else if (action === 'admin_promo' && isAdmin) {
      const k = String(b.code || '').trim().toUpperCase();
      const reward = Math.floor(Number(b.reward)), max = String(b.max ?? '').trim() === '' ? 0 : Math.floor(Number(b.max));   // bo'sh = cheksiz
      if (!/^[A-Z0-9]{3,20}$/.test(k) || !(reward >= 1 && reward <= 1e9) || !(max === 0 || (max >= 1 && max <= 1e6))) err = 'limits';
      else if ((await Q(c, 'SELECT 1 FROM promos WHERE code=$1', [k])).length) err = 'promo_exists';
      else {
        await c.query('INSERT INTO promos (code, reward, max, created) VALUES ($1,$2,$3,$4)', [k, reward, max, now]);
        promoPost = { code: k, reward, max, image: b.image };   // kanalga rasm bilan e'lon qilinadi
      }
    } else if (action === 'admin_promo_del' && isAdmin) {
      const k = String(b.code || '').trim().toUpperCase();
      const pr = (await Q(c, 'SELECT code, msg_id FROM promos WHERE code=$1 FOR UPDATE', [k]))[0];
      if (!pr) err = 'promo_none';
      else {
        await c.query('DELETE FROM promo_uses WHERE code=$1', [k]);
        await c.query('DELETE FROM promos WHERE code=$1', [k]);
        promoDel = pr.msg_id;           // kanaldagi post ham o'chiriladi
      }
    } else if (action === 'admin_give' && isAdmin) {
      const amt = Math.floor(Number(b.amount));
      if (amt >= 1 && amt <= 1e9) coins += amt; else err = 'bad_amount';
    } else if (action === 'admin_take' && isAdmin) {
      const k = String(b.code || '').trim().toUpperCase(), amt = Math.floor(Number(b.amount));
      const rec = k ? (await Q(c, 'SELECT id FROM users WHERE code=$1', [k]))[0] : { id: u.id };
      if (!(amt >= 1 && amt <= 1e12)) err = 'bad_amount';
      else if (!rec) err = 'send_none';
      else if (Number(rec.id) === u.id) coins = Math.max(0, coins - amt);
      else await c.query('UPDATE users SET coins = GREATEST(0, coins - $1) WHERE id=$2', [amt, rec.id]);
    } else if (action === 'admin_reset' && isAdmin && b.confirm === true) {
      await c.query('UPDATE users SET coins = 0, updated = $1', [now]);
      coins = 0;
    }

    await c.query(
      `UPDATE users SET coins=$1, diamonds=$2, skins=$3, skin=$4, taps=$5, tapday=$6, bonus_at=$7, streak=$8, tasks=$9, code=$10, code_locked=$11, updated=$12, stars_bal=$13 WHERE id=$14`,
      [coins, diamonds, JSON.stringify(skins), skin, taps, day, bonusAt, streak, JSON.stringify(tasks), myCode, codeLocked, now, starsBal, u.id]);

    if (payErr) err = payErr;
    const out = {
      coins, diamonds, skins, skin, taps, bonusAt, streak, refs: row.refs, me: u.id, bot: BOT_USERNAME,
      tasks, channel: CHANNEL, err, code: myCode, admin: isAdmin, promos: [], invoice, codeLocked, starsBal,
      ads: await Q(c, `SELECT id, channel, need, done, price FROM ads WHERE active AND owner <> $1
        AND id NOT IN (SELECT ad_id FROM ad_claims WHERE user_id = $1) ORDER BY id DESC LIMIT 30`, [u.id]),
      myAds: await Q(c, 'SELECT id, channel, need, done, price FROM ads WHERE owner = $1 ORDER BY id DESC LIMIT 10', [u.id]),
      orders: await Q(c, 'SELECT id, svc, count, total, status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [u.id]),
    };
    if (isAdmin) out.promos = await Q(c, 'SELECT code, reward, max, used FROM promos ORDER BY created DESC LIMIT 30');
    if (action === 'top') {
      out.top = await Q(c, 'SELECT name, coins FROM users ORDER BY coins DESC LIMIT 10');
      out.rank = (await Q(c, 'SELECT COUNT(*) + 1 AS r FROM users WHERE coins > $1', [coins]))[0].r;
    }
    if (['auctions', 'auction', 'bid', 'admin_auction_add', 'admin_auction_end', 'admin_auction_cancel'].includes(action)) {
      out.auctions = await Q(c, `SELECT a.id, a.title, a.descr, a.status, a.created, a.ends_at, a.winner_name, a.win_amount, (a.image IS NOT NULL) AS has_img,
          COALESCE(t.amount, 0) AS top, t.name AS top_name, (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) AS cnt
        FROM auctions a LEFT JOIN LATERAL (SELECT amount, name FROM bids WHERE auction_id = a.id ORDER BY amount DESC LIMIT 1) t ON TRUE
        ORDER BY (a.status = 'active') DESC, a.id DESC LIMIT 30`);
      out.srvNow = now;   // mijoz soati bilan farqni hisoblash uchun
    }
    if (['p2p', 'p2p_create', 'p2p_cancel', 'p2p_buy', 'stars_withdraw'].includes(action)) {
      out.offers = await Q(c, `SELECT id, seller_name, diamonds, stars, kind, (seller = $1) AS mine FROM p2p_offers WHERE status='active'
        ORDER BY (seller = $1) DESC, (stars::float / diamonds) ASC, id DESC LIMIT 100`, [u.id]);
      out.myOffers = await Q(c, 'SELECT id, diamonds, stars, status FROM p2p_offers WHERE seller = $1 ORDER BY id DESC LIMIT 20', [u.id]);
    }
    if (action === 'auction' || action === 'bid') {
      out.aid = Number(b.id) || 0;
      out.bids = await Q(c, 'SELECT name, amount, (user_id = $2) AS mine FROM bids WHERE auction_id = $1 ORDER BY amount DESC LIMIT 30', [out.aid, u.id]);
    }
    await c.query('COMMIT');
    res.json(out);
    if (notify) bot.telegram.sendMessage(notify[0], notify[1]).catch(() => {});
    for (const [nid, nt] of notes) bot.telegram.sendMessage(nid, nt).catch(() => {});
    for (const w of winners) postWinner(...w);
    if (promoPost) postPromo(promoPost);
    if (promoTouch) schedulePromoPost(promoTouch);
    if (promoDel) deletePromoPost(promoDel);
    if (adminWd && ADMIN_ID) {
      bot.telegram.sendMessage(ADMIN_ID, adminWd.text, Markup.inlineKeyboard([[
        Markup.button.callback("To'landi", `wok:${adminWd.wid}`), Markup.button.callback('Rad etish', `wno:${adminWd.wid}`)]]))
        .catch((e) => console.error('admin xabari:', e.message));
    }
    if (adminMsg && ADMIN_ID) {
      bot.telegram.sendMessage(ADMIN_ID, adminMsg.text, Markup.inlineKeyboard([[
        Markup.button.callback('Bajarildi', `ok:${adminMsg.oid}`), Markup.button.callback('Rad etish', `no:${adminMsg.oid}`)]]))
        .catch((e) => console.error('admin xabari:', e.message));
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('act xatosi:', e.message);
    res.status(500).json({ error: 'server' });
  } finally {
    c.release();
  }
});

const bot = new Telegraf(BOT_TOKEN);
bot.start(async (ctx) => {
  const ref = Number(String(ctx.payload || '').replace('ref_', '')), id = ctx.from.id;
  try {
    if (ref && ref !== id) {
      const me = await pool.query('SELECT 1 FROM users WHERE id=$1', [id]);
      const rf = await pool.query('SELECT 1 FROM users WHERE id=$1', [ref]);
      if (!me.rowCount && rf.rowCount) {
        await pool.query('INSERT INTO users (id, name, updated, coins, ref) VALUES ($1,$2,$3,$4,$5)', [id, ctx.from.first_name || '', Date.now(), 100 + REF_BONUS, ref]);
        await pool.query('UPDATE users SET coins = coins + $1, refs = refs + 1 WHERE id=$2', [REF_BONUS, ref]);
      }
    }
  } catch (e) { console.error('referal xatosi:', e.message); }
  ctx.reply('Coin Mine ga xush kelibsiz! Tangani bosib coin yig\'ing.\n\nYangiliklar @coinminer_team kanalida',
    Markup.inlineKeyboard([Markup.button.webApp('O\'ynash', WEBAPP_URL)]));
});
bot.command('stats', async (ctx) => {
  if (!ADMIN_ID || String(ctx.from.id) !== String(ADMIN_ID)) return;
  const r = (await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(coins),0) AS c, COALESCE(SUM(refs),0) AS f FROM users')).rows[0];
  ctx.reply(`Foydalanuvchilar: ${r.n}\nJami coin: ${r.c}\nReferallar: ${r.f}`);
});
// ---- Kanalga e'lonlar (CHANNEL; bot kanalda admin bo'lishi shart) ----
const escH = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function postChannel(text, photo) {
  if (!CHANNEL) return;
  try {
    if (photo) await bot.telegram.sendPhoto(CHANNEL, { source: photo }, { caption: text, parse_mode: 'HTML' });
    else await bot.telegram.sendMessage(CHANNEL, text, { parse_mode: 'HTML' });
  } catch (e) { console.error("Kanalga yuborib bo'lmadi:", e.message); }
}
// "@foydalanuvchi buyumni yutdi" (buyum rasmi bo'lsa, rasm bilan)
async function postWinner(auId, title, top) {
  const mention = top.username ? '@' + top.username : `<a href="tg://user?id=${top.user_id}">${escH(top.name || 'Foydalanuvchi')}</a>`;
  const img = (await pool.query('SELECT image FROM auctions WHERE id=$1', [auId]).catch(() => ({ rows: [] }))).rows[0];
  await postChannel(`🏆 ${mention} «${escH(title)}» ni yutdi!\n\nTikilgan: ${top.amount} coin`, img && img.image);
}
// Promokod posti: "+N coin", holat (FAOL/TUGAGAN) va limit (necha kishi, qolgani yoki cheksiz)
const promoCaption = (p) => {
  const left = p.max > 0 ? Math.max(0, p.max - p.used) : null;
  return `🎁 +${p.reward} 🪙\n\n${left === 0 ? '🔴 TUGAGAN' : '🟢 FAOL'}\n\n` + (p.max > 0 ? `👥 Limit: ${p.max} kishi. Qoldi: ${left}.` : '♾ Limit cheksiz.');
};
async function postPromo({ code, reward, max, image }) {
  if (!CHANNEL) return;
  const m = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  const hasImg = Boolean(buf && buf.length <= 900 * 1024);
  const text = promoCaption({ reward, max, used: 0 }) + (hasImg ? '' : `\n\nPromokod: ${code}`);   // rasm bo'lmasa, kod matnda ko'rinadi
  try {
    const msg = hasImg
      ? await bot.telegram.sendPhoto(CHANNEL, { source: buf }, { caption: text })
      : await bot.telegram.sendMessage(CHANNEL, text);
    await pool.query('UPDATE promos SET msg_id=$1 WHERE code=$2', [msg.message_id, code]);
  } catch (e) { console.error("Promokod postini yuborib bo'lmadi:", e.message); }
}
const promoTimers = new Map();
function schedulePromoPost(code) {     // ketma-ket ishlatilsa, tahrirlar 5 soniyada bir marta birlashtiriladi
  if (promoTimers.has(code) || !CHANNEL) return;
  promoTimers.set(code, setTimeout(async () => {
    promoTimers.delete(code);
    try {
      const p = (await pool.query('SELECT reward, max, used, msg_id FROM promos WHERE code=$1', [code])).rows[0];
      if (!p || !p.msg_id) return;
      const text = promoCaption(p);
      await bot.telegram.editMessageCaption(CHANNEL, Number(p.msg_id), undefined, text)
        .catch(() => bot.telegram.editMessageText(CHANNEL, Number(p.msg_id), undefined, text + `\n\nPromokod: ${code}`).catch(() => {}));
    } catch { /* e'tiborsiz */ }
  }, 5000));
}
async function deletePromoPost(msgId) {
  if (CHANNEL && msgId) await bot.telegram.deleteMessage(CHANNEL, Number(msgId)).catch(() => {});
}

// Muddati tugagan auksionlar avtomatik yakunlanadi: g'olib eng yuqori tikkan, unga va adminga xabar boradi
async function sweepAuctions() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const due = await Q(c, "SELECT id, title FROM auctions WHERE status='active' AND ends_at IS NOT NULL AND ends_at <= $1 FOR UPDATE SKIP LOCKED", [Date.now()]);
    const msgs = [], winners = [];
    for (const au of due) {
      const top = (await Q(c, 'SELECT user_id, name, username, amount FROM bids WHERE auction_id=$1 ORDER BY amount DESC LIMIT 1', [au.id]))[0];
      await c.query("UPDATE auctions SET status='ended', winner_name=$2, win_amount=$3 WHERE id=$1", [au.id, top ? top.name : null, top ? top.amount : null]);
      if (top) msgs.push([top.user_id, `Tabriklaymiz! Siz "${au.title}" auksionida g'olib bo'ldingiz (${top.amount} coin). Admin siz bilan bog'lanadi.`]);
      if (top) winners.push([au.id, au.title, top]);
      if (ADMIN_ID) msgs.push([ADMIN_ID, `Auksion yakunlandi: "${au.title}". ${top ? `G'olib: ${top.name} (${top.amount} coin)` : 'Hech kim tikmadi'}.`]);
    }
    await c.query('COMMIT');
    for (const [id, t] of msgs) bot.telegram.sendMessage(id, t).catch(() => {});
    for (const w of winners) postWinner(...w);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('auksion tekshiruvi xatosi:', e.message);
  } finally { c.release(); }
}

// P2P bozor: to'lov tasdiqlangach olmos xaridorga o'tadi, Stars sotuvchining Stars hamyoniga yoziladi
async function handleP2P(ctx, p) {
  const [, oid] = String(p.invoice_payload).split(':'), id = Number(oid), buyer = ctx.from.id, c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ins = await c.query('INSERT INTO payments (charge_id, user_id, kind, stars, created) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1',
      [p.telegram_payment_charge_id, buyer, 'p2p', p.total_amount, Date.now()]);
    if (!ins.rowCount) { await c.query('ROLLBACK'); return; }
    const o = (await c.query("UPDATE p2p_offers SET status='sold', buyer=$2, sold_at=$3 WHERE id=$1 AND status='active' AND reserved_by=$2 RETURNING seller, diamonds, stars, kind",
      [id, buyer, Date.now()])).rows[0];
    if (!o) {            // kutilmagan holat: Stars qaytariladi
      await c.query('ROLLBACK');
      await bot.telegram.refundStarPayment(buyer, p.telegram_payment_charge_id).catch(() => {});
      return ctx.reply('Sotuv amalga oshmadi, Stars qaytarildi.');
    }
    const net = Math.floor(o.stars * (100 - P2P_FEE) / 100);
    await c.query(o.kind === 'coin' ? 'UPDATE users SET coins = coins + $1 WHERE id=$2' : 'UPDATE users SET diamonds = diamonds + $1 WHERE id=$2', [o.diamonds, buyer]);
    await c.query('UPDATE users SET stars_bal = stars_bal + $1 WHERE id=$2', [net, o.seller]);
    await c.query('COMMIT');
    const what = o.kind === 'coin' ? 'coin' : 'olmos';
    ctx.reply(`To'lov qabul qilindi: +${o.diamonds} ${what}.`);
    bot.telegram.sendMessage(o.seller, `Sizning ${o.diamonds} ${what} taklifingiz sotildi. Stars hamyoningizga +${net} Stars yozildi.`).catch(() => {});
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('p2p xatosi:', e.message);
  } finally { c.release(); }
}

// Telegram Stars to'lovi
bot.on('pre_checkout_query', async (ctx) => {
  const q = ctx.preCheckoutQuery, pl = String(q.invoice_payload);
  if (!pl.startsWith('p2p:')) return ctx.answerPreCheckoutQuery(true).catch(() => {});
  try {   // bir vaqtda ikki kishi bitta olmosni sotib olmasligi uchun taklif 2 daqiqaga band qilinadi
    const now = Date.now();
    const r = await pool.query("UPDATE p2p_offers SET reserved_by=$2, reserved_until=$3 WHERE id=$1 AND status='active' AND seller <> $2 AND (reserved_by IS NULL OR reserved_until < $4 OR reserved_by=$2) RETURNING id",
      [Number(pl.split(':')[1]), q.from.id, now + 120000, now]);
    return r.rowCount ? ctx.answerPreCheckoutQuery(true) : ctx.answerPreCheckoutQuery(false, "Bu taklif endi mavjud emas yoki boshqa foydalanuvchi to'layapti.");
  } catch (e) { return ctx.answerPreCheckoutQuery(false, "Xatolik, qayta urinib ko'ring.").catch(() => {}); }
});
bot.on('successful_payment', async (ctx) => {
  const p = ctx.message.successful_payment, kind = String(p.invoice_payload).split(':')[0] === 'diamond' ? 'diamond' : 'coin';
  if (String(p.invoice_payload).startsWith('p2p:')) return handleP2P(ctx, p);
  try {
    // bir to'lov ikki marta hisoblanmasligi uchun charge_id yagona
    const ins = await pool.query('INSERT INTO payments (charge_id, user_id, kind, stars, created) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1',
      [p.telegram_payment_charge_id, ctx.from.id, kind, p.total_amount, Date.now()]);
    if (!ins.rowCount) return;
    const col = kind === 'coin' ? 'coins' : 'diamonds', amt = p.total_amount * (kind === 'coin' ? STARS_COIN : STARS_DIA);
    await pool.query(`UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [amt, ctx.from.id]);
    ctx.reply(`To'lov qabul qilindi: +${amt} ${kind === 'coin' ? 'coin' : 'olmos'}`);
  } catch (e) { console.error('to\'lov xatosi:', e.message); }
});
// Admin buyurtmani "Bajarildi" yoki "Rad etish" (olmos qaytariladi) deb belgilaydi
bot.action(/^(ok|no):(\d+)$/, async (ctx) => {
  if (!ADMIN_ID || String(ctx.from.id) !== String(ADMIN_ID)) return ctx.answerCbQuery('Ruxsat yo\'q');
  const [, kind, id] = ctx.match;
  const o = (await pool.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
  if (!o) return ctx.answerCbQuery('Topilmadi');
  const r = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 AND status=\'new\' RETURNING 1', [kind === 'ok' ? 'done' : 'rejected', id]);
  if (!r.rowCount) return ctx.answerCbQuery('Allaqachon ko\'rilgan');
  if (kind === 'no') await pool.query('UPDATE users SET diamonds = diamonds + $1 WHERE id=$2', [o.total, o.user_id]);
  bot.telegram.sendMessage(o.user_id, kind === 'ok' ? `Buyurtma #${id} bajarildi.` : `Buyurtma #${id} rad etildi, ${o.total} olmos qaytarildi.`).catch(() => {});
  await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n${kind === 'ok' ? 'Bajarildi' : 'Rad etildi, olmos qaytarildi'}`).catch(() => {});
  ctx.answerCbQuery('Tayyor');
});
// Admin Stars yechish so'rovini "To'landi" yoki "Rad etish" (hamyonga qaytariladi) deb belgilaydi
bot.action(/^(wok|wno):(\d+)$/, async (ctx) => {
  if (!ADMIN_ID || String(ctx.from.id) !== String(ADMIN_ID)) return ctx.answerCbQuery("Ruxsat yo'q");
  const [, kind, id] = ctx.match;
  const w = (await pool.query('SELECT * FROM withdrawals WHERE id=$1', [id])).rows[0];
  if (!w) return ctx.answerCbQuery('Topilmadi');
  const r = await pool.query("UPDATE withdrawals SET status=$1 WHERE id=$2 AND status='new' RETURNING 1", [kind === 'wok' ? 'paid' : 'rejected', id]);
  if (!r.rowCount) return ctx.answerCbQuery("Allaqachon ko'rilgan");
  if (kind === 'wno') await pool.query('UPDATE users SET stars_bal = stars_bal + $1 WHERE id=$2', [w.amount, w.user_id]);
  bot.telegram.sendMessage(w.user_id, kind === 'wok' ? `Stars yechish so'rovi #${id} bajarildi (${w.amount} Stars).` : `So'rov #${id} rad etildi, ${w.amount} Stars hamyoningizga qaytarildi.`).catch(() => {});
  await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n${kind === 'wok' ? "To'landi" : 'Rad etildi, Stars qaytarildi'}`).catch(() => {});
  ctx.answerCbQuery('Tayyor');
});
bot.catch((e) => console.error('Bot xatosi:', e.message));

// Render'da webhook (deploy paytida to'qnashmaydi), lokalda polling
if (process.env.RENDER || process.env.USE_WEBHOOK === 'true') {
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 32);
  app.use(await bot.createWebhook({ domain: new URL(WEBAPP_URL).host, path: '/tg-webhook', secret_token: secret }));
  console.log('Webhook rejimi yoqildi');
} else {
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
setInterval(sweepAuctions, 60000);   // har daqiqada muddati tugagan auksionlarni yakunlaydi
// Render bepul rejasi 15 daqiqa harakatsizlikdan keyin uxlaydi: o'z-o'ziga ping yuborib uyg'oq tutamiz
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_ALIVE !== 'false') {
  setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/healthz').catch(() => {}), 10 * 60 * 1000);
}
app.listen(PORT, () => console.log(`Server ishga tushdi, port ${PORT}`));
