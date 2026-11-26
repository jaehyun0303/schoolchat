'use strict';
// 서버를 임시 DB로 띄워 핵심 기능(가입/로그인/방/DM/실시간/온라인 표시)을 점검하는 스모크 테스트
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PORT = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtalk-'));
// 푸시 서비스 흉내(https). 서버가 알림을 실제로 보내는지 확인하려고 자체 서명 인증서를 써요.
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtalk-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certDir, 'k.pem'), '-out', path.join(certDir, 'c.pem'),
  '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
const PUSH_PORT = PORT + 100;
const pushHits = [];
const pushSrv = https.createServer({ key: fs.readFileSync(path.join(certDir, 'k.pem')), cert: fs.readFileSync(path.join(certDir, 'c.pem')) }, (req, res) => {
  pushHits.push({ url: req.url, auth: req.headers.authorization }); req.resume(); res.statusCode = 201; res.end();
}).listen(PUSH_PORT);
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: path.join(tmp, 't.db'), PUSH_TEST_HOST: 'localhost:' + PUSH_PORT, NODE_EXTRA_CA_CERTS: path.join(certDir, 'c.pem') }, stdio: ['ignore', 'pipe', 'inherit']
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


  // --- 수정 / 전송 취소 / 이미지 ---
  const rid = room.json.id;
  const first = hist.json.messages[0];
  wsB.close();
  const wsB2 = await connect(b.cookie);
  wsB2.send(JSON.stringify({ type: 'edit', convId: rid, id: first.id, text: '남의 글 수정' }));
  wsB2.send(JSON.stringify({ type: 'delete', convId: rid, id: first.id }));
  await sleep(150);
  assert.equal((await call(a.cookie, '/api/convs/' + rid + '/messages')).json.messages[0].text, '단체방 첫 메시지', '남의 메시지는 수정/삭제 불가');
  wsA.send(JSON.stringify({ type: 'edit', convId: rid, id: first.id, text: '수정된 메시지' }));
  await sleep(150);
  assert.ok(wsB2.events.some((e) => e.type === 'message_update' && e.message.text === '수정된 메시지' && e.message.editedAt), '수정 실시간 전달');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(base + `/api/convs/${rid}/images`, { method: 'POST', headers: { cookie: a.cookie }, body: png });
  assert.equal(up.status, 200, '이미지 업로드');
  const bad = await fetch(base + `/api/convs/${rid}/images`, { method: 'POST', headers: { cookie: a.cookie }, body: Buffer.from('<svg onload=alert(1)>') });
  assert.equal(bad.status, 400, '이미지가 아니면 거부');
  const msgs = (await call(b.cookie, '/api/convs/' + rid + '/messages')).json.messages;
  const im = msgs.find((m) => m.image);
  assert.ok(im, '이미지 메시지 존재');
  assert.equal((await fetch(base + im.image, { headers: { cookie: b.cookie } })).status, 200, '멤버는 이미지 열람');
  assert.equal((await fetch(base + im.image, { headers: { cookie: '' } })).status, 401, '비로그인은 이미지 열람 불가');
  const outsider = await call('', '/api/signup', { nickname: '외부', username: 'outsider', password: 'password123' });
  assert.equal((await fetch(base + im.image, { headers: { cookie: outsider.cookie } })).status, 403, '비멤버는 이미지 열람 불가');
  wsA.send(JSON.stringify({ type: 'delete', convId: rid, id: im.id }));
  await sleep(150);
  assert.equal((await fetch(base + im.image, { headers: { cookie: b.cookie } })).status, 404, '전송 취소하면 이미지 접근 불가');
  const after = (await call(b.cookie, '/api/convs/' + rid + '/messages')).json.messages.find((m) => m.id === im.id);
  assert.equal(after.deleted, true); assert.equal(after.image, null);

  // --- 파일 전송 ---
  const up2 = (cookie, name, body) => fetch(base + `/api/convs/${rid}/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie }, body });
  assert.equal((await up2(a.cookie, '악성.exe', Buffer.from('MZ'))).status, 400, '실행 파일 거부');
  assert.equal((await up2(a.cookie, 'x.html', Buffer.from('<script>'))).status, 400, 'html 거부');
  assert.equal((await up2(a.cookie, 'pdf', Buffer.from('x'))).status, 400, '확장자 없는 파일 거부');
  assert.equal((await up2(a.cookie, '큰파일.zip', Buffer.alloc(3 * 1024 * 1024 + 10))).status, 413, '3MB 초과 거부');
  assert.equal((await up2(a.cookie, '과제 보고서.pdf', Buffer.from('%PDF-1.4 test'))).status, 200, '파일 업로드');
  const fmsg = (await call(b.cookie, '/api/convs/' + rid + '/messages')).json.messages.find((m) => m.file);
  assert.equal(fmsg.file.name, '과제 보고서.pdf');
  const dl = await fetch(base + fmsg.file.url, { headers: { cookie: b.cookie } });
  assert.equal(dl.status, 200, '멤버는 다운로드');
  assert.match(dl.headers.get('content-disposition'), /^attachment/, '항상 다운로드로');
  assert.equal(await dl.text(), '%PDF-1.4 test');
  assert.equal((await fetch(base + fmsg.file.url, { headers: { cookie: outsider.cookie } })).status, 403, '비멤버 다운로드 불가');
  assert.ok(wsB2.events.some((e) => e.type === 'message' && e.message.file), '파일 메시지 실시간 전달');

  // --- 푸시 알림 ---
  assert.ok((await call(b.cookie, '/api/push/key')).json.key.length > 40, 'VAPID 공개키');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const sub = { endpoint: `https://localhost:${PUSH_PORT}/push/abc`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.equal((await call(b.cookie, '/api/push/subscribe', { subscription: { endpoint: 'https://127.0.0.1/evil', keys: sub.keys } })).status, 400, '허용되지 않은 알림 주소 거부');
  assert.equal((await call(b.cookie, '/api/push/subscribe', { subscription: sub })).status, 200, '알림 구독');
  wsA.send(JSON.stringify({ type: 'send', convId: rid, text: '알림 테스트' }));
  await sleep(600);
  assert.equal(pushHits.length, 1, '받는 사람에게만 푸시 1건');
  assert.match(pushHits[0].auth, /^vapid /, 'VAPID 서명 포함');
  await call(b.cookie, '/api/push/unsubscribe', { endpoint: sub.endpoint });
  wsA.send(JSON.stringify({ type: 'send', convId: rid, text: '구독 해제 후' }));
  await sleep(400);
  assert.equal(pushHits.length, 1, '구독 해제 후에는 푸시 없음');

  // --- 회원 탈퇴 ---
  assert.equal((await call(outsider.cookie, '/api/me/delete', { password: 'wrong-password' })).status, 401, '탈퇴 시 비밀번호 확인');
  assert.equal((await call(a.cookie, '/api/me/delete', { password: 'password123' })).status, 200, '탈퇴 성공');
  assert.equal((await call(a.cookie, '/api/state')).status, 401, '탈퇴 후 세션 무효');
  st = await call(b.cookie, '/api/state');
  assert.ok(!st.json.users.some((u) => u.nickname === '제현'), '탈퇴한 사용자는 목록에서 사라짐');
  assert.ok(!st.json.convs.some((c) => c.id === dm.json.id), '탈퇴한 사용자와의 1:1 대화 삭제');
  assert.equal((await call(b.cookie, '/api/convs/' + rid + '/messages')).json.messages.length, 0, '탈퇴한 사용자의 메시지 삭제');
  assert.equal((await call('', '/api/login', { username: 'jehyun', password: 'password123' })).status, 401, '탈퇴 후 로그인 불가');
  assert.equal((await (await fetch(base + '/api/config')).json()).operator, '', '설정 API');
  for (const pg of ['/terms.html', '/privacy.html']) assert.equal((await fetch(base + pg)).status, 200, pg);

  wsB2.close();
  await sleep(200);
  st = await call(c3.cookie, '/api/state');
  assert.equal(st.json.users.find((u) => u.id === minjun.id).online, false, '접속 종료 후 오프라인');
  console.log('모든 스모크 테스트 통과');
})().then(() => { srv.kill(); pushSrv.close(); process.exit(0); }, (e) => { console.error(e); srv.kill(); process.exit(1); });
