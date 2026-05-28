// examples 実機検証ハーネス（Playwright + ヘッドレス Chromium）
//
// macOS Chrome / Control_Chrome MCP が使えない Linux リモート環境向け。
// ビルド済み dist/ を Chrome 拡張として読み込み、実 github.com の blob ページで
// プレビューのボタン注入・描画・高さ追従・トグル復帰を検証し、各サンプルの
// スクリーンショットを /tmp/pw-verify/<name>.png に保存する。
//
// 実行例:
//   cd /tmp/pw-verify && npm i playwright-core
//   EXT=/abs/path/to/dist REF=main \
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   xvfb-run -a -s "-screen 0 1280x900x24" node pw-harness.mjs
//
// 環境変数:
//   EXT     拡張の dist ディレクトリ絶対パス（必須）
//   REF     検証対象の git ref（既定: main）。URL の /blob/<ref>/ に入る
//   CHROME  chromium 実行ファイル（未指定なら /opt/pw-browsers から自動探索）
//   OUTDIR  スクショ出力先（既定: /tmp/pw-verify）

import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const EXT = process.env.EXT;
if (!EXT || !existsSync(EXT)) {
  console.error(`EXT (dist path) が見つからない: ${EXT}. 先に npm run build すること`);
  process.exit(1);
}
const REF = process.env.REF || 'main';
const OUTDIR = process.env.OUTDIR || '/tmp/pw-verify';
const BASE = `https://github.com/abeyuya/github-html-preview-chrome-extension/blob/${REF}/examples`;

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  try {
    return execSync(
      'ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1',
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}
const executablePath = findChrome();
if (!executablePath || !existsSync(executablePath)) {
  console.error(`chromium が見つからない: ${executablePath}. npx playwright-core install chromium 済みか確認`);
  process.exit(1);
}

const samples = [
  // click: プレビュー内の要素を実クリックして反応を観測する（クリック透過バグ検知）
  { name: 'basic', path: 'basic.html', wait: 2500, click: { sel: '#add', listSel: '#list > li' } },
  { name: 'relative-assets', path: 'relative-assets/index.html', wait: 3500 },
  { name: 'swagger', path: 'swagger/index.html', wait: 7000 },
  // blank: プレビュー下にスクロール可能な空白が残っていないか（末尾空白エリア検知）。
  // GitHub 本来の blob セクション下端パディング（実測 ~57px）は許容し、元ソースの
  // 入れ物が残るバグ（実測 1000px超）を捉えるため maxGap は余裕をもって 150px。
  { name: 'long-content', path: 'long-content.html', wait: 3000, blank: { maxGap: 150 } },
];

// 内側 srcdoc iframe（allow-same-origin なしの opaque origin）。Playwright は
// プロトコル層でフレームに attach できるので、github.com 側 JS では読めない
// 内側 DOM もここからは観測できる。
function findInnerFrame(page) {
  return page.frames().find((f) => f.url() === 'about:srcdoc') || null;
}

const ctx = await chromium.launchPersistentContext(`${OUTDIR}/profile`, {
  executablePath,
  headless: false, // 拡張読み込みには headed が必要（xvfb 下で動かす）
  viewport: { width: 1280, height: 900 },
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
    // リモート環境はプロキシの CA を Chromium が信頼しないため必須
    '--ignore-certificate-errors',
  ],
});

const probe = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.ghp-preview-toggle-wrapper button');
    return {
      hasButton: !!b,
      wrappers: document.querySelectorAll('.ghp-preview-toggle-wrapper').length,
      overlay: !!document.querySelector('#ghp-preview-overlay'),
      ready: document.readyState,
    };
  });

const results = [];
for (const s of samples) {
  const page = await ctx.newPage();
  const r = { name: s.name };
  try {
    await page.goto(`${BASE}/${s.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let p;
    for (let i = 0; i < 20; i++) {
      p = await probe(page);
      if (p.hasButton) break;
      await page.waitForTimeout(500); // content script は document_idle 注入
    }
    r.inject = p;

    if (p.hasButton) {
      r.clickedLabel = await page.evaluate(() => {
        const b = document.querySelector('.ghp-preview-toggle-wrapper button');
        b.click();
        return b.textContent.trim();
      });
      await page.waitForTimeout(s.wait);

      r.state = await page.evaluate(() => {
        const o = document.querySelector('#ghp-preview-overlay');
        const src = document.querySelector('#read-only-cursor-text-area');
        return {
          overlayPresent: !!o,
          height: o && o.style.height,
          innerH: window.innerHeight,
          srcDisplay: src ? getComputedStyle(src).display : 'no-src-el',
        };
      });

      const inner = findInnerFrame(page);
      r.innerFrameFound = !!inner;

      // 末尾空白エリア検知: プレビュー(overlay)より下に、ページがスクロールできる
      // 余白が残っていないか。元ソース表示の入れ物（cursorContainer 等）が hide され
      // ず元の行数ぶんの高さを保持すると、プレビュー下に空白が残る（実際に発生）。
      // 内側 iframe ではなく github.com ページ全体の高さで測るのがポイント。
      if (s.blank) {
        const m = await page.evaluate(() => {
          const o = document.querySelector('#ghp-preview-overlay');
          if (!o) return null;
          const rect = o.getBoundingClientRect();
          return {
            overlayBottom: Math.round(rect.bottom + window.scrollY),
            pageScrollHeight: document.documentElement.scrollHeight,
          };
        });
        if (!m) {
          r.blank = { ok: false, reason: 'overlay 取得失敗' };
        } else {
          const blankBelow = m.pageScrollHeight - m.overlayBottom;
          r.blank = {
            ok: blankBelow <= s.blank.maxGap,
            overlayBottom: m.overlayBottom,
            pageScrollHeight: m.pageScrollHeight,
            blankBelow,
            note:
              blankBelow > s.blank.maxGap
                ? `プレビュー下に ${blankBelow}px の空白（元ソースの入れ物が hide されていない疑い）`
                : undefined,
          };
        }
      }

      // クリック透過検知: ユーザーと同じく画面座標を実マウスクリックし、反応
      // （行追加）を観測する。GitHub の cursorContainer / 透明 textarea が前面に
      // 残ると実イベントがそちらに奪われ、ボタンに届かず行が増えない。
      // （JS 直叩きでは前面要素を素通りして誤検知するため、必ず実クリックで測る。）
      if (s.click) {
        if (!inner) {
          r.click = { ok: false, reason: 'inner frame 取得失敗（クリック検証不可）' };
        } else {
          const before = await inner.evaluate(
            (sel) => document.querySelectorAll(sel).length,
            s.click.listSel,
          );
          const box = await inner.locator(s.click.sel).boundingBox();
          let topTag = null;
          if (box) {
            const cx = Math.round(box.x + box.width / 2);
            const cy = Math.round(box.y + box.height / 2);
            // クリックを奪っている要素を記録（原因切り分け用）
            topTag = await page.evaluate(([x, y]) => {
              const el = document.elementFromPoint(x, y);
              if (!el) return '(null)';
              const cls = typeof el.className === 'string' ? el.className : '';
              return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls.trim().split(/\s+/).join('.') : '');
            }, [cx, cy]);
            await page.mouse.click(cx, cy);
            await page.waitForTimeout(300);
          }
          const after = await inner.evaluate(
            (sel) => document.querySelectorAll(sel).length,
            s.click.listSel,
          );
          r.click = {
            ok: box != null && after > before,
            before,
            after,
            topElementAtTarget: topTag,
            note: after > before ? undefined : `クリックがボタンに届かない（前面要素: ${topTag}）`,
          };
        }
      }

      await page.screenshot({ path: `${OUTDIR}/${s.name}.png`, fullPage: false });

      await page.evaluate(() => {
        const b = document.querySelector('.ghp-preview-toggle-wrapper button');
        if (b) b.click();
      });
      await page.waitForTimeout(800);
      r.toggleBack = await page.evaluate(() => {
        const src = document.querySelector('#read-only-cursor-text-area');
        return {
          overlayGone: !document.querySelector('#ghp-preview-overlay'),
          srcDisplay: src ? getComputedStyle(src).display : 'no-src-el',
        };
      });
    }
  } catch (e) {
    r.error = String(e).slice(0, 300);
  }
  results.push(r);
  await page.close();
}

console.log(JSON.stringify(results, null, 2));
await ctx.close();
