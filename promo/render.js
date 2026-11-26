'use strict';
// 홍보영상 렌더링: video.html을 프레임 단위로 캡처해 ffmpeg로 MP4를 만들어요.
// 사용: NODE_PATH=$(npm root -g) node promo/render.js            → promo/out/dtalk-promo.mp4
//      NODE_PATH=$(npm root -g) node promo/render.js --stills 5,16,24  → 해당 초의 정지 화면 PNG
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const DIR = __dirname;
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
const meta = fs.readFileSync(path.join(DIR, 'shots', 'meta.json'), 'utf8');
const html = fs.readFileSync(path.join(DIR, 'video.html'), 'utf8').replace('__META__', meta);
const built = path.join(DIR, '_build.html');
fs.writeFileSync(built, html);

(async () => {
  const args = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--disable-web-security', '--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + built);
  await page.evaluate(() => window.ready());
  const FPS = 30;
  const dur = await page.evaluate(() => window.DURATION);

  if (args[0] === '--stills') {
    for (const s of args[1].split(',').map(Number)) {
      await page.evaluate((t) => window.render(t), s);
      await page.screenshot({ path: path.join(OUT, `still_${String(s).replace('.', '_')}.png`) });
      console.log('still', s);
    }
    await browser.close();
    return;
  }

  const total = Math.round(dur * FPS);
  const file = path.join(OUT, 'dtalk-promo.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('done', file);
})().catch((e) => { console.error(e); process.exit(1); });
