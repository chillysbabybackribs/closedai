// Isolated Electron integration check; uses local PDFs and a disposable profile.
// node scripts/pdf-native-live-check.mjs /absolute/native.pdf /absolute/scan.pdf
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
      app.setPath('userData', process.argv[2]);
      app.disableHardwareAcceleration();
      await app.whenReady();
      const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true } });
      const target = win.webContents;
      const helper = new WebContentsView({ webPreferences: { session: target.session, sandbox: true, backgroundThrottling: false } });
      const diagnostics = helper.webContents;
      const mode = async () => diagnostics.executeJavaScript(
        '(()=>{const x=new XMLHttpRequest();x.open("GET","targets-data.json",false);x.send();return JSON.parse(x.responseText).pages.find(p=>p.processId===' + target.mainFrame.processId + '&&p.routingId===' + target.mainFrame.routingId + ')?.a11yMode})()'
      );
      try {
        await diagnostics.loadURL('chrome://accessibility/');
        for (const [index, path] of process.argv.slice(3).entries()) {
          await target.loadURL(pathToFileURL(path).href);
          for(let i=0;i<50;i++) {
            const v=target.mainFrame.framesInSubtree.find(f=>f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
            if(v && await v.executeJavaScript('document.querySelector("pdf-viewer")?.loadState_ === "success"')) break;
            await new Promise(r=>setTimeout(r,100));
          }
          const baseline = webContents.getAllWebContents().length;
          const before = await mode();
          const result = await readNativePdf(target, index === 0 ? 2 : 1, 12000);
          await new Promise(r=>setTimeout(r,100));
          assert.ok(result?.available, JSON.stringify(result));
          if(index === 0) assert.match(result.text, /We first experiment/);
          else assert.equal(result.text, '', 'Scan unexpectedly has native/OCR text; review this build');
          assert.equal(webContents.getAllWebContents().length, baseline, 'Temporary helper leaked');
          assert.equal(await mode(), before, 'Accessibility mode leaked');
          console.log(JSON.stringify({case:index === 0 ? 'native-page-2' : 'scan', ...result, text:result.text.slice(0,150), modeRestored:true, helperReleased:true}));
        }
        const controller = new AbortController(); controller.abort();
        const baseline = webContents.getAllWebContents().length;
        await assert.rejects(readNativePdf(target,1,1000,controller.signal), /abort/i);
        await new Promise(r=>setTimeout(r,100));
        assert.equal(webContents.getAllWebContents().length,baseline);
        console.log('Cancellation cleanup passed');
      } finally { diagnostics.close(); win.destroy(); app.quit(); }
    `, resolveDir: root, sourcefile: 'native-pdf-live-check.mjs' },
    outfile: join(work, 'check.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm'
  })
  const env = { ...sanitizeGpuEnv().env }
  delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((done, reject) => {
    const child = spawn(electron, ['--no-sandbox', join(work, 'check.mjs'), join(work, 'profile'), ...process.argv.slice(2).map(p => resolve(p))], { env, stdio: 'inherit' })
    const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); done(code ?? 1) })
  })
  process.exitCode = code
} finally {
  await rm(work, { recursive: true, force: true })
}
