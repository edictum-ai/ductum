import { execFile } from 'node:child_process'
import { createServer } from 'node:net'

export function exec(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error != null) {
        rejectPromise(new Error(`${command} ${args.join(' ')} failed: ${stderr || error.message}`))
        return
      }
      resolvePromise({ stdout, stderr })
    })
  })
}

export async function waitFor(fn, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await fn()
    if (result != null) return result
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(message)
}

export function waitForOutput(child, logs, pattern, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new Error(`serve did not become ready: ${logs.slice(-20).join('\n')}`)),
      timeoutMs,
    )
    const onData = (chunk) => {
      const text = String(chunk)
      logs.push(text.trim())
      if (pattern.test(text)) {
        clearTimeout(timer)
        resolvePromise()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      rejectPromise(new Error(`serve exited before ready: ${code ?? signal}`))
    })
  })
}

export async function stopChild(child, signal) {
  if (child == null || exited(child)) return
  child.kill(signal)
  await waitForExit(child, 5000).catch(() => {
    if (!exited(child)) child.kill('SIGKILL')
  })
}

export async function stopProcessGroup(child, signal) {
  if (child == null || exited(child)) return
  try {
    if (child.pid != null) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    child.kill(signal)
  }
  await waitForExit(child, 5000).catch(() => {
    try {
      if (child.pid != null) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  })
}

export function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address != null) resolvePromise(address.port)
        else rejectPromise(new Error('no port'))
      })
    })
  })
}

export function readIntEnv(name, fallback) {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function envelope(kind, data) {
  return { schemaVersion: 1, kind, data, ts: new Date().toISOString() }
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve()
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('process did not exit')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

function exited(child) {
  return child.exitCode != null || child.signalCode != null
}
