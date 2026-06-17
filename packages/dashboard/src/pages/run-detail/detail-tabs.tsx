import type { Decision, Evidence, GateEvaluation, RunActivity, RunStageTransition, RunUpdate } from '@/api/client'
import { Card, CardHeader, tokens } from '@/components/signal'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActivityTab } from './activity-tab'
import { DecisionsTab, EvidenceTab, GatesTab, TransitionsTab, UpdatesTab } from './evidence-tabs'

export function RunDetailTabs({
  activity,
  evidence,
  transitions,
  gates,
  decisions,
  updates,
}: {
  activity: RunActivity[]
  evidence: Evidence[]
  transitions: RunStageTransition[]
  gates: GateEvaluation[]
  decisions: Decision[]
  updates: RunUpdate[]
}) {
  return (
    <Card pad={0}>
      <div style={{ padding: '20px 24px 0' }}>
        <CardHeader title="Attempt detail" meta="activity · evidence · transitions · gates · decisions · updates" />
      </div>
      <div style={{ padding: '0 24px 24px' }}>
        <Tabs defaultValue="activity">
          <TabsList style={{ background: tokens.raised }}>
            <TabsTrigger value="activity" className="font-mono text-xs">
              Activity <span className="ml-1 text-muted-foreground/50">({activity.length})</span>
            </TabsTrigger>
            <TabsTrigger value="evidence" className="font-mono text-xs">
              Evidence <span className="ml-1 text-muted-foreground/50">({evidence.length})</span>
            </TabsTrigger>
            <TabsTrigger value="transitions" className="font-mono text-xs">
              Transitions <span className="ml-1 text-muted-foreground/50">({transitions.length})</span>
            </TabsTrigger>
            <TabsTrigger value="gates" className="font-mono text-xs">
              Gates <span className="ml-1 text-muted-foreground/50">({gates.length})</span>
            </TabsTrigger>
            <TabsTrigger value="decisions" className="font-mono text-xs">
              Decisions <span className="ml-1 text-muted-foreground/50">({decisions.length})</span>
            </TabsTrigger>
            <TabsTrigger value="updates" className="font-mono text-xs">
              Updates <span className="ml-1 text-muted-foreground/50">({updates.length})</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="activity" className="mt-4"><ActivityTab activity={activity} /></TabsContent>
          <TabsContent value="evidence" className="mt-4"><EvidenceTab evidence={evidence} /></TabsContent>
          <TabsContent value="transitions" className="mt-4"><TransitionsTab transitions={transitions} /></TabsContent>
          <TabsContent value="gates" className="mt-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Gates are workflow checks Ductum evaluated for this attempt. Every recorded evaluation is listed with its target, result, and reason.
            </p>
            <GatesTab gates={gates} />
          </TabsContent>
          <TabsContent value="decisions" className="mt-4"><DecisionsTab decisions={decisions} /></TabsContent>
          <TabsContent value="updates" className="mt-4"><UpdatesTab updates={updates} /></TabsContent>
        </Tabs>
      </div>
    </Card>
  )
}
