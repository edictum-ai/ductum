import { Command } from 'commander'
import { formatStatusBadge, formatSummaryRows, formatTable, formatTaskDag } from '../format.js'
import { createAction, readPromptInput, splitCsv } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { displayName, formatAssignments, renderSections, requireAgentByName, requireProjectByName, requireSpecByNameOrId } from './common.js'
import { registerSpecBakeoffCommands } from './spec-bakeoff.js'
import { registerSpecImportCommand } from './spec-import-command.js'
import { registerSpecIntakeCommand } from './spec-intake.js'
import { repositoryInputsFromOptions, type RepositoryOptions } from './repositories.js'

export function registerAdminCommands(program: Command, deps: CliProgramDeps) {
  const project = program.command('project').description('Manage projects')
  project
    .command('list')
    .description('List projects')
    .action(createAction(deps, async (ctx) => {
      const projects = await ctx.api.listProjects()
      ctx.write(projects, formatTable([
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'NAME' },
        { key: 'repos', label: 'REPOS' },
        { key: 'mergeMode', label: 'MERGE' },
      ], projects.map((item) => ({
        id: item.id,
        name: item.name,
        repos: item.repos.join(', '),
        mergeMode: item.config.mergeMode,
      }))))
    }))
  project
    .command('create <name>')
    .option('--repo <repo>', 'Local Git repository path', splitCsv, [])
    .option('--local-path <path>', 'Onboard a local repository path')
    .option('--remote-url <url>', 'Onboard a remote repository URL')
    .option('--merge-mode <mode>', 'Merge mode', 'human')
    .description('Create project')
    .action(createAction(deps, async (ctx, name: string, options: RepositoryOptions & { mergeMode: 'auto' | 'human' }) => {
      const repositories = repositoryInputsFromOptions(options)
      const created = await ctx.api.createProject({
        name,
        ...(repositories.length === 0 ? {} : { repositories }),
        config: { mergeMode: options.mergeMode },
      })
      ctx.write(created, formatSummaryRows({ id: created.id, name: created.name, mergeMode: created.config.mergeMode }))
    }))
  project
    .command('show <name>')
    .description('Show project detail')
    .action(createAction(deps, async (ctx, name: string) => {
      const target = await requireProjectByName(ctx.api, name)
      const [assignments, agents, specs] = await Promise.all([
        ctx.api.listProjectAgents(target.id),
        ctx.api.listAgents(),
        ctx.api.listSpecs(target.id),
      ])
      const payload = { project: target, assignments, specs }
      const sections = renderSections(
        formatSummaryRows({
          id: target.id,
          name: target.name,
          repos: target.repos.join(', '),
          mergeMode: target.config.mergeMode,
          workflowPath: target.config.workflowPath,
        }),
        `Agents\n${formatTable([
          { key: 'agent', label: 'AGENT' },
          { key: 'role', label: 'ROLE' },
        ], formatAssignments(assignments, [target], agents))}`,
        `Specs\n${formatTable([
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'NAME' },
          { key: 'status', label: 'STATUS' },
        ], specs.map((spec) => ({ id: spec.id, name: spec.name, status: formatStatusBadge(spec.status) })))}`,
      )
      ctx.write(payload, sections)
    }))
  project
    .command('delete <name>')
    .description('Delete project')
    .action(createAction(deps, async (ctx, name: string) => {
      const target = await requireProjectByName(ctx.api, name)
      await ctx.api.deleteProject(target.id)
      ctx.write({ deleted: true, id: target.id, name: target.name }, `Deleted project ${target.name}`)
    }))

  const projectAgent = project.command('agent').description('Manage project agent assignments')
  projectAgent
    .command('list <projectName>')
    .description('List agents assigned to a project')
    .action(createAction(deps, async (ctx, projectName: string) => {
      const projectRecord = await requireProjectByName(ctx.api, projectName)
      const [assignments, agents] = await Promise.all([
        ctx.api.listProjectAgents(projectRecord.id),
        ctx.api.listAgents(),
      ])
      ctx.write(assignments, formatTable([
        { key: 'agent', label: 'AGENT' },
        { key: 'role', label: 'ROLE' },
      ], formatAssignments(assignments, [projectRecord], agents)))
    }))
  projectAgent
    .command('assign <projectName> <agentName>')
    .option('--role <role>', 'Role (builder|reviewer|docs|watcher)', 'builder')
    .description('Assign an agent to a project')
    .action(createAction(deps, async (ctx, projectName: string, agentName: string, options: { role: string }) => {
      const [projectRecord, agentRecord] = await Promise.all([
        requireProjectByName(ctx.api, projectName),
        requireAgentByName(ctx.api, agentName),
      ])
      const assignment = await ctx.api.assignProjectAgent(projectRecord.id, agentRecord.id, options.role)
      ctx.write(assignment, `Assigned ${agentRecord.name} to ${projectRecord.name} as ${options.role}`)
    }))
  projectAgent
    .command('unassign <projectName> <agentName>')
    .option('--role <role>', 'Role to unassign (omit to remove all roles)')
    .description('Remove an agent assignment from a project')
    .action(createAction(deps, async (ctx, projectName: string, agentName: string, options: { role?: string }) => {
      const [projectRecord, agentRecord] = await Promise.all([
        requireProjectByName(ctx.api, projectName),
        requireAgentByName(ctx.api, agentName),
      ])
      await ctx.api.unassignProjectAgent(projectRecord.id, agentRecord.id, options.role)
      ctx.write(
        { unassigned: true, projectId: projectRecord.id, agentId: agentRecord.id, role: options.role ?? null },
        `Unassigned ${agentRecord.name} from ${projectRecord.name}${options.role ? ` (${options.role})` : ''}`,
      )
    }))

  const spec = program.command('spec').description('Manage specs')
  spec
    .command('list <projectName>')
    .description('List specs for project')
    .action(createAction(deps, async (ctx, projectName: string) => {
      const projectRecord = await requireProjectByName(ctx.api, projectName)
      const specs = await ctx.api.listSpecs(projectRecord.id)
      ctx.write(specs, formatTable([
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
      ], specs.map((item) => ({ id: item.id, name: item.name, status: formatStatusBadge(item.status) }))))
    }))
  spec
    .command('create <projectName> <name>')
    .option('--document <text>', 'Spec document', '')
    .description('Create spec')
    .action(createAction(deps, async (
      ctx,
      projectName: string,
      name: string,
      options: { document: string },
    ) => {
      const projectRecord = await requireProjectByName(ctx.api, projectName)
      const created = await ctx.api.createSpec(projectRecord.id, {
        name,
        document: options.document,
      })
      ctx.write(created, formatSummaryRows({ id: created.id, name: created.name, status: created.status }))
    }))
  spec
    .command('approve <specId>')
    .description('Approve spec')
    .action(createAction(deps, async (ctx, specId: string) => {
      const updated = await ctx.api.approveSpec(specId)
      ctx.write(updated, `Approved spec ${updated.id}`)
    }))
  registerSpecImportCommand(spec, deps)
  registerSpecIntakeCommand(spec, deps)
  registerSpecBakeoffCommands(spec, deps)

  const task = program.command('task').description('Manage tasks')
  task
    .command('list <specRef>')
    .option('--project <name>', 'Project name when resolving a spec by name')
    .description('List tasks for a spec id or name')
    .action(createAction(deps, async (ctx, specRef: string, options: { project?: string }) => {
      const specRecord = await requireSpecByNameOrId(ctx.api, specRef, options.project)
      const [tasks, agents] = await Promise.all([ctx.api.listTasks(specRecord.id), ctx.api.listAgents()])
      const depsByTask = new Map(
        await Promise.all(tasks.map(async (item) => [item.id, await ctx.api.listTaskDependencies(item.id)] as const)),
      )
      ctx.write(tasks, formatTable([
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'agent', label: 'AGENT' },
        { key: 'deps', label: 'DEPS', align: 'right' },
      ], tasks.map((item) => ({
        id: item.id,
        name: item.name,
        status: formatStatusBadge(item.status),
        agent: displayName(agents, item.assignedAgentId),
        deps: depsByTask.get(item.id)?.length ?? 0,
      }))))
    }))
  task
    .command('create <specId> <name>')
    .option('--file <path>', 'Prompt file')
    .option('--repo <repo>', 'Repository', splitCsv, [])
    .option('--verify <step>', 'Verification step', splitCsv, [])
    .option('--agent <name>', 'Assigned agent name')
    .option('--role <role>', 'Required project role')
    .description('Create task')
    .action(createAction(deps, async (
      ctx,
      specId: string,
      name: string,
      options: { file?: string; repo: string[]; verify: string[]; agent?: string; role?: string },
    ) => {
      const prompt = (await readPromptInput(ctx.stdin, options.file)).trim()
      if (prompt === '') {
        throw new Error('Task prompt cannot be empty')
      }
      const assignedAgent = options.agent == null ? null : await requireAgentByName(ctx.api, options.agent)
      const created = await ctx.api.createTask(specId, {
        name,
        prompt,
        repos: options.repo,
        verification: options.verify,
        assignedAgentId: assignedAgent?.id ?? undefined,
        requiredRole: options.role as never,
      })
      ctx.write(created, formatSummaryRows({ id: created.id, name: created.name, status: created.status }))
    }))
  task
    .command('depend <taskId> <dependsOnId>')
    .description('Add task dependency')
    .action(createAction(deps, async (ctx, taskId: string, dependsOnId: string) => {
      const dependency = await ctx.api.addTaskDependency(taskId, dependsOnId)
      ctx.write(dependency, `Added dependency ${dependency.dependsOnId} -> ${dependency.taskId}`)
    }))
  task
    .command('assign <taskId> <agentName>')
    .description('Assign or retarget a task to an agent')
    .action(createAction(deps, async (ctx, taskId: string, agentName: string) => {
      const agentRecord = await requireAgentByName(ctx.api, agentName)
      const updated = await ctx.api.assignTaskAgent(taskId, agentRecord.id)
      ctx.write(updated, `Assigned task ${updated.name} to ${agentRecord.name}`)
    }))
  task
    .command('dag <specRef>')
    .option('--project <name>', 'Project name when resolving a spec by name')
    .description('Show task DAG for a spec id or name')
    .action(createAction(deps, async (ctx, specRef: string, options: { project?: string }) => {
      const specRecord = await requireSpecByNameOrId(ctx.api, specRef, options.project)
      const tasks = await ctx.api.listTasks(specRecord.id)
      const dependencies = (await Promise.all(tasks.map((item) => ctx.api.listTaskDependencies(item.id)))).flat()
      const ascii = formatTaskDag(tasks, dependencies)
      ctx.write({ specId: specRecord.id, tasks, dependencies, ascii }, ascii)
    }))
}
