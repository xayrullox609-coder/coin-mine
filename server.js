import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { Telegraf, Markup } from 'telegraf';

const { BOT_TOKEN, BOT_USERNAME = '', CHANNEL = '', ADMIN_ID = '', PORT = 3000, DATABASE_URL } = process.env;
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
const EXCH = 10;             // 1 olmos = 10 coin
const REFILL = 20;           // energiyani to'ldirish = 20 olmos
const AD_COST = 2;           // reklama beruvchi: 1 obunachi = 2 olmos
const AD_REWARD = 1;         // obunachi oladi: 1 olmos
const TASKS = [{ id: 'channel', reward: 2000 }, { id: 'friends3', reward: 3000 }, { id: 'level10', reward: 1500 }];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STARS_COIN = 1000, STARS_DIA = 20;   // 1 Stars = 1000 coin yoki 20 olmos
// Boost xizmatlari (public/index.html dagi SV bilan bir xil): p = bitta paket narxi (olmos)
const SERVICES = {
  ig_views: { p: 10, label: "Instagram ko'rishlar 1000" }, ig_subs: { p: 20, label: 'Instagram obunachi 50' }, ig_likes: { p: 10, label: 'Instagram like 50' },
  tg_views: { p: 5, label: "Telegram ko'rishlar 1000" }, tg_react: { p: 1, label: 'Telegram reaksiya 10' }, tg_subs: { p: 10, label: 'Telegram obunachi 50' },
  yt_subs: { p: 100, label: 'YouTube obunachi 1000' }, yt_likes: { p: 1, label: 'YouTube like 10' }, yt_views: { p: 10, label: "YouTube ko'rishlar 1000" },
  pubg_uc: { p: 500, label: 'PUBG Mobile 60 UC' },
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
INSERT INTO codes_used (code) SELECT code FROM users WHERE code IS NOT NULL ON CONFLICT DO NOTHING;
`);

const Q = async (c, sql, p = []) => (await c.query(sql, p)).rows;
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
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));
app.get('/healthz', (req, res) => res.send('ok'));

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

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const now = Date.now(), day = Math.floor(now / DAY);
    await c.query('INSERT INTO users (id, name, updated) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [u.id, u.first_name || '', now]);
    const row = (await Q(c, 'SELECT * FROM users WHERE id=$1 FOR UPDATE', [u.id]))[0];
    let { coins, diamonds, skin, taps, streak } = row;
    let bonusAt = row.bonus_at, myCode = row.code, codeLocked = row.code_locked;
    const skins = JSON.parse(row.skins), tasks = JSON.parse(row.tasks);
    const isAdmin = Boolean(ADMIN_ID) && String(u.id) === String(ADMIN_ID);
    if (row.tapday !== day) taps = 0;               // kunlik limit har kuni yangilanadi (UTC)
    if (!myCode) {          // birinchi kirishda tasodifiy kod beriladi
      myCode = await genCode(c);
      await c.query('INSERT INTO codes_used (code) VALUES ($1)', [myCode]);
    }
    let err = null, notify = null, adminMsg = null;
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
    } else if (action === 'exchange') {
      const nd = Math.floor(Number(b.n));
      if (!(nd >= 1 && nd <= 100000)) err = 'bad_amount';
      else if (coins < nd * EXCH) err = 'funds';
      else { coins -= nd * EXCH; diamonds += nd; }
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
      else if (pr.used >= pr.max) err = 'promo_end';
      else {
        coins += pr.reward;
        await c.query('INSERT INTO promo_uses (code, user_id) VALUES ($1,$2)', [k, u.id]);
        await c.query('UPDATE promos SET used = used + 1 WHERE code=$1', [k]);
      }
    } else if (action === 'order') {
      const sv = SERVICES[b.svc], cnt = Math.floor(Number(b.count)), tgt = String(b.target || '').trim();
      if (!sv) err = 'gone';
      else if (tgt.length < 3 || tgt.length > 200) err = 'bad_target';
      else if (!(cnt >= 1 && cnt <= 100)) err = 'bad_count';
      else if (diamonds < sv.p * cnt) err = 'diamonds';
      else {
        diamonds -= sv.p * cnt;
        const oid = (await Q(c, 'INSERT INTO orders (user_id, svc, count, target, total, created) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [u.id, b.svc, cnt, tgt, sv.p * cnt, now]))[0].id;
        adminMsg = { oid, text: `Yangi buyurtma #${oid}\nFoydalanuvchi: ${u.first_name || ''} (${u.id})\nXizmat: ${sv.label} x${cnt}\nMaqsad: ${tgt}\nTo'lov: ${sv.p * cnt} olmos` };
      }
    } else if (/^admin_/.test(String(action)) && !isAdmin) {
      err = 'forbidden';                 // admin amallari faqat ADMIN_ID egasiga
    } else if (action === 'admin_promo' && isAdmin) {
      const k = String(b.code || '').trim().toUpperCase();
      const reward = Math.floor(Number(b.reward)), max = Math.floor(Number(b.max));
      if (!/^[A-Z0-9]{3,20}$/.test(k) || !(reward >= 1 && reward <= 1e9) || !(max >= 1 && max <= 1e6)) err = 'limits';
      else if ((await Q(c, 'SELECT 1 FROM promos WHERE code=$1', [k])).length) err = 'promo_exists';
      else await c.query('INSERT INTO promos (code, reward, max, created) VALUES ($1,$2,$3,$4)', [k, reward, max, now]);
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
      `UPDATE users SET coins=$1, diamonds=$2, skins=$3, skin=$4, taps=$5, tapday=$6, bonus_at=$7, streak=$8, tasks=$9, code=$10, code_locked=$11, updated=$12 WHERE id=$13`,
      [coins, diamonds, JSON.stringify(skins), skin, taps, day, bonusAt, streak, JSON.stringify(tasks), myCode, codeLocked, now, u.id]);

    if (payErr) err = payErr;
    const out = {
      coins, diamonds, skins, skin, taps, bonusAt, streak, refs: row.refs, me: u.id, bot: BOT_USERNAME,
      tasks, channel: CHANNEL, err, code: myCode, admin: isAdmin, promos: [], invoice, codeLocked,
      ads: await Q(c, `SELECT id, channel, need, done, price FROM ads WHERE active AND owner <> $1
        AND id NOT IN (SELECT ad_id FROM ad_claims WHERE user_id = $1) ORDER BY id DESC LIMIT 30`, [u.id]),
      myAds: await Q(c, 'SELECT id, channel, need, done, price FROM ads WHERE owner = $1 ORDER BY id DESC LIMIT 10', [u.id]),
      orders: await Q(c, 'SELECT id, svc, count, total, status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [u.id]),
    };
    if (isAdmin) out.promos = await Q(c, 'SELECT code, reward, max, used FROM promos ORDER BY created DESC LIMIT 10');
    if (action === 'top') {
      out.top = await Q(c, 'SELECT name, coins FROM users ORDER BY coins DESC LIMIT 10');
      out.rank = (await Q(c, 'SELECT COUNT(*) + 1 AS r FROM users WHERE coins > $1', [coins]))[0].r;
    }
    await c.query('COMMIT');
    res.json(out);
    if (notify) bot.telegram.sendMessage(notify[0], notify[1]).catch(() => {});
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
// Telegram Stars to'lovi
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true).catch(() => {}));
bot.on('successful_payment', async (ctx) => {
  const p = ctx.message.successful_payment, kind = String(p.invoice_payload).split(':')[0] === 'diamond' ? 'diamond' : 'coin';
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
// Render bepul rejasi 15 daqiqa harakatsizlikdan keyin uxlaydi: o'z-o'ziga ping yuborib uyg'oq tutamiz
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_ALIVE !== 'false') {
  setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/healthz').catch(() => {}), 10 * 60 * 1000);
}
app.listen(PORT, () => console.log(`Server ishga tushdi, port ${PORT}`));