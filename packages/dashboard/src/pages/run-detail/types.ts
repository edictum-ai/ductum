import type { useResolveRun } from '@/api/hooks'

type ResolvedRun = NonNullable<ReturnType<typeof useResolveRun>['data']>

export type RunType = ResolvedRun['run']
export type ProjectType = ResolvedRun['project']
export type SpecType = ResolvedRun['spec']
export type TaskType = ResolvedRun['task']
