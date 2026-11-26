# 디톡 (schoolchat)

학교 디벗(태블릿/노트북)에서 친구와 채팅하는 웹 앱입니다.
브라우저만 있으면 설치 없이 쓸 수 있어요.

## 기능
- 회원가입 / 로그인 (아이디 중복 확인, 비밀번호 강도 표시, 로그인 상태 유지)
- 채팅방 만들기 (공개 = 초대 코드로 입장 / 비공개 = 초대만) + 단체 채팅
- 1:1 개인 채팅 (친구 탭 또는 참여자 목록에서 바로 시작)
- 실시간 메시지 (WebSocket), 안 읽은 메시지 수, 메시지 검색, 이전 메시지 더 보기
- 온라인 / 오프라인 표시와 "마지막 접속" 시간

## 기술 스택
Node.js 22.13+ · Express · ws(WebSocket) · SQLite(Node 내장 `node:sqlite`) · 순수 HTML/CSS/JS(빌드 없음)

## 실행
```bash
npm install
npm start          # http://localhost:3000
```
```bash
npm test           # 백엔드 스모크 테스트
```

환경 변수: `PORT`(기본 3000), `DB_PATH`(기본 `data/schoolchat.db`), `NODE_ENV=production`(HTTPS 전용 쿠키).

## 구조
```
server.js          API + WebSocket + SQLite
public/            index.html, style.css, app.js (SPA)
test/smoke.js      핵심 기능 자동 점검
```

## 보안 메모
비밀번호는 scrypt로 해시, 로그인 세션은 HttpOnly 쿠키, 모든 사용자 입력은 `textContent`로만 출력(XSS 방지),
WebSocket은 같은 사이트·로그인된 사용자만 연결, 로그인/가입 시도 횟수 제한이 들어 있습니다.
