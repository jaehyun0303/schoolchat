// 운영자 정보는 Render 환경 변수(OPERATOR_NAME, CONTACT_EMAIL)에서 가져와 채워요.
fetch('/api/config').then((r) => r.json()).then((c) => {
  document.querySelectorAll('[data-op]').forEach((el) => { el.textContent = c.operator || '[운영자 이름 미설정]'; });
  document.querySelectorAll('[data-contact]').forEach((el) => { el.textContent = c.contact || '[문의 이메일 미설정]'; });
}).catch(() => {});
