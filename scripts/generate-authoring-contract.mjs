#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildAuthoringContractFiles } from '../packages/core/dist/index.js'

const ROOT = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
let drift = false

for (const file of buildAuthoringContractFiles()) {
  const path = resolve(ROOT, file.path)
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (current !== file.content) {
      console.error(`Authoring contract drift: ${file.path}`)
      drift = true
    }
    continue
  }
  writeFileSync(path, file.content)
  console.log(`wrote ${file.path}`)
}

if (drift) {
  console.error('Run: pnpm authoring:contract')
  process.exit(1)
}
