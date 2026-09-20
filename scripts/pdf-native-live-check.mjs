// Isolated Electron integration check; uses local PDFs and a disposable profile.
// Pass the benchmark's columns.pdf and book.pdf (Lost in the Middle and the book scan).
// node scripts/pdf-native-live-check.mjs /absolute/columns.pdf /absolute/book.pdf
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import electron from 'electron'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeGpuEnv } from './launch-electron-vite.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
assert.ok(process.argv[2] && process.argv[3], 'Pass a native PDF and a scan PDF')
await mkdir(join(root, 'out'), { recursive: true })
const work = await mkdtemp(join(root, 'out/pdf-native-check-'))
try {
  await build({
    stdin: { contents: `
      import assert from 'node:assert/strict';
      import { app, BrowserWindow, WebContentsView, webContents } from 'electron';
      import { pathToFileURL } from 'node:url';
      import { readNativePdf } from './src/main/browser-pdf/native-reader.ts';
      app.setPath('userData', process.env.CLOSEDAI_PDF_CHECK_PROFILE);
      app.disableHardwareAcceleration();
      app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true } });
      const target = win.webContents;
      const helper = new WebContentsView({ webPreferences: { session: target.session, sandbox: true, backgroundThrottling: false } });
      const diagnostics = helper.webContents;
      const mode = async () => diagnostics.executeJavaScript(
        '(()=>{const x=new XMLHttpRequest();x.open("GET","targets-data.json",false);x.send();return JSON.parse(x.responseText).pages.find(p=>p.processId===' + target.mainFrame.processId + '&&p.url===' + JSON.stringify(target.getURL()) + ')?.a11yMode})()'
      );
      try {
        await diagnostics.loadURL('chrome://accessibility/');
        for (const [index, path] of JSON.parse(process.env.CLOSEDAI_PDF_CHECK_INPUTS).entries()) {
          await target.loadURL(pathToFileURL(path).href);
          for(let i=0;i<50;i++) {
            const v=target.mainFrame.framesInSubtree.find(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
            if(v && await v.executeJavaScript('document.querySelector("pdf-viewer")?.loadState_ === "success"')) break;
            await new Promise(r=>setTimeout(r,100));
          }
          const baseline = webContents.getAllWebContents().length;
          const before = await mode();
          assert.equal(before, 0);
          const result = await readNativePdf(target, index === 0 ? 2 : 1, 12000);
          await new Promise(r=>setTimeout(r,100));
          assert.ok(result?.available, JSON.stringify(result));
          if(index === 0) assert.match(result.text, /We first experiment/);
          else assert.equal(result.text, '', 'Scan unexpectedly has native/OCR text; review this build');
          assert.equal(webContents.getAllWebContents().length, baseline, 'Temporary helper leaked');
          assert.equal(await mode(), before, 'Accessibility mode leaked');
          console.log(JSON.stringify({case:index === 0 ? 'native-page-2' : 'scan', ...result, text:result.text.slice(0,150), modeRestored:true, helperReleased:true}));
          const missing = await readNativePdf(target, (result.totalPages ?? result.pagesAvailable) + 1, 1000);
          assert.equal(missing.available, false);
        }
        const controller = new AbortController(); controller.abort();
        const baseline = webContents.getAllWebContents().length;
        await assert.rejects(readNativePdf(target,1,1000,controller.signal), /abort/i);
        await new Promise(r=>setTimeout(r,100));
        assert.equal(webContents.getAllWebContents().length,baseline);
        console.log('Cancellation cleanup passed');
        const activeController = new AbortController();
        const aborted = readNativePdf(target,1,1000,activeController.signal);
        const cancelTimer = setTimeout(() => activeController.abort(), 30);
        try { await assert.rejects(aborted, /abort/i); } finally { clearTimeout(cancelTimer); }
        await new Promise(r=>setTimeout(r,100));
        assert.equal(webContents.getAllWebContents().length,baseline);
        assert.equal(await mode(),0);
        console.log('In-flight cancellation cleanup passed');
        const read = readNativePdf(target,1,1000);
        const navigate = new Promise(resolve => setTimeout(() => resolve(target.loadURL('about:blank')),30));
        await assert.rejects(read, /navigated|renderer|target|tree|context|frame/i);
        await navigate;
        await new Promise(r=>setTimeout(r,100));
        assert.ok(webContents.getAllWebContents().length <= baseline);
        console.log('Navigation invalidation and cleanup passed');
      } finally { diagnostics.close(); win.destroy(); }
      }).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
    `, resolveDir: root, sourcefile: 'native-pdf-live-check.mjs' },
    outfile: join(work, 'check.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm'
  })
  const env = { ...sanitizeGpuEnv().env }
  delete env.ELECTRON_RUN_AS_NODE
  env.CLOSEDAI_PDF_CHECK_PROFILE = join(work, 'profile')
  env.CLOSEDAI_PDF_CHECK_INPUTS = JSON.stringify(process.argv.slice(2).map(p => resolve(p)))
  const code = await new Promise((done, reject) => {
    const child = spawn(electron, [join(work, 'check.mjs'), '--no-sandbox'], { env, stdio: 'inherit' })
    const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); done(code ?? 1) })
  })
  process.exitCode = code
} finally {
  await rm(work, { recursive: true, force: true })
}
