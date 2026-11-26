'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'schoolchat.db');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;
const MAX_MSG = 1000;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
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
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS convs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('room','dm')),
  name TEXT,
  visibility TEXT,
  code TEXT UNIQUE,
  owner_id INTEGER,
  dm_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  conv_id INTEGER NOT NULL REFERENCES convs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL REFERENCES convs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv_id, id);
`);
for (const col of ['edited_at INTEGER', 'deleted INTEGER NOT NULL DEFAULT 0', 'image TEXT']) {
  try { db.exec('ALTER TABLE messages ADD COLUMN ' + col); } catch { /* 이미 있음 */ }
}
const UPLOAD_DIR = path.join(path.dirname(DB_PATH), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_IMG = 5 * 1024 * 1024;

const q = (sql) => db.prepare(sql);
const stmt = {
  userByName: q('SELECT * FROM users WHERE username = ?'),
  userById: q('SELECT id, nickname, last_seen FROM users WHERE id = ?'),
  allUsers: q('SELECT id, nickname, last_seen FROM users ORDER BY nickname'),
  insertUser: q('INSERT INTO users (username, nickname, pw_hash, created_at) VALUES (?,?,?,?)'),
  setLastSeen: q('UPDATE users SET last_seen = ? WHERE id = ?'),
  insertSession: q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)'),
  sessionUser: q(`SELECT u.id, u.username, u.nickname FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token = ? AND s.expires_at > ?`),
  delSession: q('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: q('DELETE FROM sessions WHERE expires_at <= ?'),
  myConvs: q(`SELECT c.* FROM convs c JOIN members m ON m.conv_id = c.id WHERE m.user_id = ? ORDER BY c.id`),
  convById: q('SELECT * FROM convs WHERE id = ?'),
  convByCode: q('SELECT * FROM convs WHERE code = ?'),
  convByDm: q('SELECT * FROM convs WHERE dm_key = ?'),
  convMembers: q('SELECT user_id FROM members WHERE conv_id = ?'),
  isMember: q('SELECT 1 AS ok FROM members WHERE conv_id = ? AND user_id = ?'),
  insertConv: q('INSERT INTO convs (kind, name, visibility, code, owner_id, dm_key, created_at) VALUES (?,?,?,?,?,?,?)'),
  addMember: q('INSERT OR IGNORE INTO members (conv_id, user_id, last_read) VALUES (?,?,?)'),
  lastMsg: q('SELECT id, user_id, text, created_at, edited_at, deleted, image FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 1'),
  unread: q(`SELECT COUNT(*) AS n FROM messages WHERE conv_id = ? AND id > ? AND user_id != ?`),
  lastRead: q('SELECT last_read FROM members WHERE conv_id = ? AND user_id = ?'),
  insertMsg: q('INSERT INTO messages (conv_id, user_id, text, created_at) VALUES (?,?,?,?)'),
  insertImg: q('INSERT INTO messages (conv_id, user_id, text, created_at, image) VALUES (?,?,?,?,?)'),
  msgById: q('SELECT * FROM messages WHERE id = ?'),
  editMsg: q('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?'),
  delMsg: q("UPDATE messages SET deleted = 1, text = '', image = NULL WHERE id = ?"),
  imgMsg: q('SELECT m.conv_id FROM messages m WHERE m.image = ? AND m.deleted = 0'),
  msgs: q(`SELECT id, conv_id, user_id, text, created_at, edited_at, deleted, image FROM (
             SELECT * FROM messages WHERE conv_id = ? AND (? = 0 OR id < ?) ORDER BY id DESC LIMIT 50
           ) ORDER BY id`),
  markRead: q(`UPDATE members SET last_read = (SELECT COALESCE(MAX(id),0) FROM messages WHERE conv_id = ?)
               WHERE conv_id = ? AND user_id = ?`),
  userCount: q('SELECT COUNT(*) AS n FROM users')
};

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- 비밀번호 / 세션 ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}
function checkPw(pw, stored) {
  const [s, h] = stored.split(':');
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
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
function userFromReq(req) {
  const tok = parseCookies(req.headers.cookie).sid;
  if (!tok) return null;
  return stmt.sessionUser.get(tok, Date.now()) || null;
}
function startSession(res, userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = SESSION_DAYS * 86400000;
  stmt.insertSession.run(token, userId, Date.now() + ttl);
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${SESSION_DAYS * 86400}`);
  if (IS_PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// 간단한 로그인/가입 시도 제한 (IP당 10분에 30회)
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
  stmt.purgeSessions.run(now);
}, 600000).unref();

// ---------- 실시간(접속 상태) ----------
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
function memberIds(convId) { return stmt.convMembers.all(convId).map((r) => r.user_id); }

// ---------- 직렬화 ----------
const pubUser = (u) => ({ id: u.id, nickname: u.nickname, online: isOnline(u.id), lastSeen: u.last_seen });
const pubMsg = (m) => ({
  id: m.id, convId: m.conv_id, userId: m.user_id, at: m.created_at,
  text: m.deleted ? '' : m.text, deleted: !!m.deleted, editedAt: m.edited_at || null,
  image: !m.deleted && m.image ? '/api/images/' + m.image : null
});
function pubConv(c, me) {
  const last = stmt.lastMsg.get(c.id);
  const lr = stmt.lastRead.get(c.id, me)?.last_read || 0;
  return {
    id: c.id, kind: c.kind, name: c.name, visibility: c.visibility,
    code: c.kind === 'room' && c.visibility === 'public' ? c.code : null,
    ownerId: c.owner_id, createdAt: c.created_at,
    members: memberIds(c.id),
    last: last ? pubMsg({ ...last, conv_id: c.id }) : null,
    unread: stmt.unread.get(c.id, lr, me).n
  };
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += alphabet[crypto.randomInt(alphabet.length)];
    if (!stmt.convByCode.get(c)) return c;
  }
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
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

const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const auth = (req, res, next) => {
  const u = userFromReq(req);
  if (!u) return bad(res, '로그인이 필요해요.', 401);
  req.user = u;
  next();
};

app.get('/api/username-check', (req, res) => {
  const u = String(req.query.u || '').toLowerCase();
  if (!USERNAME_RE.test(u)) return res.json({ ok: false, reason: '영문 소문자, 숫자, _ 로 4~20자여야 해요.' });
  if (stmt.userByName.get(u)) return res.json({ ok: false, reason: '이미 사용 중인 아이디예요.' });
  res.json({ ok: true });
});

app.post('/api/signup', (req, res) => {
  if (limited(req)) return bad(res, '잠시 후 다시 시도해 주세요.', 429);
  const username = String(req.body.username || '').toLowerCase();
  const nickname = String(req.body.nickname || '').trim();
  const password = String(req.body.password || '');
  if (!nickname || [...nickname].length > 12) return bad(res, '닉네임은 1~12자로 입력해 주세요.');
  if (!USERNAME_RE.test(username)) return bad(res, '아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.');
  if (password.length < 8 || password.length > 100) return bad(res, '비밀번호는 8자 이상이어야 해요.');
  if (stmt.userByName.get(username)) return bad(res, '이미 사용 중인 아이디예요.', 409);
  const r = stmt.insertUser.run(username, nickname, hashPw(password), Date.now());
  const id = Number(r.lastInsertRowid);
  startSession(res, id, true);
  broadcast({ type: 'user', user: pubUser(stmt.userById.get(id)) });
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  if (limited(req)) return bad(res, '잠시 후 다시 시도해 주세요.', 429);
  const username = String(req.body.username || '').toLowerCase();
  const password = String(req.body.password || '');
  const u = stmt.userByName.get(username);
  const ok = checkPw(password, u ? u.pw_hash : DUMMY_HASH) && u;
  if (!ok) return bad(res, '아이디 또는 비밀번호가 맞지 않아요.', 401);
  startSession(res, u.id, !!req.body.remember);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const tok = parseCookies(req.headers.cookie).sid;
  if (tok) stmt.delSession.run(tok);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/state', auth, (req, res) => {
  const me = req.user.id;
  res.json({
    me: { id: me, nickname: req.user.nickname, username: req.user.username },
    users: stmt.allUsers.all().map(pubUser),
    convs: stmt.myConvs.all(me).map((c) => pubConv(c, me))
  });
});

app.get('/api/convs/:id/messages', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!stmt.isMember.get(id, req.user.id)) return bad(res, '참여 중인 채팅이 아니에요.', 403);
  const before = Number(req.query.before) || 0;
  res.json({ messages: stmt.msgs.all(id, before, before).map(pubMsg) });
});

function notifyConv(convId, userIds) {
  for (const uid of userIds) {
    const c = stmt.convById.get(convId);
    sendTo(uid, { type: 'conv', conv: pubConv(c, uid) });
  }
}

app.post('/api/rooms', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const visibility = req.body.visibility === 'private' ? 'private' : 'public';
  if (!name || [...name].length > 30) return bad(res, '채팅방 이름은 1~30자로 입력해 주세요.');
  const invite = [...new Set((Array.isArray(req.body.invite) ? req.body.invite : []).map(Number))]
    .filter((id) => id !== req.user.id && stmt.userById.get(id)).slice(0, 100);
  const convId = tx(() => {
    const r = stmt.insertConv.run('room', name, visibility, visibility === 'public' ? newCode() : null, req.user.id, null, Date.now());
    const id = Number(r.lastInsertRowid);
    stmt.addMember.run(id, req.user.id, 0);
    for (const u of invite) stmt.addMember.run(id, u, 0);
    return id;
  });
  notifyConv(convId, memberIds(convId));
  res.json({ id: convId });
});

app.post('/api/rooms/join', auth, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const c = stmt.convByCode.get(code);
  if (!c || c.visibility !== 'public') return bad(res, '초대 코드를 찾을 수 없어요.', 404);
  stmt.addMember.run(c.id, req.user.id, 0);
  notifyConv(c.id, memberIds(c.id));
  res.json({ id: c.id });
});

app.post('/api/dm', auth, (req, res) => {
  const other = Number(req.body.userId);
  if (!other || other === req.user.id || !stmt.userById.get(other)) return bad(res, '대화할 친구를 찾을 수 없어요.', 404);
  const key = [req.user.id, other].sort((a, b) => a - b).join('-');
  let c = stmt.convByDm.get(key);
  if (!c) {
    const id = tx(() => {
      const r = stmt.insertConv.run('dm', null, null, null, null, key, Date.now());
      const cid = Number(r.lastInsertRowid);
      stmt.addMember.run(cid, req.user.id, 0);
      stmt.addMember.run(cid, other, 0);
      return cid;
    });
    c = stmt.convById.get(id);
    notifyConv(id, [req.user.id, other]);
  }
  res.json({ id: c.id });
});

function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

app.post('/api/convs/:id/images', auth, express.raw({ type: () => true, limit: MAX_IMG }), (req, res) => {
  const convId = Number(req.params.id);
  if (!stmt.isMember.get(convId, req.user.id)) return bad(res, '참여 중인 채팅이 아니에요.', 403);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return bad(res, '이미지를 선택해 주세요.');
  const ext = sniffImage(buf);
  if (!ext) return bad(res, 'JPG, PNG, GIF, WEBP 이미지만 보낼 수 있어요.');
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  const now = Date.now();
  const r = stmt.insertImg.run(convId, req.user.id, '', now, name);
  stmt.markRead.run(convId, convId, req.user.id);
  const msg = pubMsg(stmt.msgById.get(Number(r.lastInsertRowid)));
  for (const mid of memberIds(convId)) sendTo(mid, { type: 'message', message: msg });
  res.json({ ok: true });
});

app.get('/api/images/:name', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{32}\.(jpg|png|gif|webp)$/.test(name)) return bad(res, '없는 이미지예요.', 404);
  const row = stmt.imgMsg.get(name);
  if (!row) return bad(res, '없는 이미지예요.', 404);
  if (!stmt.isMember.get(row.conv_id, req.user.id)) return bad(res, '볼 수 없는 이미지예요.', 403);
  res.setHeader('Content-Type', MIME[name.split('.')[1]]);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(UPLOAD_DIR, name));
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return bad(res, '이미지는 5MB 이하만 보낼 수 있어요.', 413);
  if (err) return bad(res, '요청을 처리하지 못했어요.');
  next();
});
app.use('/api', (req, res) => bad(res, '없는 요청이에요.', 404));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const user = req.url === '/ws' ? userFromReq(req) : null;
  // 같은 사이트에서 연결한 경우만 허용 (CSWSH 방지)
  const origin = req.headers.origin;
  const sameOrigin = !origin || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
  if (!user || !sameOrigin) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.userId = user.id; wss.emit('connection', ws); });
});

wss.on('connection', (ws) => {
  const uid = ws.userId;
  ws.alive = true;
  let set = sockets.get(uid);
  if (!set) sockets.set(uid, (set = new Set()));
  set.add(ws);
  if (set.size === 1) broadcast({ type: 'presence', userId: uid, online: true, lastSeen: Date.now() });

  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const convId = Number(m.convId);
    if (!convId || !stmt.isMember.get(convId, uid)) return;
    if (m.type === 'send') {
      const text = String(m.text || '').replace(/\r\n/g, '\n').trim();
      if (!text || [...text].length > MAX_MSG) return;
      const r = stmt.insertMsg.run(convId, uid, text, Date.now());
      stmt.markRead.run(convId, convId, uid);
      const msg = pubMsg({ id: Number(r.lastInsertRowid), conv_id: convId, user_id: uid, text, created_at: Date.now() });
      for (const mid of memberIds(convId)) sendTo(mid, { type: 'message', message: msg, cid: m.cid || null });
    } else if (m.type === 'edit' || m.type === 'delete') {
      const row = stmt.msgById.get(Number(m.id));
      if (!row || row.conv_id !== convId || row.user_id !== uid || row.deleted) return;
      if (m.type === 'edit') {
        const text = String(m.text || '').replace(/\r\n/g, '\n').trim();
        if (row.image || !text || [...text].length > MAX_MSG) return;
        stmt.editMsg.run(text, Date.now(), row.id);
      } else {
        stmt.delMsg.run(row.id);
        if (row.image) fs.rm(path.join(UPLOAD_DIR, row.image), () => {});
      }
      const msg = pubMsg(stmt.msgById.get(row.id));
      for (const mid of memberIds(convId)) sendTo(mid, { type: 'message_update', message: msg });
    } else if (m.type === 'read') {
      stmt.markRead.run(convId, convId, uid);
    }
  });
  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) {
      sockets.delete(uid);
      const now = Date.now();
      stmt.setLastSeen.run(now, uid);
      broadcast({ type: 'presence', userId: uid, online: false, lastSeen: now });
    }
  });
  ws.on('error', () => {});
});

// 끊어진 연결 정리 (30초마다 ping)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`디톡 서버 실행 중: http://localhost:${PORT} (사용자 ${stmt.userCount.get().n}명)`));
}
module.exports = { server, db };
