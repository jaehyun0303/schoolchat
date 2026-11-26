# 디톡 홍보영상

실제 앱 화면으로 만드는 모션그래픽 홍보영상(1920×1080, 30fps, 약 52초)이에요.

1. `capture.js`: 데모 데이터(학생 7명, 채팅방, 1:1 대화, 사진, 파일)를 넣은 실제 디톡 서버를 띄우고, 실제 화면을 고해상도로 캡처해 `shots/`에 저장해요.
2. `video.html`: 캡처한 화면으로 만든 모션그래픽 구성(장면, 카메라 줌, 자막)이에요. 문구나 타이밍은 여기서 고치면 돼요.
3. `render.js`: 프레임 단위로 렌더링해서 `out/dtalk-promo.mp4`를 만들어요(ffmpeg 필요).

```bash
NODE_PATH=$(npm root -g) node promo/capture.js
```
```bash
NODE_PATH=$(npm root -g) node promo/render.js
```
```bash
NODE_PATH=$(npm root -g) node promo/render.js --stills 5,16,24
```
