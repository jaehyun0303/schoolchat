'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;
const MAX_MSG = 1000;
const MAX_IMG = 2 * 1024 * 1024;

// ---------- 데이터베이스 ----------
// TURSO_DATABASE_URL 이 있으면 Turso(무료 클라우드 DB)에, 없으면 내 컴퓨터의 파일에 저장해요.
const REMOTE = !!process.env.TURSO_DATABASE_URL;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'schoolchat.db');
if (!REMOTE) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const client = createClient({
  url: REMOTE ? process.env.TURSO_DATABASE_URL : 'file:' + DB_PATH,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const toRows = (res) => res.rows.map((r) => Object.fromEntries(res.columns.map((c, i) => [c, r[i]])));
const all = async (sql, args = []) => toRows(await client.execute({ sql, args }));
const get = async (sql, args = []) => (await all(sql, args))[0];
const run = async (sql, args = []) => {
  const r = await client.execute({ sql, args });
  return { id: Number(r.lastInsertRowid), changes: r.rowsAffected };
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS convs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT,
  visibility TEXT,
  code TEXT UNIQUE,
  owner_id INTEGER,
  dm_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  conv_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  image TEXT
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv_id, id);
CREATE TABLE IF NOT EXISTS images (
  name TEXT PRIMARY KEY,
  conv_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);
`;

async function initDb() {
  await client.executeMultiple(SCHEMA);
  // 예전 버전에서 만든 DB를 위한 열 추가 (이미 있으면 무시)
  for (const col of ['edited_at INTEGER', 'deleted INTEGER NOT NULL DEFAULT 0', 'image TEXT']) {
    try { await client.execute('ALTER TABLE messages ADD COLUMN ' + col); } catch { /* 이미 있음 */ }
  }
}

// ---------- 비밀번호 / 세션 ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [s, h] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex'));
}
const DUMMY_HASH = hashPw('dummy-password');

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const sessCache = new Map(); // 매 요청마다 DB를 조회하지 않도록 1분 캐시
async function userFromReq(req) {
  const tok = parseCookies(req.headers.cookie).sid;
  if (!tok) return null;
  const c = sessCache.get(tok);
  if (c && c.until > Date.now()) return c.user;
  const u = await get(`SELECT u.id, u.username, u.nickname FROM sessions s JOIN users u ON u.id = s.user_id
                       WHERE s.token = ? AND s.expires_at > ?`, [tok, Date.now()]);
  if (u) sessCache.set(tok, { user: u, until: Date.now() + 60000 });
  else sessCache.delete(tok);
  return u || null;
}
async function startSession(res, userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  await run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [token, userId, Date.now() + SESSION_DAYS * 86400000]);
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${SESSION_DAYS * 86400}`);
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// 가입/로그인 시도 제한 (IP당 10분에 30회)
const attempts = new Map();
function limited(req) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, reset: now + 600000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 600000; }
  rec.n++;
  attempts.set(ip, rec);
  return rec.n > 30;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.reset) attempts.delete(k);
  for (const [k, v] of sessCache) if (now > v.until) sessCache.delete(k);
  run('DELETE FROM sessions WHERE expires_at <= ?', [now]).catch(() => {});
}, 600000).unref();

// ---------- 접속 상태 / 실시간 전송 ----------
const sockets = new Map(); // userId -> Set<ws>
const isOnline = (id) => (sockets.get(id)?.size || 0) > 0;
function sendTo(userId, payload) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === 1) ws.send(data);
}
function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const set of sockets.values()) for (const ws of set) if (ws.readyState === 1) ws.send(data);
}

const memCache = new Map(); // convId -> Set<userId>
async function memberIds(convId) {
  let s = memCache.get(convId);
  if (!s) {
    s = new Set((await all('SELECT user_id FROM members WHERE conv_id = ?', [convId])).map((r) => r.user_id));
    memCache.set(convId, s);
  }
  return [...s];
}
const isMember = async (convId, uid) => (await memberIds(convId)).includes(uid);
async function addMember(convId, uid) {
  await run('INSERT OR IGNORE INTO members (conv_id, user_id, last_read) VALUES (?,?,0)', [convId, uid]);
  memCache.delete(convId);
}
const markRead = (convId, uid) => run(
  `UPDATE members SET last_read = (SELECT COALESCE(MAX(id),0) FROM messages WHERE conv_id = ?) WHERE conv_id = ? AND user_id = ?`,
  [convId, convId, uid]);

// ---------- 직렬화 ----------
const pubUser = (u) => ({ id: u.id, nickname: u.nickname, online: isOnline(u.id), lastSeen: u.last_seen });
const pubMsg = (m) => ({
  id: m.id, convId: m.conv_id, userId: m.user_id, at: m.created_at,
  text: m.deleted ? '' : m.text, deleted: !!m.deleted, editedAt: m.edited_at || null,
  image: !m.deleted && m.image ? '/api/images/' + m.image : null
});

// 내가 속한 대화 목록(멤버·마지막 메시지·안 읽은 수 포함)을 쿼리 4번으로 한 번에 만든다
async function loadConvs(me, onlyId) {
  const args = [me];
  let extra = '';
  if (onlyId) { extra = ' AND c.id = ?'; args.push(onlyId); }
  const convs = await all(`SELECT c.*, m.last_read FROM convs c JOIN members m ON m.conv_id = c.id
                           WHERE m.user_id = ?${extra} ORDER BY c.id`, args);
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const ph = ids.map(() => '?').join(',');
  const [mem, last, unr] = await Promise.all([
    all(`SELECT conv_id, user_id FROM members WHERE conv_id IN (${ph})`, ids),
    all(`SELECT * FROM messages WHERE id IN (SELECT MAX(id) FROM messages WHERE conv_id IN (${ph}) GROUP BY conv_id)`, ids),
    all(`SELECT x.conv_id, COUNT(*) AS n FROM messages x JOIN members mm ON mm.conv_id = x.conv_id AND mm.user_id = ?
         WHERE x.conv_id IN (${ph}) AND x.id > mm.last_read AND x.user_id != ? AND x.deleted = 0 GROUP BY x.conv_id`, [me, ...ids, me])
  ]);
  return convs.map((c) => {
    const l = last.find((x) => x.conv_id === c.id);
    return {
      id: c.id, kind: c.kind, name: c.name, visibility: c.visibility,
      code: c.kind === 'room' && c.visibility === 'public' ? c.code : null,
      ownerId: c.owner_id, createdAt: c.created_at,
      members: mem.filter((x) => x.conv_id === c.id).map((x) => x.user_id),
      last: l ? pubMsg(l) : null,
      unread: unr.find((x) => x.conv_id === c.id)?.n || 0
    };
  });
}
async function notifyConv(convId, userIds) {
  for (const uid of userIds) {
    const [conv] = await loadConvs(uid, convId);
    if (conv) sendTo(uid, { type: 'conv', conv });
  }
}
async function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += alphabet[crypto.randomInt(alphabet.length)];
    if (!(await get('SELECT 1 AS x FROM convs WHERE code = ?', [c]))) return c;
  }
}
async function pushMessage(convId, messageRow, type = 'message') {
  const msg = pubMsg(messageRow);
  for (const mid of await memberIds(convId)) sendTo(mid, { type, message: msg });
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.get('/healthz', (req, res) => res.type('text').send('ok')); // 잠들지 않게 외부에서 주기적으로 두드리는 주소
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:");
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
});
const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const auth = wrap(async (req, res, next) => {
  const u = await userFromReq(req);
  if (!u) return bad(res, '로그인이 필요해요.', 401);
  req.user = u;
  next();
});

app.get('/api/username-check', wrap(async (req, res) => {
  const u = String(req.query.u || '').toLowerCase();
  if (!USERNAME_RE.test(u)) return res.json({ ok: false, reason: '영문 소문자, 숫자, _ 로 4~20자여야 해요.' });
  if (await get('SELECT 1 AS x FROM users WHERE username = ?', [u])) return res.json({ ok: false, reason: '이미 사용 중인 아이디예요.' });
  res.json({ ok: true });
}));

app.post('/api/signup', wrap(async (req, res) => {
  if (limited(req)) return bad(res, '잠시 후 다시 시도해 주세요.', 429);
  const username = String(req.body.username || '').toLowerCase();
  const nickname = String(req.body.nickname || '').trim();
  const password = String(req.body.password || '');
  if (!nickname || [...nickname].length > 12) return bad(res, '닉네임은 1~12자로 입력해 주세요.');
  if (!USERNAME_RE.test(username)) return bad(res, '아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.');
  if (password.length < 8 || password.length > 100) return bad(res, '비밀번호는 8자 이상이어야 해요.');
  let id;
  try {
    id = (await run('INSERT INTO users (username, nickname, pw_hash, created_at) VALUES (?,?,?,?)',
      [username, nickname, hashPw(password), Date.now()])).id;
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e.message))) return bad(res, '이미 사용 중인 아이디예요.', 409);
    throw e;
  }
  await startSession(res, id, true);
  broadcast({ type: 'user', user: pubUser(await get('SELECT id, nickname, last_seen FROM users WHERE id = ?', [id])) });
  res.json({ ok: true });
}));

app.post('/api/login', wrap(async (req, res) => {
  if (limited(req)) return bad(res, '잠시 후 다시 시도해 주세요.', 429);
  const username = String(req.body.username || '').toLowerCase();
  const password = String(req.body.password || '');
  const u = await get('SELECT * FROM users WHERE username = ?', [username]);
  const ok = checkPw(password, u ? u.pw_hash : DUMMY_HASH) && u;
  if (!ok) return bad(res, '아이디 또는 비밀번호가 맞지 않아요.', 401);
  await startSession(res, u.id, !!req.body.remember);
  res.json({ ok: true });
}));

app.post('/api/logout', wrap(async (req, res) => {
  const tok = parseCookies(req.headers.cookie).sid;
  if (tok) { sessCache.delete(tok); await run('DELETE FROM sessions WHERE token = ?', [tok]); }
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true });
}));

app.get('/api/state', auth, wrap(async (req, res) => {
  const me = req.user.id;
  const [users, convs] = await Promise.all([
    all('SELECT id, nickname, last_seen FROM users ORDER BY nickname'),
    loadConvs(me)
  ]);
  res.json({ me: { id: me, nickname: req.user.nickname, username: req.user.username }, users: users.map(pubUser), convs });
}));

app.get('/api/convs/:id/messages', auth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await isMember(id, req.user.id))) return bad(res, '참여 중인 채팅이 아니에요.', 403);
  const before = Number(req.query.before) || 0;
  const rows = await all(`SELECT * FROM (SELECT * FROM messages WHERE conv_id = ? AND (? = 0 OR id < ?) ORDER BY id DESC LIMIT 50) ORDER BY id`,
    [id, before, before]);
  res.json({ messages: rows.map(pubMsg) });
}));

app.post('/api/rooms', auth, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const visibility = req.body.visibility === 'private' ? 'private' : 'public';
  if (!name || [...name].length > 30) return bad(res, '채팅방 이름은 1~30자로 입력해 주세요.');
  const wanted = [...new Set((Array.isArray(req.body.invite) ? req.body.invite : []).map(Number))]
    .filter((id) => id && id !== req.user.id).slice(0, 100);
  const valid = wanted.length
    ? (await all(`SELECT id FROM users WHERE id IN (${wanted.map(() => '?').join(',')})`, wanted)).map((r) => r.id) : [];
  const code = visibility === 'public' ? await newCode() : null;
  const t = await client.transaction('write');
  let convId;
  try {
    const r = await t.execute({ sql: 'INSERT INTO convs (kind, name, visibility, code, owner_id, created_at) VALUES (?,?,?,?,?,?)',
      args: ['room', name, visibility, code, req.user.id, Date.now()] });
    convId = Number(r.lastInsertRowid);
    for (const u of [req.user.id, ...valid]) {
      await t.execute({ sql: 'INSERT OR IGNORE INTO members (conv_id, user_id, last_read) VALUES (?,?,0)', args: [convId, u] });
    }
    await t.commit();
  } catch (e) { await t.rollback(); throw e; } finally { t.close(); }
  memCache.delete(convId);
  await notifyConv(convId, await memberIds(convId));
  res.json({ id: convId });
}));

app.post('/api/rooms/join', auth, wrap(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const c = await get('SELECT * FROM convs WHERE code = ?', [code]);
  if (!c || c.visibility !== 'public') return bad(res, '초대 코드를 찾을 수 없어요.', 404);
  await addMember(c.id, req.user.id);
  await notifyConv(c.id, await memberIds(c.id));
  res.json({ id: c.id });
}));

app.post('/api/dm', auth, wrap(async (req, res) => {
  const other = Number(req.body.userId);
  if (!other || other === req.user.id || !(await get('SELECT 1 AS x FROM users WHERE id = ?', [other]))) {
    return bad(res, '대화할 친구를 찾을 수 없어요.', 404);
  }
  const key = [req.user.id, other].sort((a, b) => a - b).join('-');
  let c = await get('SELECT id FROM convs WHERE dm_key = ?', [key]);
  if (!c) {
    try {
      const id = (await run('INSERT INTO convs (kind, dm_key, created_at) VALUES (?,?,?)', ['dm', key, Date.now()])).id;
      await addMember(id, req.user.id); await addMember(id, other);
      c = { id };
      await notifyConv(id, [req.user.id, other]);
    } catch (e) { // 동시에 만들어졌다면 기존 것을 사용
      c = await get('SELECT id FROM convs WHERE dm_key = ?', [key]);
      if (!c) throw e;
    }
  }
  res.json({ id: c.id });
}));

// ----- 이미지 (DB에 저장 → 서버 디스크가 없어도 유지됨) -----
function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

app.post('/api/convs/:id/images', auth, express.raw({ type: () => true, limit: MAX_IMG }), wrap(async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await isMember(convId, req.user.id))) return bad(res, '참여 중인 채팅이 아니에요.', 403);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return bad(res, '이미지를 선택해 주세요.');
  const ext = sniffImage(buf);
  if (!ext) return bad(res, 'JPG, PNG, GIF, WEBP 이미지만 보낼 수 있어요.');
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  await run('INSERT INTO images (name, conv_id, mime, data) VALUES (?,?,?,?)', [name, convId, MIME[ext], buf]);
  const r = await run('INSERT INTO messages (conv_id, user_id, text, created_at, image) VALUES (?,?,?,?,?)',
    [convId, req.user.id, '', Date.now(), name]);
  await markRead(convId, req.user.id);
  await pushMessage(convId, await get('SELECT * FROM messages WHERE id = ?', [r.id]));
  res.json({ ok: true });
}));

app.get('/api/images/:name', auth, wrap(async (req, res) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{32}\.(jpg|png|gif|webp)$/.test(name)) return bad(res, '없는 이미지예요.', 404);
  const row = await get(`SELECT i.conv_id, i.mime, i.data FROM images i JOIN messages m ON m.image = i.name
                         WHERE i.name = ? AND m.deleted = 0`, [name]);
  if (!row) return bad(res, '없는 이미지예요.', 404);
  if (!(await isMember(row.conv_id, req.user.id))) return bad(res, '볼 수 없는 이미지예요.', 403);
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(Buffer.from(row.data));
}));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return bad(res, '이미지는 2MB 이하만 보낼 수 있어요.', 413);
  if (err) return bad(res, '요청을 처리하지 못했어요.');
  next();
});
app.use('/api', (req, res) => bad(res, '없는 요청이에요.', 404));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  try {
    const user = req.url === '/ws' ? await userFromReq(req) : null;
    const origin = req.headers.origin; // 같은 사이트에서 연결한 경우만 허용 (CSWSH 방지)
    const sameOrigin = !origin || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
    if (!user || !sameOrigin) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => { ws.userId = user.id; wss.emit('connection', ws); });
  } catch { socket.destroy(); }
});

async function handleWs(uid, m) {
  const convId = Number(m.convId);
  if (!convId || !(await isMember(convId, uid))) return;
  if (m.type === 'send') {
    const text = String(m.text || '').replace(/\r\n/g, '\n').trim();
    if (!text || [...text].length > MAX_MSG) return;
    const r = await run('INSERT INTO messages (conv_id, user_id, text, created_at) VALUES (?,?,?,?)', [convId, uid, text, Date.now()]);
    await markRead(convId, uid);
    await pushMessage(convId, await get('SELECT * FROM messages WHERE id = ?', [r.id]));
  } else if (m.type === 'edit' || m.type === 'delete') {
    const row = await get('SELECT * FROM messages WHERE id = ?', [Number(m.id)]);
    if (!row || row.conv_id !== convId || row.user_id !== uid || row.deleted) return;
    if (m.type === 'edit') {
      const text = String(m.text || '').replace(/\r\n/g, '\n').trim();
      if (row.image || !text || [...text].length > MAX_MSG) return;
      await run('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?', [text, Date.now(), row.id]);
    } else {
      await run("UPDATE messages SET deleted = 1, text = '', image = NULL WHERE id = ?", [row.id]);
      if (row.image) await run('DELETE FROM images WHERE name = ?', [row.image]);
    }
    await pushMessage(convId, await get('SELECT * FROM messages WHERE id = ?', [row.id]), 'message_update');
  } else if (m.type === 'read') {
    await markRead(convId, uid);
  }
}

wss.on('connection', (ws) => {
  const uid = ws.userId;
  ws.alive = true;
  let set = sockets.get(uid);
  if (!set) sockets.set(uid, (set = new Set()));
  set.add(ws);
  if (set.size === 1) broadcast({ type: 'presence', userId: uid, online: true, lastSeen: Date.now() });

  let queue = Promise.resolve(); // 한 사람의 메시지는 보낸 순서대로 처리
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    queue = queue.then(() => handleWs(uid, m)).catch((e) => console.error('ws 처리 오류:', e.message));
  });
  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) {
      sockets.delete(uid);
      const now = Date.now();
      run('UPDATE users SET last_seen = ? WHERE id = ?', [now, uid]).catch(() => {});
      broadcast({ type: 'presence', userId: uid, online: false, lastSeen: now });
    }
  });
  ws.on('error', () => {});
});

setInterval(() => { // 끊어진 연결 정리 (30초마다 ping)
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

const ready = initDb();
if (require.main === module) {
  ready.then(async () => {
    const n = (await get('SELECT COUNT(*) AS n FROM users')).n;
    server.listen(PORT, () => console.log(`디톡 서버 실행 중: http://localhost:${PORT} (사용자 ${n}명, 저장소: ${REMOTE ? 'Turso' : '로컬 파일'})`));
  }).catch((e) => { console.error('DB 연결 실패:', e.message); process.exit(1); });
}
module.exports = { server, ready };
