import { readFile, readdir, readlink, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { NativeTarget } from './contracts.js'

export async function readTarget(pid: number): Promise<NativeTarget> {
  if (process.platform !== 'linux') throw new Error('The initial native backend supports Linux only')
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid process id')
  const root = `/proc/${pid}`
  const [before, boot, executable, identity, owner] = await Promise.all([
    readFile(`${root}/stat`, 'utf8'), readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    readlink(`${root}/exe`), stat(`${root}/exe`), stat(root)
  ])
  if (owner.uid !== process.getuid?.()) throw new Error('Only processes owned by the current user are supported')
  const after = await readFile(`${root}/stat`, 'utf8')
  const start = (value: string) => value.slice(value.lastIndexOf(')') + 2).split(' ')[19]
  if (!start(before) || start(before) !== start(after)) throw new Error('Target changed during discovery')
  const hash = createHash('sha256').update(JSON.stringify([
    boot.trim(), pid, start(after), executable, identity.dev, identity.ino
  ])).digest('hex')
  return { id: `${pid}:${hash}`, pid, name: after.slice(after.indexOf('(') + 1, after.lastIndexOf(')')), executable }
}

export async function verifyTarget(id: string): Promise<NativeTarget> {
  if (!/^\d+:[a-f0-9]{64}$/.test(id)) throw new Error('Use a target id from native_instrument.query processes')
  const target = await readTarget(Number(id.split(':')[0]))
  if (target.id !== id) throw new Error('Target identity changed; discover it again before a new operation')
  return target
}

export async function listTargets(query: string, limit: number) {
  if (process.platform !== 'linux') throw new Error('The initial native backend supports Linux only')
  const pids = (await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(Number).sort((a, b) => a - b)
  const targets: NativeTarget[] = []
  let matched = 0
  // Modest batches avoid opening thousands of proc files at once.
  for (let offset = 0; offset < pids.length; offset += 16) {
    const batch = await Promise.allSettled(pids.slice(offset, offset + 16).map(readTarget))
    for (const item of batch) {
      if (item.status !== 'fulfilled') continue // exited, inaccessible, or another uid
      const target = item.value
      if (!`${target.pid} ${target.name} ${target.executable}`.toLowerCase().includes(query.toLowerCase())) continue
      matched++
      if (targets.length < limit) targets.push(target)
    }
  }
  return { targets, matched, omitted: matched - targets.length }
}

export async function ptracePolicy(): Promise<string> {
  return readFile('/proc/sys/kernel/yama/ptrace_scope', 'utf8').then(value => value.trim(), () => 'unavailable')
}
