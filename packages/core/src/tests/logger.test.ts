import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isBrokenPipeError, log } from '../logger.js'

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('formats info messages with [HH:MM:SS] [tag] info: message', () => {
    log.info('startup', 'server started')

    expect(logSpy).toHaveBeenCalledOnce()
    const msg = logSpy.mock.calls[0]![0] as string
    expect(msg).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[startup\] info: server started$/)
  })

  it('formats warn messages with [HH:MM:SS] [tag] warn: message', () => {
    log.warn('dispatch', 'no agents available')

    expect(warnSpy).toHaveBeenCalledOnce()
    const msg = warnSpy.mock.calls[0]![0] as string
    expect(msg).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[dispatch\] warn: no agents available$/)
  })

  it('formats error messages with [HH:MM:SS] [tag] error: message', () => {
    log.error('harness', 'session crashed')

    expect(errorSpy).toHaveBeenCalledOnce()
    const msg = errorSpy.mock.calls[0]![0] as string
    expect(msg).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[harness\] error: session crashed$/)
  })

  it('appends JSON data when provided', () => {
    log.info('api', 'request completed', { status: 200, duration: 42 })

    expect(logSpy).toHaveBeenCalledOnce()
    const msg = logSpy.mock.calls[0]![0] as string
    expect(msg).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[api\] info: request completed \{"status":200,"duration":42\}$/)
  })

  it('redacts secret values from log messages and data', () => {
    log.warn('api', 'failed with sk-proj-test-secret', { url: 'postgres://user:password@example.com/db' })

    const msg = warnSpy.mock.calls[0]![0] as string
    expect(msg).not.toContain('sk-proj-test-secret')
    expect(msg).not.toContain('password@example.com')
    expect(msg).toContain('[redacted]')
  })

  it('omits data suffix when data is undefined', () => {
    log.info('test', 'plain message')

    const msg = logSpy.mock.calls[0]![0] as string
    expect(msg).not.toContain('{')
  })

  it('recognizes EPIPE as a broken pipe error', () => {
    expect(isBrokenPipeError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true)
    expect(isBrokenPipeError(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe(false)
  })
})
