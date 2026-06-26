import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..')
const SURFACES = ['packages/api/src', 'packages/cli/src', 'packages/dashboard/src']
const FACTORY_SETTINGS_PUBLIC_SURFACES = [
  'packages/api/src/routes/factory-settings.ts',
  'packages/cli/src/commands/factory-settings.ts',
]
const TEACHING_MARKDOWN_SURFACES = [
  'README.md',
  'docs/CLI_ONBOARDING.md',
  'docs/SETUP.md',
  'packages/ductum/README.md',
  '.claude/skills/ductum-cli/SKILL.md',
]
const FORBIDDEN_NORMAL_MARKDOWN = [
  { label: 'resource command', regex: /\bresource\s+(?:apply|list|get)\b/i },
  { label: 'target command', regex: /\btarget\s+(?:apply|list|get)\b/i },
  { label: 'run dispatch command', regex: /\brun\s+dispatch\b/i },
  { label: 'run task command', regex: /\brun\s+<task/i },
  { label: 'seed happy path', regex: /\bseed(?:s|ed|ing)?\b/i },
]
const PUBLIC_CONTRACT_SYMBOLS = [
  'OperatorProject',
  'OperatorRepository',
  'OperatorComponent',
  'OperatorSpec',
  'OperatorTask',
  'OperatorAttempt',
  'OperatorAgent',
  'OperatorProvider',
  'OperatorModel',
  'OperatorHarness',
  'OperatorWorkflow',
  'OperatorFactoryActivity',
  'OperatorRepair',
  'FactorySettingsProvider',
  'FactorySettingsModel',
  'FactorySettingsHarness',
  'FactorySettingsWorkflow',
  'FactorySettingsAgent',
  'FactorySettingsSandboxProfile',
  'FactorySettingsNotificationChannel',
  'FactorySettingsBudgetPreferences',
  'FactorySettingsRuntimePreferences',
  'FactorySettingsCatalogs',
  'FactorySettingsDetails',
  'FactorySettingsWriteResult',
  'FactorySettingsAffectedRuntime',
  'FactorySettingsPatch',
  'FactoryRuntimeSettings',
  'FactoryRuntimeDesiredSettings',
  'FactoryRuntimeCurrentSettings',
  'FactoryRuntimePatch',
  'FactorySecretMetadata',
  'FactorySecretScope',
  'FactorySecretStatus',
  'FactorySecretKeySource',
  'SpecIntake',
  'WorkPackage',
  'PublicContractIssue',
]

describe('public operator contract drift guard', () => {
  it('dashboard, CLI, and API do not redeclare canonical public contract types', () => {
    const declarations = PUBLIC_CONTRACT_SYMBOLS.map((symbol) => ({
      symbol,
      regex: new RegExp(`\\b(?:interface|type)\\s+${symbol}\\b`),
    }))
    const offenders: Array<{ file: string; symbol: string; line: number }> = []

    for (const file of listFiles(SURFACES.map((surface) => path.join(REPO_ROOT, surface)))) {
      const rel = path.relative(REPO_ROOT, file)
      if (rel.endsWith('tests/public-contract-drift.test.ts')) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      let importExportBlock = false
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        if (/^\s*(import|export)\s+(?:type\s+)?\{/.test(line)) importExportBlock = true
        if (importExportBlock || /^\s*import\s/.test(line)) {
          if (/\}\s+from\s+['"]/.test(line)) importExportBlock = false
          continue
        }
        for (const declaration of declarations) {
          if (declaration.regex.test(line)) {
            offenders.push({ file: rel, symbol: declaration.symbol, line: index + 1 })
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('Factory Settings public route and CLI copy avoid generic resource language', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = []
    for (const rel of FACTORY_SETTINGS_PUBLIC_SURFACES) {
      const lines = readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n')
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        if (/\bresources?\b/i.test(line)) {
          offenders.push({ file: rel, line: index + 1, text: line.trim() })
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('operator teaching docs do not present legacy command vocabulary as the normal path', () => {
    const offenders: Array<{ file: string; line: number; pattern: string; text: string }> = []
    for (const rel of TEACHING_MARKDOWN_SURFACES) {
      const lines = readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n')
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!
        if (/legacy\/debug|legacy and debug/i.test(line)) continue
        for (const pattern of FORBIDDEN_NORMAL_MARKDOWN) {
          if (pattern.regex.test(line)) {
            offenders.push({ file: rel, line: index + 1, pattern: pattern.label, text: line.trim() })
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })
})

function listFiles(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    const stack = [root]
    while (stack.length > 0) {
      const dir = stack.pop()!
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        const info = statSync(full)
        if (info.isDirectory()) {
          if (entry !== 'dist') stack.push(full)
          continue
        }
        if (full.endsWith('.ts') || full.endsWith('.tsx')) files.push(full)
      }
    }
  }
  return files
}
