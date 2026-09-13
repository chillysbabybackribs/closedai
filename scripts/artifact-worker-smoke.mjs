// Build only the main entries into a temporary directory and exercise the emitted worker
// under Electron's bundled Node. Does not launch a window or touch the active profile.
import { resolveConfig } from 'electron-vite'
import { build } from 'vite'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = await mkdtemp(join(tmpdir(), 'closedai-artifact-package-'))
try {
  const resolved = await resolveConfig({}, 'build', 'production')
  const main = resolved.config.main
  main.build = { ...main.build, watch: null, outDir: root, emptyOutDir: false }
  await build(main)
  const workerPath = join(root, 'artifact-worker.js')
  await access(workerPath)
  const script = `
    import { Worker } from 'node:worker_threads';
    import { pathToFileURL } from 'node:url';
    import { readFile } from 'node:fs/promises';
    import assert from 'node:assert/strict';
    const scope={chatId:'smoke',workspace:'/fixture'};
    function open() {
      const worker = new Worker(pathToFileURL(process.argv[1]), {
        workerData:{file:process.argv[2]}, execArgv:[]
      });
      let requestId = 0;
      const call=(action,input)=>new Promise((resolve,reject)=>{
        worker.once('error',reject);
        worker.once('message',m=>{worker.off('error',reject);m.error?reject(new Error(m.error)):resolve(m.result)});
        worker.postMessage({requestId:++requestId,action,scope,input,cancellation:new SharedArrayBuffer(4)});
      });
      return {worker,call};
    }
    let runtime=open();
    try {
      const bytes=Buffer.from(JSON.stringify({prefix:'x'.repeat(90000),tail:'retained'}));
      await runtime.call('reserve',{key:'smoke',fingerprint:'a'.repeat(64)});
      const artifact=await runtime.call('complete',{key:'smoke',bytes,label:'smoke',mediaType:'application/json'});
      await runtime.worker.terminate();
      runtime=open();
      const read=await runtime.call('read',{id:artifact.id,pointer:'/tail'});
      assert.equal(read.data,'"retained"');
      const retry=await runtime.call('reserve',{key:'smoke',fingerprint:'a'.repeat(64)});
      assert.equal(retry.artifact.id,artifact.id);
      await runtime.call('export',{id:artifact.id,path:process.argv[3]});
      assert.deepEqual(await readFile(process.argv[3]),bytes);
      await runtime.call('delete',{id:artifact.id});
      assert.equal((await runtime.call('list',{})).artifacts.length,0);
      await runtime.call('close',{});
      console.log('Packaged artifact worker passed: retain, abrupt restart, projection, retry, exact export, delete.');
      console.log('Electron '+process.versions.electron+' / Node '+process.versions.node);
    } finally {await runtime.worker.terminate()}
  `
  const electron = createRequire(import.meta.url)('electron')
  const result = spawnSync(electron, [
    '--input-type=module', '-e', script, workerPath, join(root, 'smoke.sqlite'), join(root, 'export.json')
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000 })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error || result.status !== 0) throw result.error ?? new Error(`Packaged worker failed: ${result.status}`)
} finally {
  await rm(root, { recursive: true, force: true })
}
