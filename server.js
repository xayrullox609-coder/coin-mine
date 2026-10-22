import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { Telegraf } from 'telegraf';

const { BOT_TOKEN, ADMIN_ID = "", PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT, DATABASE_URL } = process.env;

const BOT_USERNAME = (process.env.BOT_USERNAME || "").trim().replace(/^@/, "");
const WEBAPP_URL = process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN || !WEBAPP_URL || !DATABASE_URL) {
  console.error('.env: BOT_TOKEN, DATABASE_URL va WEBAPP_URL kerak');
  process.exit(1);
}

const SKINS = [
  { cost: 0, mult: 1, cap: 500 },
  { cost: 199, mult: 2, cap: 500 },
  { cost: 199, mult: 2, cap: 500 },
  { cost: 499, mult: 3, cap: 800 },
  { cost: 899, mult: 3, cap: 800 },
  { cost: 899, mult: 3, cap: 800 },
  { cost: 1299, mult: 4, cap: 1000 },
  { cost: 1299, mult: 4, cap: 1000 }
];