/**
 * Structured logger for Ductum.
 *
 * Format: [HH:MM:SS] [tag] level: message {data}
 *
 * Replaces bare console.log/error/warn across all production source files.
 * Test files may keep console.log.
 */

import { redactPublicOutput, redactPublicText } from './public-redaction.js'

type LogLevel = 'info' | 'warn' | 'error'

installEpipeGuard(process.stdout)
installEpipeGuard(process.stderr)
installProcessEpipeGuard()

function formatTime(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function formatMessage(level: LogLevel, tag: string, msg: string, data?: Record<string, unknown>): string {
  const time = formatTime()
  const dataStr = data != null ? ` ${JSON.stringify(redactPublicOutput(data))}` : ''
  return `[${time}] [${tag}] ${level}: ${redactPublicText(msg)}${dataStr}`
}

function installEpipeGuard(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (!isBrokenPipeError(error)) {
      setImmediate(() => { throw error })
    }
  })
}

function installProcessEpipeGuard(): void {
  process.on('uncaughtException', (error: unknown) => {
    if (isBrokenPipeError(error)) return
    throw error
  })

  process.on('unhandledRejection', (reason: unknown) => {
    if (isBrokenPipeError(reason)) return
    throw reason
  })
}

export function isBrokenPipeError(error: unknown): boolean {
  return error != null
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EPIPE'
}

export const log = {
  info(tag: string, msg: string, data?: Record<string, unknown>): void {
    console.log(formatMessage('info', tag, msg, data))
  },

  warn(tag: string, msg: string, data?: Record<string, unknown>): void {
    console.warn(formatMessage('warn', tag, msg, data))
  },

  error(tag: string, msg: string, data?: Record<string, unknown>): void {
    console.error(formatMessage('error', tag, msg, data))
  },
}
