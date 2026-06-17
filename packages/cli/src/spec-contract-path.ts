import { buildImportedSpecContractReport } from './spec-contract-audit.js'
import { parseImportPath, type ImportedSpec } from './spec-import.js'

export async function loadImportedSpecContractReport(
  projectName: string,
  path: string,
): Promise<{ imported: ImportedSpec; report: ReturnType<typeof buildImportedSpecContractReport> }> {
  const imported = await parseImportPath(path, projectName, { preserveYamlProject: true })
  if (imported.project !== projectName) {
    throw new Error(`Spec file declares project "${imported.project}" but command was run for "${projectName}"`)
  }
  return {
    imported,
    report: buildImportedSpecContractReport(imported),
  }
}
