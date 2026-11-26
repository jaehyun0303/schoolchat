'use strict';
/* 디톡 프론트엔드 — 빌드 없이 동작하는 단일 파일 SPA */

// ---------- 유틸 ----------
const $ = (sel, el = document) => el.querySelector(sel);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
function fill(el, ...kids) { el.replaceChildren(); add(el, kids); }
function svg(markup, size = 22, stroke = 'currentColor', sw = 1.8) {
  const t = document.createElement('template');
  t.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;
  return t.content.firstChild;
}
const IC = {
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  friends: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.7 3 2.4 3 5.2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  clip: '<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6C3.9 9.3 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>'
};

const PALETTE = [['#E0E7FF', '#3730A3'], ['#DBF3E6', '#14633C'], ['#FDE7D9', '#8A3A12'], ['#E4E1FB', '#4B3AA8'],
  ['#D9EEF8', '#14597A'], ['#F8E1EA', '#8E2A52'], ['#EDEFF4', '#4A5062']];
const colorOf = (id) => PALETTE[Math.abs(id) % PALETTE.length];
const firstChar = (s) => [...(s || '?')][0];

function avatar(kind, id, label, size, online) {
  const [bg, fg] = colorOf(id);
  const el = h('span', { class: 'av', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` },
    h('span', { class: 'av-c' + (kind === 'room' ? ' sq' : ''), style: `background:${bg};color:${fg}` }, kind === 'room' ? '#' : firstChar(label)));
  if (online !== undefined) el.append(h('span', { class: 'dot ' + (online ? 'on' : 'off'), role: 'img', 'aria-label': online ? '온라인' : '오프라인' }));
  return el;
}

function fmtTime(at) {
  return new Date(at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}
function dayKey(at) { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(at) {
  const d = new Date(at), now = new Date();
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function listTime(at) {
  const d = dayLabel(at);
  if (d === '오늘') return fmtTime(at);
  if (d === '어제') return '어제';
  const x = new Date(at);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}
function ago(at) {
  if (!at) return '접속 기록 없음';
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const days = Math.floor(s / 86400);
  return days === 1 ? '어제' : `${days}일 전`;
}

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  let data = {};
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) {
    const err = new Error(data.error || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2800);
}

// ---------- 상태 ----------
const S = {
  me: null,
  users: new Map(),
  convs: new Map(),
  msgs: new Map(),     // convId -> 메시지 배열
  more: new Map(),
  editing: null,     // convId -> 더 불러올 메시지가 있는지
  active: null,
  nav: 'chats',        // chats | friends | settings
  tab: 'all',
  q: '',
  find: '',
  drafts: new Map(),
  ws: null,
  wsTimer: null,
  retry: 0
};
const root = $('#root');

// ---------- 인증 화면 ----------
function brandPanel(kind) {
  const logo = h('div', { class: 'logo' }, h('div', { class: 'logo-mark' }, svg(IC.chat, 24, '#fff', 2)), h('span', { class: 'logo-name' }, '디톡'));
  if (kind === 'login') {
    const row = (n, i, on, text) => h('div', { class: 'fstat-row' },
      h('span', { class: 'av', style: 'width:36px;height:36px;font-size:15px;--ring:#222638' },
        h('span', { class: 'av-c', style: `background:${colorOf(i)[0]};color:${colorOf(i)[1]}` }, n),
        h('span', { class: 'dot ' + (on ? 'on' : 'off'), style: 'width:12px;height:12px;right:-2px;bottom:-2px' })),
      h('span', { class: 'nm' }, n === '민' ? '민준' : n === '서' ? '서연' : '도윤'),
      h('span', { class: 'st', style: `color:${on ? '#6EE7A8' : '#B4BACB'}` }, text));
    return h('section', { class: 'brand' }, logo,
      h('h1', null, '친구랑 바로 이어지는', h('br'), '우리 반 채팅'),
      h('p', null, '디벗으로 로그인하고 채팅방을 만들고, 친구와 1:1로 대화해 보세요. 친구가 지금 접속 중인지도 바로 보여요.'),
      h('div', { class: 'brand-foot' }, h('div', { class: 'fstat' },
        h('div', { class: 'fstat-h' }, '친구 상태'),
        row('민', 1, true, '온라인'), row('서', 2, true, '온라인'), row('도', 6, false, '2시간 전 접속'))));
  }
  const feat = (icon, title, desc) => h('div', { class: 'feat-i' },
    h('div', { class: 'ic' }, icon), h('div', null, h('b', null, title), h('span', { class: 'd' }, desc)));
  return h('section', { class: 'brand' }, logo,
    h('h1', null, '1분이면 끝나는', h('br'), '가입, 바로 시작해요'),
    h('p', null, '닉네임과 비밀번호만 정하면 돼요. 가입하고 나면 친구를 찾아 대화를 시작할 수 있어요.'),
    h('div', { class: 'brand-foot' }, h('div', { class: 'feat' },
      feat(svg(IC.friends, 20, '#C7CCFF'), '채팅방 만들기', '반, 동아리, 팀별로 방을 만들어요'),
      feat(svg(IC.chat, 20, '#C7CCFF'), '1:1 개인 채팅', '친구와 조용히 따로 이야기해요'),
      feat(h('span', { style: 'width:14px;height:14px;border-radius:50%;background:#12B76A;box-shadow:0 0 0 3px #2F3560' }), '온라인 · 오프라인 표시', '친구가 접속 중인지 한눈에 봐요'))));
}

function pwField(id, placeholder, autocomplete) {
  const input = h('input', { id, class: 'inp', type: 'password', placeholder, autocomplete, required: true, maxlength: 100 });
  let shown = false;
  const btn = h('button', { type: 'button', class: 'pw-eye', 'aria-label': '비밀번호 보기' }, svg(IC.eye, 20, '#5B6172'));
  btn.addEventListener('click', () => {
    shown = !shown;
    input.type = shown ? 'text' : 'password';
    btn.setAttribute('aria-label', shown ? '비밀번호 숨기기' : '비밀번호 보기');
    btn.replaceChildren(svg(shown ? IC.eyeOff : IC.eye, 20, '#5B6172'));
  });
  return { input, node: h('div', { class: 'pw-wrap' }, input, btn) };
}

function showLogin() {
  const err = h('div', { class: 'err', role: 'alert' });
  const id = h('input', { id: 'id', class: 'inp', type: 'text', placeholder: '아이디를 입력하세요', autocomplete: 'username', required: true, autocapitalize: 'none', maxlength: 20 });
  const pw = pwField('pw', '비밀번호를 입력하세요', 'current-password');
  const remember = h('input', { type: 'checkbox', checked: true });
  const submit = h('button', { class: 'btn-primary', type: 'submit' }, '로그인');
  const form = h('form', { class: 'form', novalidate: true },
    h('h2', null, '다시 만나서 반가워요'), h('p', { class: 'sub' }, '디톡 계정으로 로그인하세요.'), err,
    h('label', { class: 'l', for: 'id' }, '아이디'), id,
    h('label', { class: 'l', for: 'pw' }, '비밀번호'), pw.node,
    h('div', { class: 'row-between' }, h('label', { class: 'chk' }, remember, '로그인 상태 유지')),
    submit,
    h('div', { class: 'divider' }, h('i'), h('span', null, '처음이신가요?'), h('i')),
    h('button', { type: 'button', class: 'btn-line', onclick: showSignup }, '회원가입'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('on');
    if (!id.value.trim() || !pw.input.value) { err.textContent = '아이디와 비밀번호를 입력해 주세요.'; err.classList.add('on'); return; }
    submit.disabled = true;
    try {
      await api('/api/login', { username: id.value.trim(), password: pw.input.value, remember: remember.checked });
      await boot();
    } catch (ex) { err.textContent = ex.message; err.classList.add('on'); submit.disabled = false; }
  });
  root.replaceChildren(h('main', { class: 'auth' }, brandPanel('login'), h('section', { class: 'form-side' }, form)));
  id.focus();
}

function showSignup() {
  const err = h('div', { class: 'err', role: 'alert' });
  const nick = h('input', { id: 'nick', class: 'inp', type: 'text', placeholder: '예: 제현', maxlength: 12, autocomplete: 'nickname', required: true });
  const uid = h('input', { id: 'uid', class: 'inp', type: 'text', placeholder: '영문, 숫자 4자 이상', autocomplete: 'username', autocapitalize: 'none', maxlength: 20, required: true });
  const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
  const pw1 = pwField('pw1', '8자 이상', 'new-password');
  const bars = [h('i'), h('i'), h('i')];
  const lvl = h('span');
  const pw2 = h('input', { id: 'pw2', class: 'inp', type: 'password', placeholder: '비밀번호를 한 번 더 입력', autocomplete: 'new-password', maxlength: 100, required: true });
  const terms = h('input', { type: 'checkbox' });
  const submit = h('button', { class: 'btn-primary', type: 'submit' }, '가입하고 시작하기');
  let idOk = false, checkedFor = '';

  async function checkId() {
    const v = uid.value.trim().toLowerCase();
    if (!v) { hint.className = 'hint'; hint.replaceChildren(); return false; }
    try {
      const r = await api('/api/username-check?u=' + encodeURIComponent(v));
      idOk = r.ok; checkedFor = v;
      hint.className = 'hint ' + (r.ok ? 'ok' : 'no');
      hint.replaceChildren(...(r.ok ? [svg(IC.check, 16, '#067647', 2.4), '사용할 수 있는 아이디예요'] : [r.reason]));
      return r.ok;
    } catch (ex) { hint.className = 'hint no'; hint.textContent = ex.message; return false; }
  }
  uid.addEventListener('input', () => { idOk = false; hint.className = 'hint'; hint.replaceChildren(); });
  uid.addEventListener('blur', () => { if (uid.value.trim()) checkId(); });
  pw1.input.addEventListener('input', () => {
    const p = pw1.input.value;
    let score = 0;
    if (p.length >= 8) score++;
    if (/[a-z]/i.test(p) && /\d/.test(p)) score++;
    if (p.length >= 12 || /[^a-z0-9]/i.test(p)) score++;
    if (!p) score = 0;
    bars.forEach((b, i) => b.classList.toggle('on', i < score));
    lvl.textContent = !p ? '' : ['약함', '약함', '보통', '강함'][score];
  });

  const form = h('form', { class: 'form signup', novalidate: true },
    h('button', { type: 'button', class: 'back', onclick: showLogin }, svg(IC.back, 18, '#5B6172', 2), '로그인으로'),
    h('h2', { style: 'margin-top:4px' }, '회원가입'),
    h('p', { class: 'sub', style: 'margin:8px 0 20px' }, '친구들이 알아볼 수 있는 닉네임을 정해 주세요.'), err,
    h('label', { class: 'l', for: 'nick', style: 'margin-bottom:6px' }, '닉네임'), nick,
    h('label', { class: 'l', for: 'uid', style: 'margin-bottom:6px' }, '아이디'),
    h('div', { class: 'inline' }, uid, h('button', { type: 'button', class: 'btn-ghost', style: 'height:50px', onclick: checkId }, '중복 확인')), hint,
    h('label', { class: 'l', for: 'pw1', style: 'margin-bottom:6px' }, '비밀번호'), pw1.node,
    h('div', { class: 'meter', style: 'margin-top:8px' }, ...bars, lvl),
    h('label', { class: 'l', for: 'pw2', style: 'margin-bottom:6px' }, '비밀번호 확인'), pw2,
    h('label', { class: 'chk', style: 'margin-bottom:0' }, terms, h('span', null, h('a', { href: '/terms.html', target: '_blank', style: 'text-decoration:underline' }, '이용약관·운영정책'), '과 ', h('a', { href: '/privacy.html', target: '_blank', style: 'text-decoration:underline' }, '개인정보처리방침'), '에 동의해요')),
    h('div', { class: 'hint', style: 'margin:0 0 6px 30px;min-height:0;font-size:12px' }, '만 14세 미만은 보호자(법정대리인) 동의가 필요할 수 있어요.'),
    submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('on');
    const fail = (m) => { err.textContent = m; err.classList.add('on'); };
    const name = nick.value.trim();
    if (!name) return fail('닉네임을 입력해 주세요.');
    const u = uid.value.trim().toLowerCase();
    if (!(idOk && checkedFor === u) && !(await checkId())) return fail('사용할 수 있는 아이디를 입력해 주세요.');
    if (pw1.input.value.length < 8) return fail('비밀번호는 8자 이상이어야 해요.');
    if (pw1.input.value !== pw2.value) return fail('비밀번호 확인이 일치하지 않아요.');
    if (!terms.checked) return fail('이용약관과 개인정보 처리에 동의해 주세요.');
    submit.disabled = true;
    try {
      await api('/api/signup', { nickname: name, username: u, password: pw1.input.value });
      await boot();
    } catch (ex) { fail(ex.message); submit.disabled = false; }
  });
  root.replaceChildren(h('main', { class: 'auth signup' }, brandPanel('signup'), h('section', { class: 'form-side' }, form)));
  nick.focus();
}

// ---------- 데이터 헬퍼 ----------
const user = (id) => S.users.get(id) || { id, nickname: '알 수 없음', online: false, lastSeen: 0 };
const peerOf = (c) => user(c.members.find((m) => m !== S.me.id) ?? S.me.id);
const convName = (c) => (c.kind === 'dm' ? peerOf(c).nickname : c.name);
const activeConv = () => S.convs.get(S.active);
const sortedConvs = () => [...S.convs.values()].sort((a, b) => (b.last?.at || b.createdAt) - (a.last?.at || a.createdAt));
const previewOf = (m) => (m.deleted ? '삭제된 메시지입니다' : m.image ? '사진을 보냈어요' : m.file ? '파일: ' + m.file.name : m.text.replace(/\s+/g, ' '));
const totalUnread = () => [...S.convs.values()].reduce((n, c) => n + c.unread, 0);

function updateTitle() {
  const n = totalUnread();
  document.title = (n ? `(${n}) ` : '') + '디톡';
}

// ---------- 앱 화면 ----------
let el = {}; // 자주 쓰는 DOM 참조

function buildApp() {
  const railBtn = (key, label, icon) => {
    const b = h('button', { class: 'rail-b', 'aria-label': label, title: label, onclick: () => { S.nav = key; S.q = ''; el.search.value = ''; renderAll(); } }, svg(icon, 22));
    b.dataset.nav = key;
    return b;
  };
  el.railBadge = h('span', { class: 'badge', hidden: true });
  const chatBtn = railBtn('chats', '채팅', IC.chat);
  chatBtn.append(el.railBadge);
  el.rail = h('nav', { class: 'rail', 'aria-label': '메인 메뉴' },
    h('div', { class: 'logo-mark' }, svg(IC.chat, 24, '#fff', 2)),
    chatBtn, railBtn('friends', '친구', IC.friends), railBtn('settings', '설정', IC.settings),
    h('div', { style: 'flex:1' }),
    (el.meAv = h('span')));

  el.sideTitle = h('h1');
  el.newBtn = h('button', { class: 'btn-new', onclick: openModal }, svg(IC.plus, 18, '#fff', 2.2), '새 채팅방');
  el.search = h('input', { id: 'q', type: 'text', placeholder: '채팅방, 친구 검색', autocomplete: 'off' });
  el.search.addEventListener('input', () => { S.q = el.search.value.trim().toLowerCase(); renderSide(); });
  el.tabs = h('div', { class: 'tabs' });
  el.banner = h('div', { class: 'online-banner' });
  el.list = h('div', { class: 'list' });
  el.side = h('aside', { class: 'side' },
    h('div', { class: 'side-h' }, el.sideTitle, el.newBtn),
    h('div', { class: 'search' }, svg(IC.search, 18, '#5B6172', 2), h('label', { class: 'sr', for: 'q' }, '채팅방, 친구 검색'), el.search),
    el.tabs, el.banner, el.list);

  el.chatH = h('header', { class: 'chat-h' });
  el.findBar = h('div', { class: 'find' });
  el.findInp = h('input', { class: 'inp', type: 'search', placeholder: '이 대화에서 메시지 검색', 'aria-label': '메시지 검색' });
  el.findInp.addEventListener('input', () => { S.find = el.findInp.value.trim().toLowerCase(); renderMessages(false); });
  el.findBar.append(el.findInp);
  el.msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  el.input = h('textarea', { id: 'msg', rows: 1, placeholder: '메시지를 입력하세요', maxlength: 1000 });
  el.sendBtn = h('button', { class: 'send', type: 'submit', 'aria-label': '보내기', disabled: true }, svg(IC.send, 20, '#fff', 2));
  el.input.addEventListener('input', () => {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
    el.sendBtn.disabled = !el.input.value.trim();
    if (S.active) S.drafts.set(S.active, el.input.value);
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  el.composer = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); sendMessage(); } },
    h('div', { class: 'comp-box' },
      (el.attachBtn = h('button', { type: 'button', class: 'attach', 'aria-label': '사진·파일 보내기', title: '사진·파일 보내기', onclick: () => el.file.click() }, svg(IC.clip, 22, '#4A5062'))),
      (el.file = h('input', { type: 'file', hidden: true, onchange: () => { sendAttachment(el.file.files[0]); el.file.value = ''; } })),
      h('label', { class: 'sr', for: 'msg' }, '메시지 입력'), el.input, el.sendBtn));
  el.conn = h('div', { class: 'conn', hidden: true, role: 'status' }, '연결이 끊겼어요. 다시 연결하는 중…');
  el.chat = h('main', { class: 'chat' });
  el.people = h('aside', { class: 'people', 'aria-label': '참여자' });

  el.app = h('div', { class: 'app' }, el.rail, el.side, el.chat, el.people, el.conn);
  root.replaceChildren(el.app);
}

function renderAll() {
  renderRail(); renderSide(); renderChat(); renderPeople(); updateTitle();
}

function renderRail() {
  el.rail.querySelectorAll('.rail-b').forEach((b) => b.classList.toggle('act', b.dataset.nav === S.nav));
  const n = totalUnread();
  el.railBadge.hidden = !n;
  el.railBadge.textContent = n > 99 ? '99+' : n;
  el.meAv.replaceWith((el.meAv = (() => {
    const a = avatar('dm', S.me.id, S.me.nickname, 44, true);
    a.style.setProperty('--ring', '#171A26');
    a.title = S.me.nickname + ' (온라인)';
    return a;
  })()));
}

function convRow(c) {
  const isDm = c.kind === 'dm';
  const peer = isDm ? peerOf(c) : null;
  const last = c.last;
  let preview = '아직 대화가 없어요';
  if (last) preview = (last.userId === S.me.id ? '나: ' : isDm ? '' : user(last.userId).nickname + ': ') + previewOf(last);
  const row = h('button', { class: 'row' + (c.id === S.active ? ' act' : ''), onclick: () => openConv(c.id), 'aria-current': c.id === S.active ? 'true' : null },
    avatar(isDm ? 'dm' : 'room', isDm ? peer.id : c.id, convName(c), 44, isDm ? peer.online : undefined),
    h('span', { class: 'mid' },
      h('span', { class: 'l1' }, h('span', { class: 'nm' }, convName(c)), h('span', { class: 'tm' }, last ? listTime(last.at) : '')),
      h('span', { class: 'l2' }, h('span', { class: 'ls' }, preview), c.unread > 0 && h('span', { class: 'unread' }, c.unread > 99 ? '99+' : c.unread))));
  return row;
}

function renderSide() {
  const q = S.q;
  const onlineCount = [...S.users.values()].filter((u) => u.online && u.id !== S.me.id).length;
  el.banner.hidden = S.nav === 'settings';
  el.banner.replaceChildren(h('i'), `지금 온라인인 친구 ${onlineCount}명`);

  if (S.nav === 'settings') {
    el.sideTitle.textContent = '설정';
    el.newBtn.hidden = true; el.tabs.hidden = true; el.search.parentElement.hidden = true;
    el.list.replaceChildren(h('div', { class: 'settings' },
      h('div', { class: 'me-card' }, avatar('dm', S.me.id, S.me.nickname, 52, true), h('div', null, h('b', null, S.me.nickname), h('span', null, '@' + S.me.username))),
      h('button', { class: 'btn-out', onclick: logout }, '로그아웃'),
      pushSection(),
      installEvt && h('button', { class: 'btn-install', onclick: async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderSide(); } }, '앱으로 설치하기'),
      !installEvt && !matchMedia('(display-mode: standalone)').matches && h('p', { class: 'install-hint' }, '앱으로 쓰려면 브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 눌러요.'),
      h('div', { class: 'legal-links' }, h('a', { href: '/terms.html', target: '_blank' }, '이용약관·운영정책'), h('a', { href: '/privacy.html', target: '_blank' }, '개인정보처리방침')),
      h('button', { class: 'btn-del', onclick: deleteAccount }, '회원 탈퇴')));
    return;
  }
  el.search.parentElement.hidden = false;

  if (S.nav === 'friends') {
    el.sideTitle.textContent = '친구';
    el.newBtn.hidden = true; el.tabs.hidden = true;
    const others = [...S.users.values()].filter((u) => u.id !== S.me.id && u.nickname.toLowerCase().includes(q));
    const on = others.filter((u) => u.online), off = others.filter((u) => !u.online);
    const row = (u) => h('button', { class: 'row', onclick: () => openDm(u.id) },
      avatar('dm', u.id, u.nickname, 44, u.online),
      h('span', { class: 'mid' }, h('span', { class: 'l1' }, h('span', { class: 'nm' }, u.nickname)),
        h('span', { class: 'l2' }, h('span', { class: 'ls', style: u.online ? 'color:#067647;font-weight:500' : '' }, u.online ? '온라인' : '마지막 접속 ' + ago(u.lastSeen)))));
    fill(el.list,
      !others.length && h('div', { class: 'empty' }, q ? '검색 결과가 없어요.' : '아직 다른 친구가 가입하지 않았어요. 친구에게 디톡을 알려 주세요!'),
      on.length > 0 && h('div', { class: 'sec', style: 'color:#067647' }, `온라인 · ${on.length}`), on.map(row),
      off.length > 0 && h('div', { class: 'sec' }, `오프라인 · ${off.length}`), off.map(row));
    return;
  }

  el.sideTitle.textContent = '채팅';
  el.newBtn.hidden = false; el.tabs.hidden = false;
  fill(el.tabs, [['all', '전체'], ['room', '채팅방'], ['dm', '개인']].map(([k, label]) =>
    h('button', { class: 'tab' + (S.tab === k ? ' act' : ''), 'aria-pressed': String(S.tab === k), onclick: () => { S.tab = k; renderSide(); } }, label)));

  const all = sortedConvs().filter((c) => convName(c).toLowerCase().includes(q));
  const rooms = S.tab !== 'dm' ? all.filter((c) => c.kind === 'room') : [];
  const dms = S.tab !== 'room' ? all.filter((c) => c.kind === 'dm') : [];
  const joinInp = h('input', { class: 'inp', placeholder: '초대 코드 입력', maxlength: 6, 'aria-label': '초대 코드' });
  const joinForm = h('form', { class: 'join', onsubmit: async (e) => {
    e.preventDefault();
    if (!joinInp.value.trim()) return;
    try { const r = await api('/api/rooms/join', { code: joinInp.value }); await refreshState(); openConv(r.id); toast('채팅방에 입장했어요!'); }
    catch (ex) { toast(ex.message); }
  } }, joinInp, h('button', { type: 'submit' }, '입장'));
  fill(el.list,
    S.tab !== 'dm' && h('div', { class: 'sec' }, '채팅방'), rooms.map(convRow),
    S.tab !== 'dm' && !rooms.length && !q && h('div', { class: 'empty', style: 'padding:12px 20px' }, '참여 중인 채팅방이 없어요.', h('br'), "'새 채팅방'으로 만들어 보세요."),
    S.tab !== 'dm' && joinForm,
    S.tab !== 'room' && h('div', { class: 'sec', style: 'padding-top:14px' }, '개인 채팅'), dms.map(convRow),
    S.tab !== 'room' && !dms.length && !q && h('div', { class: 'empty', style: 'padding:12px 20px' }, "'친구' 탭에서 친구를 눌러 1:1 대화를 시작해 보세요."));
}

function headerSub(c) {
  if (c.kind === 'dm') {
    const p = peerOf(c);
    return { text: p.online ? '온라인' : '오프라인 · 마지막 접속 ' + ago(p.lastSeen), on: p.online };
  }
  const on = c.members.filter((id) => user(id).online).length;
  return { text: `멤버 ${c.members.length}명 · 온라인 ${on}명`, on: false };
}

function renderChat() {
  const c = activeConv();
  el.app.classList.toggle('show-chat', !!c);
  if (!c) {
    el.chat.replaceChildren(h('div', { class: 'noconv' }, h('div', { class: 'logo-mark' }, svg(IC.chat, 32, '#fff', 2)), '대화를 선택하거나 새 채팅방을 만들어 보세요.'));
    return;
  }
  if (el.chat.firstChild !== el.chatH || el.chat.childElementCount !== 4) {
    el.chat.replaceChildren(el.chatH, el.findBar, el.msgs, el.composer);
  }
  renderChatHeader();
  renderMessages(true);
}

function renderChatHeader() {
  const c = activeConv();
  if (!c) return;
  const sub = headerSub(c);
  const isDm = c.kind === 'dm';
  const peer = isDm ? peerOf(c) : null;
  el.chatH.replaceChildren(
    h('button', { class: 'icon-b back-m', 'aria-label': '목록으로', onclick: () => { S.active = null; renderAll(); } }, svg(IC.back, 20, '#3A3F52', 2)),
    avatar(isDm ? 'dm' : 'room', isDm ? peer.id : c.id, convName(c), 44, isDm ? peer.online : undefined),
    h('div', { class: 'mid' }, h('h2', null, convName(c)), h('div', { class: 'sub' + (sub.on ? ' on' : '') }, sub.text)),
    h('button', { class: 'icon-b', 'aria-label': '메시지 검색', 'aria-expanded': String(el.findBar.classList.contains('on')), onclick: () => {
      const on = el.findBar.classList.toggle('on');
      if (on) el.findInp.focus(); else { el.findInp.value = ''; S.find = ''; renderMessages(false); }
      renderChatHeader();
    } }, svg(IC.search, 20, '#3A3F52', 2)));
}

function highlight(node, text, q) {
  if (!q) { node.textContent = text; return; }
  const lower = text.toLowerCase();
  let i = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j < 0) break;
    node.append(text.slice(i, j), h('mark', null, text.slice(j, j + q.length)));
    i = j + q.length;
  }
  node.append(text.slice(i));
}

function renderMessages(scrollEnd) {
  const c = activeConv();
  if (!c) return;
  const list = S.msgs.get(c.id);
  const box = el.msgs;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevTop = box.scrollTop;
  const stick = scrollEnd || nearBottom;
  const nodes = [];
  if (!list) { box.replaceChildren(h('div', { class: 'day' }, '불러오는 중…')); return; }
  if (S.more.get(c.id)) nodes.push(h('button', { class: 'day', style: 'border:0;cursor:pointer', onclick: loadOlder }, '이전 메시지 더 보기'));
  if (!list.length) nodes.push(h('div', { class: 'day' }, c.kind === 'dm' ? `${convName(c)}님에게 첫 메시지를 보내 보세요` : '첫 메시지를 보내 보세요'));
  let lastDay = '';
  for (const m of list) {
    if (S.find && !m.text.toLowerCase().includes(S.find)) continue;
    const dk = dayKey(m.at);
    if (dk !== lastDay) { nodes.push(h('div', { class: 'day' }, dayLabel(m.at))); lastDay = dk; }
    const me = m.userId === S.me.id;
    const u = user(m.userId);
    let body;
    if (m.deleted) body = h('div', { class: 'b gone' }, '삭제된 메시지입니다');
    else if (S.editing === m.id) body = editBox(m);
    else if (m.image) {
      const img = h('img', { src: m.image, alt: '보낸 사진', loading: 'lazy' });
      img.addEventListener('load', () => { if (stick) box.scrollTop = box.scrollHeight; });
      body = h('a', { class: 'b img', href: m.image, target: '_blank', rel: 'noopener', 'aria-label': '사진 크게 보기' }, img);
    } else if (m.file) {
      body = h('a', { class: 'b filecard', href: m.file.url, download: m.file.name, 'aria-label': m.file.name + ' 다운로드' },
        h('span', { class: 'fic' }, svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 22, 'currentColor', 1.8)),
        h('span', { class: 'fmeta' }, h('b', null, m.file.name), h('i', null, fmtSize(m.file.size) + ' · 눌러서 받기')));
    } else { body = h('div', { class: 'b' }); highlight(body, m.text, S.find); }
    const canAct = me && !m.deleted && S.editing !== m.id;
    const menu = canAct && msgMenu(m);
    nodes.push(h('div', { class: 'm' + (me ? ' me' : '') },
      !me && avatar('dm', u.id, u.nickname, 34),
      h('div', { class: 'col' },
        !me && c.kind === 'room' && h('span', { class: 'who' }, u.nickname),
        h('div', { class: 'bw' }, menu, body),
        h('span', { class: 't' }, fmtTime(m.at), m.editedAt && !m.deleted && ' · 수정됨'))));
  }
  box.replaceChildren(...nodes);
  if (scrollEnd || nearBottom) box.scrollTop = box.scrollHeight;
  else box.scrollTop = prevTop; // 위치 유지
}

function msgMenu(m) {
  const wrap = h('div', { class: 'mm' });
  const btn = h('button', { class: 'mm-b', type: 'button', 'aria-label': '메시지 메뉴', 'aria-haspopup': 'true' }, svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', 18, '#4A5062', 2.4));
  const pop = h('div', { class: 'mm-p', role: 'menu', hidden: true },
    !m.image && !m.file && h('button', { role: 'menuitem', type: 'button', onclick: () => { S.editing = m.id; renderMessages(false); const t = $('.edit-in'); t && (t.focus(), t.setSelectionRange(t.value.length, t.value.length)); } }, '수정'),
    h('button', { role: 'menuitem', type: 'button', class: 'danger', onclick: () => {
      if (confirm('이 메시지를 전송 취소할까요? 모두에게서 삭제돼요.')) wsSend({ type: 'delete', convId: m.convId, id: m.id });
    } }, '전송 취소'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll('.mm-p').forEach((x) => { x.hidden = true; });
    pop.hidden = !open;
  });
  wrap.append(btn, pop);
  return wrap;
}
document.addEventListener('click', () => document.querySelectorAll('.mm-p').forEach((x) => { x.hidden = true; }));

function editBox(m) {
  const ta = h('textarea', { class: 'edit-in', rows: 2, maxlength: 1000, 'aria-label': '메시지 수정' });
  ta.value = m.text;
  const save = () => {
    const t = ta.value.trim();
    if (!t) return toast('내용을 입력해 주세요.');
    S.editing = null;
    if (t !== m.text) wsSend({ type: 'edit', convId: m.convId, id: m.id, text: t });
    else renderMessages(false);
  };
  const cancel = () => { S.editing = null; renderMessages(false); };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
  return h('div', { class: 'b edit' }, ta,
    h('div', { class: 'edit-a' }, h('button', { type: 'button', onclick: cancel }, '취소'), h('button', { type: 'button', class: 'ok', onclick: save }, '저장')));
}

// 사진은 2MB 제한이라, 큰 사진(GIF 제외)은 브라우저에서 먼저 줄여서 보내요.
async function shrinkImage(file) {
  if (file.type === 'image/gif' || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
async function sendAttachment(file) {
  if (!file) return;
  if (file.type.startsWith('image/')) return sendImage(file);
  if (!S.active) return;
  if (file.size > 3 * 1024 * 1024) return toast('파일은 3MB 이하만 보낼 수 있어요.');
  const id = S.active;
  el.attachBtn.disabled = true;
  try {
    const res = await fetch(`/api/convs/${id}/files?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '파일을 보내지 못했어요.');
  } catch (ex) { toast(ex.message); }
  el.attachBtn.disabled = false;
}
async function sendImage(file) {
  if (!file || !S.active) return;
  if (!file.type.startsWith('image/')) return toast('이미지 파일만 보낼 수 있어요.');
  const id = S.active;
  el.attachBtn.disabled = true;
  try {
    const body = await shrinkImage(file);
    if (body.size > 2 * 1024 * 1024) throw new Error('이미지는 2MB 이하만 보낼 수 있어요.');
    const res = await fetch(`/api/convs/${id}/images`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '사진을 보내지 못했어요.');
  } catch (ex) { toast(ex.message); }
  el.attachBtn.disabled = false;
}

function renderPeople() {
  const c = activeConv();
  el.people.hidden = !c;
  if (!c) return;
  const mem = c.members.map(user).sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  const on = mem.filter((u) => u.online), off = mem.filter((u) => !u.online);
  const person = (u, offline) => {
    const inner = [avatar('dm', u.id, u.nickname, 36, u.online), h('span', { class: 'nm' }, u.nickname),
      h('span', { class: 'tg' }, u.id === S.me.id ? '나' : offline ? ago(u.lastSeen) + ' 접속' : '')];
    return u.id === S.me.id
      ? h('div', { class: 'person' + (offline ? ' offl' : '') }, ...inner)
      : h('button', { class: 'person' + (offline ? ' offl' : ''), title: `${u.nickname}님과 1:1 대화`, onclick: () => openDm(u.id) }, ...inner);
  };
  fill(el.people,
    h('h2', null, '참여자 ', h('span', null, `${mem.length}명`)),
    h('div', { class: 'pg on' }, `온라인 · ${on.length}`), on.map((u) => person(u, false)),
    h('div', { class: 'pg off' }, `오프라인 · ${off.length}`), off.map((u) => person(u, true)),
    c.code && h('div', { class: 'codebox' }, '초대 코드', h('b', null, c.code)));
}

// ---------- 동작 ----------
async function openConv(id) {
  S.active = id;
  S.find = ''; el.findInp.value = ''; el.findBar.classList.remove('on');
  if (S.nav !== 'chats') S.nav = 'chats';
  const c = S.convs.get(id);
  if (!c) return;
  renderAll();
  el.input.value = S.drafts.get(id) || '';
  el.input.dispatchEvent(new Event('input'));
  S.editing = null;
  if (!S.msgs.has(id)) await loadMessages(id);
  if (S.active === id) { markRead(id); if (matchMedia('(min-width:821px)').matches) el.input.focus(); }
}

async function loadMessages(id) {
  try {
    const { messages } = await api(`/api/convs/${id}/messages`);
    S.msgs.set(id, messages);
    S.more.set(id, messages.length >= 50);
  } catch (ex) { toast(ex.message); S.msgs.set(id, []); }
  if (S.active === id) renderMessages(true);
}

async function loadOlder() {
  const id = S.active, list = S.msgs.get(id);
  if (!list?.length) return;
  try {
    const { messages } = await api(`/api/convs/${id}/messages?before=${list[0].id}`);
    S.msgs.set(id, messages.concat(list));
    S.more.set(id, messages.length >= 50);
    const prevH = el.msgs.scrollHeight;
    renderMessages(false);
    el.msgs.scrollTop = el.msgs.scrollHeight - prevH;
  } catch (ex) { toast(ex.message); }
}

function markRead(id) {
  const c = S.convs.get(id);
  if (!c) return;
  if (c.unread > 0) { c.unread = 0; renderSide(); renderRail(); updateTitle(); }
  wsSend({ type: 'read', convId: id });
}

async function openDm(userId) {
  try { const r = await api('/api/dm', { userId }); await refreshState(); S.q = ''; el.search.value = ''; openConv(r.id); }
  catch (ex) { toast(ex.message); }
}

function wsSend(obj) {
  if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; }
  return false;
}

function sendMessage() {
  const text = el.input.value.trim();
  if (!text || !S.active) return;
  if (!wsSend({ type: 'send', convId: S.active, text })) { toast('연결이 끊겨서 보낼 수 없어요. 잠시 후 다시 시도해 주세요.'); return; }
  el.input.value = '';
  S.drafts.delete(S.active);
  el.input.dispatchEvent(new Event('input'));
}

async function logout() {
  await dropPushOnLogout();
  try { await api('/api/logout', {}); } catch { /* 무시 */ }
  S.ws && (S.ws.onclose = null, S.ws.close());
  clearTimeout(S.wsTimer);
  Object.assign(S, { me: null, active: null, nav: 'chats', ws: null });
  S.users.clear(); S.convs.clear(); S.msgs.clear(); S.more.clear(); S.drafts.clear();
  document.title = '디톡';
  showLogin();
}

async function deleteAccount() {
  if (!confirm('정말 탈퇴할까요?\n내 계정, 내가 보낸 메시지와 사진, 1:1 대화가 모두 삭제되고 되돌릴 수 없어요.')) return;
  const password = prompt('확인을 위해 비밀번호를 입력해 주세요.');
  if (!password) return;
  try { await api('/api/me/delete', { password }); } catch (ex) { return toast(ex.message); }
  try { localStorage.removeItem('push:' + S.me.id); } catch { /* 무시 */ }
  dropPushOnLogout();
  S.ws && (S.ws.onclose = null, S.ws.close());
  clearTimeout(S.wsTimer);
  Object.assign(S, { me: null, active: null, nav: 'chats', ws: null });
  S.users.clear(); S.convs.clear(); S.msgs.clear(); S.more.clear(); S.drafts.clear();
  showLogin();
  toast('탈퇴가 완료됐어요.');
}

async function refreshState() {
  const st = await api('/api/state');
  S.me = st.me;
  S.users = new Map(st.users.map((u) => [u.id, u]));
  S.convs = new Map(st.convs.map((c) => [c.id, c]));
  if (S.active && !S.convs.has(S.active)) S.active = null;
  if (el.app) renderAll();
}

// ---------- 새 채팅방 모달 ----------
function openModal() {
  const picked = new Set();
  let vis = 'public';
  const prevFocus = document.activeElement;
  const name = h('input', { id: 'rn', class: 'inp', type: 'text', placeholder: '예: 점심 같이 먹는 모임', maxlength: 30 });
  const cnt = h('em');
  const seg = h('div', { class: 'seg' });
  const chips = h('div', { class: 'chips' });
  const ok = h('button', { type: 'submit', class: 'ok' }, '채팅방 만들기');
  const err = h('div', { class: 'err', role: 'alert', style: 'margin:14px 0 0' });
  const close = () => { overlay.remove(); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const drawSeg = () => seg.replaceChildren(
    h('button', { type: 'button', class: vis === 'public' ? 'act' : '', 'aria-pressed': String(vis === 'public'), onclick: () => { vis = 'public'; drawSeg(); } }, '공개 · 초대 코드로 입장'),
    h('button', { type: 'button', class: vis === 'private' ? 'act' : '', 'aria-pressed': String(vis === 'private'), onclick: () => { vis = 'private'; drawSeg(); } }, '비공개 · 초대만'));
  const friends = [...S.users.values()].filter((u) => u.id !== S.me.id).sort((a, b) => b.online - a.online || a.nickname.localeCompare(b.nickname, 'ko'));
  const drawChips = () => {
    cnt.textContent = `${picked.size}명 선택`;
    chips.replaceChildren(...friends.map((u) => h('button', { type: 'button', class: 'chip' + (picked.has(u.id) ? ' act' : ''), 'aria-pressed': String(picked.has(u.id)),
      onclick: () => { picked.has(u.id) ? picked.delete(u.id) : picked.add(u.id); drawChips(); } },
      avatar('dm', u.id, u.nickname, 28, u.online), u.nickname)));
    if (!friends.length) chips.replaceChildren(h('div', { class: 'empty', style: 'padding:8px 0;text-align:left' }, '아직 초대할 친구가 없어요. 공개 방을 만들고 초대 코드를 공유해 보세요.'));
  };
  drawSeg(); drawChips();
  const form = h('form', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '새 채팅방 만들기', novalidate: true },
    h('div', { class: 'modal-h' }, h('h2', null, '새 채팅방 만들기'), h('button', { type: 'button', class: 'icon-b', 'aria-label': '닫기', onclick: close }, svg(IC.close, 18, '#3A3F52', 2.2))),
    h('label', { class: 'lab', for: 'rn' }, '채팅방 이름'), name,
    h('div', { class: 'lab' }, '공개 설정'), seg,
    h('div', { class: 'lab' }, '친구 초대 ', cnt), chips, err,
    h('div', { class: 'modal-f' }, h('button', { type: 'button', class: 'cancel', onclick: close }, '취소'), ok));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('on');
    if (!name.value.trim()) { err.textContent = '채팅방 이름을 입력해 주세요.'; err.classList.add('on'); name.focus(); return; }
    ok.disabled = true;
    try {
      const r = await api('/api/rooms', { name: name.value.trim(), visibility: vis, invite: [...picked] });
      await refreshState();
      close();
      openConv(r.id);
    } catch (ex) { err.textContent = ex.message; err.classList.add('on'); ok.disabled = false; }
  });
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, form);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // 포커스 가두기
      const f = [...form.querySelectorAll('button,input')].filter((x) => !x.disabled);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  el.app.append(overlay);
  name.focus();
}

// ---------- 실시간 연결 ----------
function connectWs() {
  clearTimeout(S.wsTimer);
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  S.ws = ws;
  ws.onopen = async () => {
    const reconnected = S.retry > 0;
    S.retry = 0;
    el.conn.hidden = true;
    if (reconnected) { // 끊긴 동안 놓친 내용 다시 동기화
      try {
        await refreshState();
        S.msgs.clear();
        if (S.active) { await loadMessages(S.active); markRead(S.active); }
      } catch (ex) { if (ex.status === 401) logout(); }
    }
  };
  ws.onmessage = (ev) => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if (d.type === 'presence') {
      const u = S.users.get(d.userId);
      if (u) { u.online = d.online; u.lastSeen = d.lastSeen; }
      renderSide(); renderChatHeader(); renderPeople();
    } else if (d.type === 'user') {
      S.users.set(d.user.id, d.user); renderSide();
    } else if (d.type === 'conv') {
      const old = S.convs.get(d.conv.id);
      S.convs.set(d.conv.id, old ? { ...d.conv, unread: old.unread } : d.conv);
      renderSide(); renderPeople(); renderChatHeader();
    } else if (d.type === 'message') onMessage(d.message);
    else if (d.type === 'message_update') onUpdate(d.message);
    else if (d.type === 'user_removed') { // 탈퇴한 사용자가 있으면 목록을 새로 받아와요
      S.msgs.clear();
      refreshState().then(() => { if (S.active) loadMessages(S.active); }).catch(() => {});
    }
  };
  ws.onclose = () => {
    if (!S.me) return;
    el.conn.hidden = false;
    S.retry++;
    S.wsTimer = setTimeout(connectWs, Math.min(1000 * 2 ** Math.min(S.retry, 4), 15000));
  };
}

function onMessage(m) {
  const c = S.convs.get(m.convId);
  if (!c) { refreshState().then(() => S.convs.has(m.convId) && onMessage(m)); return; }
  const list = S.msgs.get(m.convId);
  if (list && !list.some((x) => x.id === m.id)) list.push(m);
  c.last = m;
  const viewing = S.active === m.convId && !document.hidden;
  if (m.userId !== S.me.id && !viewing) c.unread++;
  if (viewing && m.userId !== S.me.id) wsSend({ type: 'read', convId: m.convId });
  renderSide(); renderRail(); updateTitle();
  if (S.active === m.convId) renderMessages(m.userId === S.me.id);
}

function onUpdate(m) {
  const list = S.msgs.get(m.convId);
  const i = list ? list.findIndex((x) => x.id === m.id) : -1;
  if (i >= 0) list[i] = m;
  const c = S.convs.get(m.convId);
  if (c && c.last && c.last.id === m.id) c.last = m;
  if (S.editing === m.id && m.deleted) S.editing = null;
  renderSide();
  if (S.active === m.convId) renderMessages(false);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && S.active) markRead(S.active); });
// '몇 분 전' 표시가 낡지 않도록 1분마다 갱신
setInterval(() => { if (S.me && el.app) { renderChatHeader(); renderPeople(); if (S.nav === 'friends') renderSide(); } }, 60000);

// ---------- 푸시 알림 ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToU8 = (b) => { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function refreshPush() {
  if (!pushSupported()) S.push = 'unsupported';
  else if (Notification.permission === 'denied') S.push = 'denied';
  else S.push = (await currentSub()) && Notification.permission === 'granted' ? 'on' : 'off';
  if (S.me && el.app && S.nav === 'settings') renderSide();
}
function pushSection() {
  const st = S.push || 'off';
  if (st === 'unsupported') return h('p', { class: 'install-hint' }, '이 브라우저는 알림을 지원하지 않아요. (아이폰/아이패드는 앱을 홈 화면에 설치해야 알림이 와요.)');
  if (st === 'denied') return h('p', { class: 'install-hint' }, '알림이 차단돼 있어요. 브라우저 주소창 왼쪽 자물쇠 → 사이트 설정에서 알림을 허용해 주세요.');
  return h('button', { class: st === 'on' ? 'btn-line' : 'btn-install', style: 'height:48px;margin-top:10px;font-size:15px', onclick: st === 'on' ? disablePush : enablePush },
    st === 'on' ? '알림 끄기' : '알림 켜기');
}
async function enablePush() {
  try {
    if ((await Notification.requestPermission()) !== 'granted') { toast('알림이 허용되지 않았어요.'); return refreshPush(); }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await api('/api/push/subscribe', { subscription: sub.toJSON() });
    try { localStorage.setItem('push:' + S.me.id, '1'); } catch { /* 무시 */ }
    toast('알림을 켰어요!');
  } catch (ex) { toast('알림을 켜지 못했어요: ' + ex.message); }
  refreshPush();
}
async function disablePush() {
  try {
    const sub = await currentSub();
    if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    try { localStorage.removeItem('push:' + S.me.id); } catch { /* 무시 */ }
  } catch { /* 무시 */ }
  refreshPush();
}
// 같은 기기를 여러 명이 쓰므로, 로그아웃하면 이 기기의 알림 연결을 끊어요
async function dropPushOnLogout() {
  try { const sub = await currentSub(); if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } } catch { /* 무시 */ }
}
// 로그인할 때, 이 사용자가 전에 알림을 켠 적이 있으면 조용히 다시 연결해요
async function restorePush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted' || localStorage.getItem('push:' + S.me.id) !== '1') return;
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await api('/api/push/subscribe', { subscription: sub.toJSON() });
  } catch { /* 무시 */ }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open-conv' && S.me && S.convs.has(Number(e.data.convId))) openConv(Number(e.data.convId));
  });
}

// ---------- 앱 설치 (PWA) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (S.me && el.app) renderSide(); });
window.addEventListener('appinstalled', () => { installEvt = null; if (S.me && el.app) renderSide(); toast('앱이 설치됐어요!'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- 시작 ----------
async function boot() {
  try {
    await api('/api/state'); // 로그인 여부 확인
  } catch (ex) { return showLogin(); }
  buildApp();
  await refreshState();
  S.retry = 0;
  renderAll();
  connectWs();
  restorePush();
  refreshPush();
  const wanted = Number(new URLSearchParams(location.search).get('conv'));
  if (wanted && S.convs.has(wanted)) { history.replaceState(null, '', '/'); openConv(wanted); }
}

boot();
