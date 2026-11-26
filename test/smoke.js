'use strict';
// 서버를 임시 DB로 띄워 핵심 기능(가입/로그인/방/DM/실시간/온라인 표시)을 점검하는 스모크 테스트
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const PORT = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtalk-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: path.join(tmp, 't.db') }, stdio: ['ignore', 'pipe', 'inherit']
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(cookie, p, body) {
  const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: body && JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], json: await r.json() };
}
function connect(cookie) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie } });
    ws.events = [];
    ws.on('message', (d) => ws.events.push(JSON.parse(d)));
    ws.on('open', () => res(ws)); ws.on('error', rej);
  });
}

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/'); break; } catch { await sleep(100); } }
  const a = await call('', '/api/signup', { nickname: '제현', username: 'jehyun', password: 'password123' });
  const b = await call('', '/api/signup', { nickname: '민준', username: 'minjun', password: 'password123' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await call('', '/api/signup', { nickname: 'x', username: 'jehyun', password: 'password123' })).status, 409, '중복 아이디');
  assert.equal((await call('', '/api/signup', { nickname: 'x', username: 'abc', password: 'password123' })).status, 400, '짧은 아이디');
  assert.equal((await call('', '/api/login', { username: 'jehyun', password: 'wrong-pass' })).status, 401, '틀린 비밀번호');
  assert.equal((await call('', '/api/state')).status, 401, '비로그인 차단');
  const login = await call('', '/api/login', { username: 'jehyun', password: 'password123', remember: true });
  assert.equal(login.status, 200);

  const wsA = await connect(a.cookie);
  const wsB = await connect(b.cookie);
  await sleep(150);
  let st = await call(a.cookie, '/api/state');
  const minjun = st.json.users.find((u) => u.nickname === '민준');
  assert.equal(minjun.online, true, '접속 중이면 온라인');

  const dm = await call(a.cookie, '/api/dm', { userId: minjun.id });
  const dm2 = await call(a.cookie, '/api/dm', { userId: minjun.id });
  assert.equal(dm.json.id, dm2.json.id, 'DM은 한 쌍당 하나');

  wsA.send(JSON.stringify({ type: 'send', convId: dm.json.id, text: '안녕!' }));
  await sleep(150);
  assert.ok(wsB.events.some((e) => e.type === 'message' && e.message.text === '안녕!'), '상대에게 실시간 전달');
  st = await call(b.cookie, '/api/state');
  assert.equal(st.json.convs.find((c) => c.id === dm.json.id).unread, 1, '안 읽은 메시지 수');
  wsB.send(JSON.stringify({ type: 'read', convId: dm.json.id }));
  await sleep(100);
  st = await call(b.cookie, '/api/state');
  assert.equal(st.json.convs.find((c) => c.id === dm.json.id).unread, 0, '읽음 처리');

  const room = await call(a.cookie, '/api/rooms', { name: '1학년 3반', visibility: 'public', invite: [minjun.id] });
  const roomInfo = (await call(a.cookie, '/api/state')).json.convs.find((c) => c.id === room.json.id);
  assert.equal(roomInfo.members.length, 2); assert.match(roomInfo.code, /^[A-Z0-9]{6}$/);
  const c3 = await call('', '/api/signup', { nickname: '서연', username: 'seoyeon', password: 'password123' });
  assert.equal((await call(c3.cookie, '/api/convs/' + room.json.id + '/messages')).status, 403, '비멤버는 읽기 불가');
  assert.equal((await call(c3.cookie, '/api/rooms/join', { code: roomInfo.code })).status, 200, '초대 코드 입장');
  const priv = await call(a.cookie, '/api/rooms', { name: '비밀', visibility: 'private', invite: [] });
  assert.equal((await call(a.cookie, '/api/state')).json.convs.find((c) => c.id === priv.json.id).code, null, '비공개 방은 코드 없음');

  wsA.send(JSON.stringify({ type: 'send', convId: room.json.id, text: '단체방 첫 메시지' }));
  await sleep(150);
  const hist = await call(b.cookie, '/api/convs/' + room.json.id + '/messages');
  assert.equal(hist.json.messages.length, 1);

  wsB.close();
  await sleep(200);
  assert.ok(wsA.events.some((e) => e.type === 'presence' && e.userId === minjun.id && e.online === false), '오프라인 알림');
  st = await call(a.cookie, '/api/state');
  assert.equal(st.json.users.find((u) => u.id === minjun.id).online, false);
  console.log('모든 스모크 테스트 통과');
})().then(() => { srv.kill(); process.exit(0); }, (e) => { console.error(e); srv.kill(); process.exit(1); });
