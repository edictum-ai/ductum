/**
 * TaskDAG — interactive lineage graph for a spec.
 *
 * Switched from a hand-rolled SVG layer to @xyflow/react +
 * @dagrejs/dagre for layout. The motivation: the old version was
 * cramped, didn't pan/zoom, didn't visually distinguish impl from
 * review/fix tasks, and laid review/fix tasks out as random nodes in
 * arbitrary topo layers. This version:
 *
 *   - Auto-lays out the graph with dagre (LR direction).
 *   - Treats each task lineage (impl → review → fix → review-r2 ...)
 *     as a vertical chain anchored on the impl node, drawn with
 *     dashed lineage edges so they read as "review of" not "depends
 *     on". Solid edges between impl nodes still encode task
 *     dependencies from the deps table.
 *   - Renders custom React nodes via parseTaskKind so impl, review,
 *     and fix tasks each get their own icon (Hammer / Eye / Wrench),
 *     accent color, and role badge.
 *   - Pans, zooms, fits-to-viewport on mount.
 *   - Clicking a node deep-links to the task page.
 */

import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Eye, Hammer, Wrench } from 'lucide-react'
import { useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Task, TaskDependency } from '@/api/client'
import {
  parseTaskKind,
  TASK_KIND_BADGE_CLASSES,
  type TaskKind,
} from '@/lib/task-kind'
import { cn } from '@/lib/utils'

const NODE_WIDTH = 220
const NODE_HEIGHT = 56

interface TaskNodeData extends Record<string, unknown> {
  task: Task
  kind: TaskKind
  roleCode: string
  originalName: string
  projectName?: string
  specName?: string
}

const KIND_ICON = {
  impl: Hammer,
  review: Eye,
  fix: Wrench,
} as const

const KIND_BORDER: Record<TaskKind, string> = {
  impl: 'border-blue-500/60 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]',
  review: 'border-purple-500/50',
  fix: 'border-amber-500/50',
}

const STATUS_BADGE: Record<string, string> = {
  blocked: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  ready: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  active: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
}

const KIND_ICON_COLOR: Record<TaskKind, string> = {
  impl: 'text-blue-400',
  review: 'text-purple-400',
  fix: 'text-amber-400',
}

/**
 * Custom React Flow node — replaces the default labelled rectangle.
 * Each node renders the task name, role badge, kind icon, status
 * pill, and is keyboard-focusable for accessibility.
 */
function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  const { task, kind, roleCode } = data
  const Icon = KIND_ICON[kind]
  const isImpl = kind === 'impl'
  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-500/40" />
      <div
        className={cn(
          'flex min-h-[56px] w-[220px] items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md',
          KIND_BORDER[kind],
        )}
        title={isImpl ? task.name : `${roleCode} (${kind}) of ${data.originalName}`}
      >
        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/40', KIND_ICON_COLOR[kind])}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'rounded border px-1 py-0 font-mono text-[8px] uppercase',
                TASK_KIND_BADGE_CLASSES[kind],
              )}
            >
              {roleCode}
            </span>
            <span className="truncate font-mono text-[11px] font-semibold">
              {isImpl ? task.name : data.originalName}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <span
              className={cn(
                'rounded border px-1 py-0 font-mono text-[8px] uppercase',
                STATUS_BADGE[task.status] ?? STATUS_BADGE.blocked,
              )}
            >
              {task.status}
            </span>
            {!isImpl && (
              <span className="truncate font-mono text-[9px] text-muted-foreground/60">{task.name}</span>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-500/40" />
    </>
  )
}

const nodeTypes = {
  taskNode: TaskNode,
}

/**
 * Run dagre layout on the React Flow node + edge lists. Returns the
 * same lists with `position` populated on each node. We force LR
 * direction so impl→review→fix lineage chains read top-to-bottom
 * within each column.
 */
function layoutWithDagre(nodes: Node<TaskNodeData>[], edges: Edge[]): Node<TaskNodeData>[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80, marginx: 20, marginy: 20 })
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return nodes.map((n) => {
    const pos = g.node(n.id)
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  })
}

export function TaskDAG({
  tasks,
  dependencies,
  projectName,
  specName,
  compact = false,
}: {
  tasks: Task[]
  dependencies: TaskDependency[]
  projectName?: string
  specName?: string
  /** Smaller height + hidden minimap/controls — use as a preview
   *  inline on the homepage spec cards. Click any node to navigate
   *  through to the full spec page. */
  compact?: boolean
}) {
  const navigate = useNavigate()

  const { nodes, edges } = useMemo(() => {
    if (tasks.length === 0) return { nodes: [], edges: [] }

    // Build the React Flow node list. We use a stable id = task.id.
    const taskNodes: Node<TaskNodeData>[] = tasks.map((task) => {
      const parsed = parseTaskKind(task.name)
      return {
        id: task.id,
        type: 'taskNode',
        position: { x: 0, y: 0 }, // dagre fills this in below
        data: {
          task,
          kind: parsed.kind,
          roleCode: parsed.roleCode,
          originalName: parsed.originalName,
          projectName,
          specName,
        },
      }
    })

    // Build edges: solid for task dependencies (between impls),
    // dashed for lineage chains (impl → review → fix → ...).
    const idSet = new Set(tasks.map((t) => t.id))
    const depEdges: Edge[] = dependencies
      .filter((d) => idSet.has(d.taskId) && idSet.has(d.dependsOnId))
      .map((d) => ({
        id: `dep-${d.dependsOnId}-${d.taskId}`,
        source: d.dependsOnId,
        target: d.taskId,
        type: 'smoothstep',
        style: { stroke: 'rgba(100, 116, 139, 0.6)', strokeWidth: 1.5 },
      }))

    // Group tasks by lineage root. Within each lineage, sort by
    // kind+round (impl → review-r1 → fix-r1 → review-r2 → ...).
    const lineageMap = new Map<string, Task[]>()
    for (const t of tasks) {
      const { originalName } = parseTaskKind(t.name)
      const list = lineageMap.get(originalName) ?? []
      list.push(t)
      lineageMap.set(originalName, list)
    }
    const lineageEdges: Edge[] = []
    for (const [root, lineageTasks] of lineageMap) {
      if (lineageTasks.length < 2) continue
      const sorted = [...lineageTasks].sort((a, b) => {
        const pa = parseTaskKind(a.name)
        const pb = parseTaskKind(b.name)
        if (pa.round !== pb.round) return pa.round - pb.round
        const order = { impl: 0, review: 1, fix: 2 }
        return order[pa.kind] - order[pb.kind]
      })
      for (let i = 0; i < sorted.length - 1; i += 1) {
        lineageEdges.push({
          id: `lineage-${root}-${i}`,
          source: sorted[i]!.id,
          target: sorted[i + 1]!.id,
          type: 'smoothstep',
          animated: false,
          style: {
            stroke: 'rgba(148, 163, 184, 0.4)',
            strokeWidth: 1,
            strokeDasharray: '4 3',
          },
        })
      }
    }

    const allEdges = [...depEdges, ...lineageEdges]
    const laidOut = layoutWithDagre(taskNodes, allEdges)
    return { nodes: laidOut, edges: allEdges }
  }, [tasks, dependencies, projectName, specName])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<TaskNodeData>) => {
      if (projectName && specName) {
        navigate(`/${encodeURIComponent(projectName)}/${encodeURIComponent(specName)}/${encodeURIComponent(node.data.task.name)}`)
      }
    },
    [navigate, projectName, specName],
  )

  if (tasks.length === 0) return null

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-lg border border-border/30 bg-card/20',
        compact ? 'h-[200px]' : 'h-[420px]',
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={compact ? 0.2 : 0.4}
        maxZoom={2}
        zoomOnScroll={!compact}
        panOnScroll={false}
        zoomOnPinch={!compact}
      >
        <Background gap={20} size={1} color="rgba(148, 163, 184, 0.08)" />
        {!compact && (
          <>
            <Controls
              className="!border-border/40 !bg-card/80 !shadow-none [&_button]:!border-border/40 [&_button]:!bg-card/80 [&_button_svg]:!fill-muted-foreground"
              showInteractive={false}
            />
            <MiniMap
              className="!border !border-border/40 !bg-card/60"
              maskColor="rgba(15, 23, 42, 0.7)"
              nodeColor={(n) => {
                const kind = (n.data as TaskNodeData).kind
                return kind === 'impl' ? '#3b82f6' : kind === 'review' ? '#a855f7' : '#f59e0b'
              }}
              pannable
              zoomable
            />
          </>
        )}
      </ReactFlow>
    </div>
  )
}
