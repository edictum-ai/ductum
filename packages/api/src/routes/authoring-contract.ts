import { readFileSync } from 'node:fs'
import { Hono } from 'hono'

const ROOT = new URL('../../../..', import.meta.url)

export function registerAuthoringContractRoutes(app: Hono): void {
  app.get('/llms.txt', (c) => c.text(readContractFile('llms.txt'), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  }))
  app.get('/llms-full.txt', (c) => c.text(readContractFile('llms-full.txt'), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  }))
}

function readContractFile(name: 'llms.txt' | 'llms-full.txt'): string {
  return readFileSync(new URL(name, ROOT), 'utf8')
}
