import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rules = [
  ['packages/api/src/routes/config-resources.ts', 'prepareConfigResourceSpecWrite('],
  ['packages/api/src/routes/agents.ts', 'prepareAgentSpawnConfigWrite('],
  ['packages/api/src/routes/factory.ts', 'CONFIG_WRITE_VALIDATION_EXEMPTION:'],
  ['packages/api/src/routes/factory-runtime.ts', 'CONFIG_WRITE_VALIDATION_EXEMPTION:'],
  ['packages/api/src/routes/factory-secrets.ts', 'CONFIG_WRITE_VALIDATION_EXEMPTION:'],
  ['packages/api/src/workflow-profiles.ts', 'CONFIG_WRITE_VALIDATION_EXEMPTION:'],
]

const failures = rules
  .map(([file, needle]) => [file, needle, readFileSync(resolve(file), 'utf8').includes(needle)])
  .filter(([, , present]) => !present)
  .map(([file, needle]) => `- ${file} missing ${needle}`)

if (failures.length > 0) {
  console.error(`Config write validation gate failed:\n${failures.join('\n')}`)
  process.exit(1)
}

console.log(`Config write validation gate passed for ${rules.length} files.`)
