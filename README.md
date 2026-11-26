# 디톡 (schoolchat)

학교 디벗(태블릿/노트북)에서 친구와 채팅하는 웹 앱입니다.
브라우저만 있으면 설치 없이 쓸 수 있어요.

## 기능
- 회원가입 / 로그인 (아이디 중복 확인, 비밀번호 강도 표시, 로그인 상태 유지)
- 채팅방 만들기 (공개 = 초대 코드로 입장 / 비공개 = 초대만) + 단체 채팅
- 1:1 개인 채팅 (친구 탭 또는 참여자 목록에서 바로 시작)
- 메시지 수정, 전송 취소(모두에게서 삭제), 사진 보내기(JPG/PNG/GIF/WEBP, 2MB 이하, 큰 사진은 자동 축소)
- 실시간 메시지 (WebSocket), 안 읽은 메시지 수, 메시지 검색, 이전 메시지 더 보기
- 온라인 / 오프라인 표시와 "마지막 접속" 시간

## 기술 스택
Node.js 18+ · Express · ws(WebSocket) · SQLite/libSQL(`@libsql/client`, 클라우드는 Turso) · 순수 HTML/CSS/JS(빌드 없음)

## 실행
```bash
npm install
npm start          # http://localhost:3000
```
```bash
npm test           # 백엔드 스모크 테스트
```

환경 변수: `PORT`(기본 3000), `DB_PATH`(로컬 파일 위치, 기본 `data/schoolchat.db`), `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`(클라우드 DB), `NODE_ENV=production`(HTTPS 전용 쿠키).

## 구조
```
server.js          API + WebSocket + DB(libSQL/Turso)
public/            index.html, style.css, app.js (SPA)
test/smoke.js      핵심 기능 자동 점검
```

## 보안 메모
비밀번호는 scrypt로 해시, 로그인 세션은 HttpOnly 쿠키, 모든 사용자 입력은 `textContent`로만 출력(XSS 방지),
WebSocket은 같은 사이트·로그인된 사용자만 연결, 로그인/가입 시도 횟수 제한이 들어 있습니다.

## 약관 · 개인정보처리방침 · 운영정책
`/terms.html`(이용약관·운영정책), `/privacy.html`(개인정보처리방침)이 들어 있어요. 가입 화면과 설정에서 연결돼요.
운영자 이름과 문의 이메일은 환경 변수 `OPERATOR_NAME`, `CONTACT_EMAIL`로 채워져요(안 넣으면 "미설정"으로 보여요).
앱의 [설정] → [회원 탈퇴]로 계정과 내가 보낸 메시지·사진·1:1 대화를 삭제할 수 있어요.
> 초안이에요. 실제 운영 전에 학교/선생님과 내용을 확인하세요. 특히 만 14세 미만 이용자의 보호자 동의 방식은 학교 방침에 맞춰야 해요.

## 무료로 배포하기 (Render 무료 + Turso 무료 DB)
채팅 기록·계정·사진은 모두 **Turso**(무료 클라우드 DB)에 저장돼서, Render 서버가 재시작/잠들어도 사라지지 않아요.

1. **Turso**(turso.tech) 가입(카드 불필요) → Create Database(지역: Tokyo 추천) → 데이터베이스 주소(`libsql://...`)와 토큰(Generate Token) 복사
2. **Render**(render.com) → New → **Blueprint** → 이 저장소 선택 → `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`에 위 값을 입력
3. 배포가 끝나면 나오는 주소(`https://dtalk.onrender.com` 등)로 접속
4. (권장) **UptimeRobot**(무료)에서 `https://<내 주소>/healthz`를 5분마다 확인하도록 등록 → 서버가 잠들지 않아요.
   등록하지 않으면 15분간 아무도 안 쓸 때 서버가 잠들고, 다음 접속 때 켜지는 데 약 30초~1분 걸려요(데이터는 유지).

`OPERATOR_NAME`, `CONTACT_EMAIL`도 함께 입력해 주세요.

로컬에서는 Turso 환경 변수가 없으면 `data/schoolchat.db` 파일에 저장해요.
사진은 2MB 이하(큰 사진은 자동 축소)이고 DB에 저장돼요. Turso 무료 용량은 약 5GB예요.
서버는 1대만 돌려야 해요(접속 상태를 메모리에서 관리).
