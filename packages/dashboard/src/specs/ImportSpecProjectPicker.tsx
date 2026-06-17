import type { Project } from '@/api/client'
import { ImportSpecDialog } from '@/components/ImportSpecDialog'

interface Props {
  projects: Project[]
}

/**
 * Renders an "Import Spec" button for the SpecList page.
 *
 * Project selection is handled inside the dialog itself so that
 * project names are not duplicated in the main DOM (which would
 * break screen.getByText in tests when section headers show the
 * same names).
 */
export function ImportSpecProjectPicker({ projects }: Props) {
  if (projects.length === 0) return null
  if (projects.length === 1) {
    return <ImportSpecDialog projectId={projects[0]!.id} />
  }
  return <ImportSpecDialog projects={projects} />
}
