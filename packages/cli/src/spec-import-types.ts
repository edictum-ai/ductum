import type { Spec } from '@ductum/core'

export type { SpecIntake, WorkPackage } from '@ductum/core'

/** Legacy compatibility shape. Generators should target WorkPackage/SpecIntake. */
export interface ImportedSpec {
  project: string
  sourcePath?: string
  spec: {
    name: string
    status?: Spec['status']
    document?: string
    /** Optional per-spec override for the fix-loop iteration cap.
     *  When set, the router uses this instead of factory.postCompletion
     *  .maxFixIterations for runs in this spec. */
    maxFixIterations?: number
  }
  tasks: ImportedTask[]
}

export interface ImportedTask {
  name: string
  sourcePath?: string
  target?: string
  repository?: string
  component?: string
  prompt: string
  repos: string[]
  verification: string[]
  dependsOn: string[]
  assignedAgent?: string
  complexity?: 'simple' | 'standard' | 'complex'
  requiredRole?: 'builder' | 'reviewer' | 'docs' | 'watcher'
  status?: 'pending' | 'blocked' | 'ready' | 'active' | 'done' | 'failed'
}
