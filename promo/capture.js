'use strict';
// 홍보영상용: 데모 데이터를 넣은 실제 디톡 서버를 띄우고, 실제 앱 화면을 고해상도로 캡처해요.
// 실행: NODE_PATH=$(npm root -g) node promo/capture.js
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dtalk-promo-'));
const DB = path.join(TMP, 'promo.db');
const PORT = 3790;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meta = {};

function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}

async function makePhoto(browser) {
  // 사진 메시지로 쓸 "식물 성장 실험 결과" 그래프 이미지
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await p.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&display=swap" rel="stylesheet">
  <style>body{margin:0;width:1200px;height:900px;background:#FBFAF6;font-family:'Noto Sans KR';color:#1F2430}
  .w{padding:70px 80px}h1{margin:0;font-size:52px;font-weight:900;letter-spacing:-1.5px}p{margin:10px 0 0;font-size:26px;color:#5B6172}
  .chart{margin-top:60px;height:520px;display:flex;align-items:flex-end;gap:56px;border-bottom:4px solid #1F2430;padding:0 30px;position:relative}
  .g{flex:1;display:flex;flex-direction:column;align-items:center;gap:14px}.bar{width:100%;border-radius:14px 14px 0 0}
  .v{font-size:30px;font-weight:700}.l{position:absolute;bottom:-62px;font-size:26px;font-weight:700}
  .lab{display:flex;gap:56px;padding:0 30px;margin-top:16px}.lab div{flex:1;text-align:center;font-size:26px;font-weight:700}
  </style></head><body><div class="w"><h1>식물 성장 실험 결과</h1><p>2주 동안 키 변화 (cm) · 과학 수행평가 3모둠</p>
  <div class="chart">
   <div class="g"><div class="v">4.2</div><div class="bar" style="height:150px;background:#C7CCFF"></div></div>
   <div class="g"><div class="v">7.8</div><div class="bar" style="height:280px;background:#8B93F8"></div></div>
   <div class="g"><div class="v">12.6</div><div class="bar" style="height:452px;background:#4F46E5"></div></div>
   <div class="g"><div class="v">9.1</div><div class="bar" style="height:326px;background:#12B76A"></div></div>
  </div><div class="lab"><div>그늘</div><div>창가</div><div>햇빛+물</div><div>LED</div></div></div></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await sleep(300);
  const buf = await p.screenshot({ type: 'jpeg', quality: 90 });
  await p.close();
  return buf;
}

async function seed(photo) {
  process.env.DB_PATH = DB;
  const { ready } = require(path.join(ROOT, 'server.js'));
  await ready;
  const { createClient } = require(path.join(ROOT, 'node_modules', '@libsql', 'client'));
  const db = createClient({ url: 'file:' + DB });
  const x = (sql, args = []) => db.execute({ sql, args });
  const now = Date.now();
  const M = 60000;
  // 아이디를 7~13으로 맞추면 아바타 색이 목업과 같아져요
  const users = [[7, 'jehyun', '제현'], [8, 'minjun', '민준'], [9, 'seoyeon', '서연'], [10, 'jiwoo', '지우'], [11, 'sunwoo', '선우'], [12, 'haeun', '하은'], [13, 'doyoon', '도윤']];
  const pw = hashPw('password123');
  const lastSeen = { 12: now - 22 * 3600 * 1000, 13: now - 2 * 3600 * 1000 };
  for (const [id, u, n] of users) {
    await x('INSERT INTO users (id, username, nickname, pw_hash, last_seen, created_at) VALUES (?,?,?,?,?,?)', [id, u, n, pw, lastSeen[id] || now - 5 * M, now - 30 * 86400000]);
    await x('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', ['promo-' + u, id, now + 86400000]);
  }
  const convs = [
    [7, 'room', '1학년 3반', 'public', 'K7M3QX', 7, null],
    [8, 'room', '게임 개발 동아리', 'public', 'G4ME2D', 11, null],
    [9, 'room', '과학 수행평가 팀', 'private', null, 9, null],
    [10, 'dm', null, null, null, null, '7-8'],
    [11, 'dm', null, null, null, null, '7-9'],
    [12, 'dm', null, null, null, null, '7-13'],
    [13, 'dm', null, null, null, null, '7-12']
  ];
  for (const c of convs) await x('INSERT INTO convs (id, kind, name, visibility, code, owner_id, dm_key, created_at) VALUES (?,?,?,?,?,?,?,?)', [...c, now - 20 * 86400000]);
  const members = { 7: [7, 8, 9, 10, 11, 12, 13], 8: [7, 8, 10, 11, 12], 9: [7, 9, 10, 13], 10: [7, 8], 11: [7, 9], 12: [7, 13], 13: [7, 12] };
  for (const [cid, us] of Object.entries(members)) for (const u of us) await x('INSERT INTO members (conv_id, user_id, last_read) VALUES (?,?,0)', [cid, u]);
  let mid = 100;
  const msg = async (conv, user, text, ago, extra = {}) => {
    mid++;
    await x('INSERT INTO messages (id, conv_id, user_id, text, created_at, edited_at, image, file, file_name, file_size) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [mid, conv, user, text, now - ago, extra.edited ? now - ago + M : null, extra.image || null, extra.file || null, extra.fileName || null, extra.fileSize || null]);
    return mid;
  };
  // 1학년 3반
  await msg(7, 10, '6교시 끝나고 청소 당번 확인해 줘!', 95 * M);
  await msg(7, 12, '나 이번 주 칠판 담당이야', 92 * M);
  await msg(7, 9, '내일 1교시 전에 디벗 충전해 오래요', 18 * M);
  await msg(7, 8, '헐 나 충전기 안 가져왔는데', 15 * M);
  // 게임 개발 동아리
  await msg(8, 10, '캐릭터 스프라이트 다 그렸어', 70 * M);
  const g2 = await msg(8, 11, '이번 주 금요일 테스트 가능?', 48 * M);
  // 과학 수행평가 팀
  await msg(9, 9, '보고서 초안 올렸어요', 80 * M);
  await msg(9, 7, '확인했어, 결론 부분만 같이 다듬자', 76 * M);
  // 1:1
  await msg(10, 8, '점심 같이 먹을래?', 260 * M);
  await msg(10, 7, '좋아, 급식실 앞에서 보자', 259 * M);
  await msg(11, 9, '수행평가 자료 보내줄게', 41 * M);
  const hwp = 'a1'.repeat(16) + '.hwp';
  await x('INSERT INTO images (name, conv_id, mime, data) VALUES (?,?,?,?)', [hwp, 11, 'application/x-hwp', Buffer.alloc(184 * 1024, 7)]);
  await msg(11, 9, '', 40 * M, { file: hwp, fileName: '과학 수행평가_탐구계획서.hwp', fileSize: 184 * 1024 });
  const jpg = 'b2'.repeat(16) + '.jpg';
  await x('INSERT INTO images (name, conv_id, mime, data) VALUES (?,?,?,?)', [jpg, 11, 'image/jpeg', photo]);
  await msg(11, 9, '', 39 * M, { image: jpg });
  await msg(12, 7, '숙제 다 했어?', 170 * M);
  await msg(12, 13, '응 방금 끝냈어. 내일 보자', 140 * M);
  await msg(13, 12, '어제 알려준 문제 풀이 고마워!', 20 * 3600 * 1000);
  // 다른 사람들은 모두 읽음, 제현은 동아리방 1개·서연 DM 2개 안 읽음
  await x('UPDATE members SET last_read = 999');
  await x('UPDATE members SET last_read = ? WHERE conv_id = 8 AND user_id = 7', [g2 - 1]);
  await x('UPDATE members SET last_read = ? WHERE conv_id = 11 AND user_id = 7', [mid - 2]);
  db.close();
}

async function main() {
  const browser = await chromium.launch();
  const photo = await makePhoto(browser);
  fs.writeFileSync(path.join(SHOTS, 'photo.jpg'), photo);
  await seed(photo);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/healthz'); break; } catch { await sleep(150); } }

  const ctxOpts = { locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
  async function userPage(username, opts = {}) {
    const ctx = await browser.newContext({ ...ctxOpts, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...opts });
    await ctx.addCookies([{ name: 'sid', value: 'promo-' + username, url: BASE }]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('[pageerror]', username, e.message));
    await p.goto(BASE);
    await p.waitForSelector('.app');
    await p.evaluate(() => document.fonts.ready);
    return p;
  }
  async function snap(p, name, boxes = {}) {
    await sleep(250);
    await p.screenshot({ path: path.join(SHOTS, name + '.png') });
    const m = {};
    for (const [k, sel] of Object.entries(boxes)) {
      const loc = typeof sel === 'string' ? p.locator(sel).first() : sel;
      const b = await loc.boundingBox().catch(() => null);
      if (b) m[k] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    }
    meta[name] = m;
    console.log('snap', name);
  }
  const say = (p, convId, text) => p.evaluate(([c, t]) => wsSend({ type: 'send', convId: c, text: t }), [convId, text]);

  // 로그인 · 회원가입 (로그인 전 화면)
  {
    const ctx = await browser.newContext({ ...ctxOpts, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.waitForSelector('#id');
    await p.evaluate(() => document.fonts.ready);
    await p.fill('#id', 'jehyun');
    await p.fill('#pw', 'password123');
    await p.locator('#pw').blur();
    await snap(p, 'login', { form: '.form', button: '.btn-primary' });
    await p.click('button:has-text("회원가입")');
    await p.fill('#nick', '하린');
    await p.fill('#uid', 'harin03');
    await p.click('text=중복 확인');
    await p.waitForSelector('.hint.ok');
    await p.fill('#pw1', 'harin2026!!');
    await p.locator('#pw1').dispatchEvent('input');
    await p.fill('#pw2', 'harin2026!!');
    await p.check('.signup input[type=checkbox]');
    await p.locator('#pw2').blur();
    await snap(p, 'signup', { form: '.form', hint: '.hint.ok', meter: '.meter' });
    await ctx.close();
  }

  // 접속 중인 친구들
  const friends = {};
  for (const u of ['minjun', 'seoyeon', 'jiwoo', 'sunwoo']) friends[u] = await userPage(u, { viewport: { width: 900, height: 700 } });

  // 제현 (메인 화면)
  const me = await userPage('jehyun', { deviceScaleFactor: 2 });
  await me.context().grantPermissions(['notifications']);
  await sleep(600);
  await snap(me, 'home', { banner: '.online-banner', list: '.list', newBtn: '.btn-new' });

  // 단체 채팅: 1학년 3반
  await me.click('button.row:has-text("1학년 3반")');
  await me.waitForSelector('.m');
  await snap(me, 'room_0', { msgs: '.msgs', composer: '.comp-box', people: '.people', header: '.chat-h', banner: '.online-banner' });
  const typed = '나 여분 있어, 점심때 빌려줄게';
  const steps = ['나', '나 여', '나 여분', '나 여분 있', '나 여분 있어,', '나 여분 있어, 점', '나 여분 있어, 점심', '나 여분 있어, 점심때', '나 여분 있어, 점심때 빌', '나 여분 있어, 점심때 빌려', '나 여분 있어, 점심때 빌려줄', typed];
  for (let i = 0; i < steps.length; i++) {
    await me.fill('#msg', steps[i]);
    await sleep(60);
    await me.screenshot({ path: path.join(SHOTS, `type_${String(i).padStart(2, '0')}.png`) });
  }
  meta.type = { count: steps.length };
  console.log('snap type x' + steps.length);
  const count = () => me.locator('.msgs .m').count();
  let n = await count();
  await me.keyboard.press('Enter');
  await me.waitForFunction((k) => document.querySelectorAll('.msgs .m').length > k, n);
  await snap(me, 'room_1', { last: '.msgs .m:last-child .b', composer: '.comp-box', msgs: '.msgs' });
  n = await count();
  await say(friends.jiwoo, 7, '나도 여분 하나 있어! 필요하면 말해');
  await me.waitForFunction((k) => document.querySelectorAll('.msgs .m').length > k, n);
  await snap(me, 'room_2', { last: '.msgs .m:last-child .col', msgs: '.msgs' });
  n = await count();
  await say(friends.sunwoo, 7, '내일 체육복도 챙겨야 해 ㅋㅋ');
  await me.waitForFunction((k) => document.querySelectorAll('.msgs .m').length > k, n);
  await snap(me, 'room_3', {
    last: '.msgs .m:last-child .col', msgs: '.msgs', people: '.people', online: '.people .pg.on', offline: '.people .pg.off',
    dot1: '.people .person:nth-of-type(1) .dot', header: '.chat-h', banner: '.online-banner', composer: '.comp-box'
  });

  // 접속 상태: 도윤이 들어옴
  friends.doyoon = await userPage('doyoon', { viewport: { width: 900, height: 700 } });
  await me.waitForFunction(() => /온라인 · 6/.test(document.querySelector('.people .pg.on')?.textContent || ''));
  await snap(me, 'presence_1', { people: '.people', online: '.people .pg.on', doyoon: '.people button.person:has-text("도윤")', header: '.chat-h', banner: '.online-banner' });

  // 친구 탭
  await me.click('button[aria-label="친구"]');
  await sleep(300);
  await snap(me, 'friends', { list: '.list', side: '.side' });

  // 새 채팅방 만들기
  await me.click('button[aria-label="채팅"]');
  await me.click('.btn-new');
  await me.waitForSelector('.modal');
  await snap(me, 'modal_0', { modal: '.modal', chips: '.chips', name: '#rn' });
  for (const [i, t] of [[1, '점심 같이'], [2, '점심 같이 먹는 모임']].entries()) { await me.fill('#rn', t[1]); await snap(me, 'modal_' + (i + 1), { modal: '.modal', chips: '.chips', name: '#rn' }); }
  let k = 3;
  for (const nm of ['민준', '서연', '지우']) {
    await me.click(`.chip:has-text("${nm}")`);
    await snap(me, 'modal_' + k++, { modal: '.modal', chips: '.chips', ok: '.modal .ok' });
  }
  await me.click('.modal .ok');
  await me.waitForSelector('.codebox');
  await snap(me, 'modal_done', { header: '.chat-h', codebox: '.codebox', people: '.people', list: '.list' });

  // 1:1 대화: 서연 (사진, 파일, 수정, 전송 취소)
  await me.click('button.row:has-text("서연")');
  await me.waitForSelector('.filecard');
  await me.waitForFunction(() => [...document.querySelectorAll('.b.img img')].every((i) => i.complete && i.naturalWidth));
  await snap(me, 'dm_0', { file: '.filecard', photo: '.b.img', header: '.chat-h', msgs: '.msgs' });
  n = await count();
  await me.fill('#msg', '고마워! 내일 3교시에 같이 정리하자');
  await me.keyboard.press('Enter');
  await me.waitForFunction((q) => document.querySelectorAll('.msgs .m').length > q, n);
  await me.hover('.msgs .m.me:last-child .bw');
  await me.click('.msgs .m.me:last-child .mm-b');
  await snap(me, 'dm_menu', { menu: '.msgs .m.me:last-child .mm-p', bubble: '.msgs .m.me:last-child .b', file: '.filecard', photo: '.b.img' });
  await me.click('.msgs .m.me:last-child .mm-p button:has-text("수정")');
  await me.fill('.edit-in', '고마워! 내일 점심시간에 같이 정리하자');
  await snap(me, 'dm_edit', { bubble: '.msgs .m.me:last-child .b' });
  await me.keyboard.press('Enter');
  await me.waitForFunction(() => /수정됨/.test(document.querySelector('.msgs .m.me:last-child .t')?.textContent || ''));
  await me.mouse.move(5, 5);
  await snap(me, 'dm_edited', { bubble: '.msgs .m.me:last-child .b', time: '.msgs .m.me:last-child .t' });
  n = await count();
  await me.fill('#msg', '그래프 내가 뽑아올게요ㅛ');
  await me.keyboard.press('Enter');
  await me.waitForFunction((q) => document.querySelectorAll('.msgs .m').length > q, n);
  await me.mouse.move(5, 5);
  await snap(me, 'dm_typo', { bubble: '.msgs .m.me:last-child .b' });
  me.once('dialog', (d) => d.accept());
  await me.hover('.msgs .m.me:last-child .bw');
  await me.click('.msgs .m.me:last-child .mm-b');
  await snap(me, 'dm_menu2', { menu: '.msgs .m.me:last-child .mm-p', bubble: '.msgs .m.me:last-child .b' });
  await me.click('.msgs .m.me:last-child .mm-p button.danger');
  await me.waitForSelector('.msgs .m.me:last-child .b.gone');
  await me.mouse.move(5, 5);
  await snap(me, 'dm_deleted', { bubble: '.msgs .m.me:last-child .b' });

  // 설정 (알림 켜기)
  await me.click('button[aria-label="설정"]');
  await sleep(500);
  await snap(me, 'settings', { side: '.side', push: '.btn-install, .btn-line' });

  // 모바일 화면
  {
    const ctx = await browser.newContext({ ...ctxOpts, viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: 'sid', value: 'promo-jehyun', url: BASE }]);
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.waitForSelector('.app');
    await p.evaluate(() => document.fonts.ready);
    await sleep(500);
    await snap(p, 'mobile_list');
    await p.click('button.row:has-text("1학년 3반")');
    await p.waitForSelector('.m');
    await sleep(300);
    await snap(p, 'mobile_room');
    await p.click('.back-m');
    await p.click('button.row:has-text("서연")');
    await p.waitForSelector('.filecard');
    await p.waitForFunction(() => [...document.querySelectorAll('.b.img img')].every((i) => i.complete && i.naturalWidth));
    await sleep(300);
    await snap(p, 'mobile_dm');
    await ctx.close();
  }

  fs.writeFileSync(path.join(SHOTS, 'meta.json'), JSON.stringify(meta, null, 1));
  await browser.close();
  srv.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
