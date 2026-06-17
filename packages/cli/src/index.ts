#!/usr/bin/env node

import { runCli } from './program.js'

const exitCode = await runCli(process.argv)
if (exitCode !== 0) {
  process.exitCode = exitCode
}

export { createProgram, runCli } from './program.js'
