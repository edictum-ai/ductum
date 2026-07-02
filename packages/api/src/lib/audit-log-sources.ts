export function auditRowsSql(): string {
  return `
    WITH audit_rows AS (
      SELECT
        'decision:' || d.id AS id, 'decision' AS source, d.id AS sourceId,
        d.created_at AS occurred_at, d.decided_by AS actor,
        coalesce(ds.project_id, dts.project_id, rts.project_id) AS project_id,
        coalesce(dsp.name, dtp.name, rtp.name) AS project_name,
        coalesce(d.spec_id, dt.spec_id, rt.spec_id) AS spec_id,
        coalesce(ds.name, dts.name, rts.name) AS spec_name,
        coalesce(d.task_id, rr.task_id) AS task_id,
        coalesce(dt.name, rt.name) AS task_name,
        d.run_id AS run_id,
        'decision' AS event_type, 'recorded' AS status,
        d.decision AS title, d.context AS summary, '{}' AS metadata
      FROM decisions d
      LEFT JOIN runs rr ON rr.id = d.run_id
      LEFT JOIN tasks rt ON rt.id = rr.task_id
      LEFT JOIN specs rts ON rts.id = rt.spec_id
      LEFT JOIN projects rtp ON rtp.id = rts.project_id
      LEFT JOIN tasks dt ON dt.id = d.task_id
      LEFT JOIN specs dts ON dts.id = dt.spec_id
      LEFT JOIN projects dtp ON dtp.id = dts.project_id
      LEFT JOIN specs ds ON ds.id = d.spec_id
      LEFT JOIN projects dsp ON dsp.id = ds.project_id

      UNION ALL
      SELECT
        'stage:' || h.id, 'run_stage', cast(h.id AS TEXT), h.created_at,
        coalesce(a.name, 'system'), p.id, p.name, s.id, s.name, t.id, t.name, r.id,
        'run.stage', h.to_stage, 'Run stage changed',
        coalesce(h.reason, h.from_stage || ' -> ' || h.to_stage), '{}'
      FROM run_stage_history h
      JOIN runs r ON r.id = h.run_id
      JOIN tasks t ON t.id = r.task_id
      JOIN specs s ON s.id = t.spec_id
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN agents a ON a.id = r.agent_id

      UNION ALL
      SELECT
        'update:' || u.id, 'run_update', cast(u.id AS TEXT), u.created_at,
        CASE WHEN lower(u.message) LIKE 'operator %' THEN 'operator' ELSE coalesce(a.name, 'system') END,
        p.id, p.name, s.id, s.name, t.id, t.name, r.id,
        CASE WHEN lower(u.message) LIKE 'operator %' THEN 'run.recovery' ELSE 'run.update' END,
        'recorded', 'Run update', u.message, '{}'
      FROM run_updates u
      JOIN runs r ON r.id = u.run_id
      JOIN tasks t ON t.id = r.task_id
      JOIN specs s ON s.id = t.spec_id
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN agents a ON a.id = r.agent_id

      UNION ALL
      SELECT
        'secret:' || l.id, 'secret_access', l.id, l.attempted_at,
        coalesce(a.name, CASE WHEN l.agent_id IS NULL THEN 'operator' ELSE 'unknown' END),
        p.id, p.name, s.id, s.name, t.id, t.name, r.id,
        'secret.access', l.outcome, 'FactorySecret access',
        CASE WHEN l.error_message IS NULL
          THEN 'secret:' || coalesce(l.secret_id, 'unknown')
          ELSE l.error_message
        END,
        CASE WHEN l.secret_id IS NULL THEN '{}' ELSE '{"secretRef":"secret:' || replace(l.secret_id, '"', '') || '"}' END
      FROM factory_secret_access_log l
      LEFT JOIN runs r ON r.id = l.run_id
      LEFT JOIN tasks t ON t.id = r.task_id
      LEFT JOIN specs s ON s.id = t.spec_id
      LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN agents a ON a.id = l.agent_id

      UNION ALL
      SELECT
        'event:' || e.id, 'audit_event', e.id, e.occurred_at, e.actor,
        coalesce(ep.id, sp.id, tp.id, rp.id), coalesce(ep.name, sp.name, tp.name, rp.name),
        coalesce(e.spec_id, tt.spec_id, rt.spec_id), coalesce(es.name, ts.name, rs.name),
        coalesce(e.task_id, rr.task_id), coalesce(et.name, rt.name), e.run_id,
        e.event_type, e.status, e.title, e.summary, e.metadata
      FROM audit_events e
      LEFT JOIN projects ep ON ep.id = e.project_id
      LEFT JOIN specs es ON es.id = e.spec_id
      LEFT JOIN projects sp ON sp.id = es.project_id
      LEFT JOIN tasks et ON et.id = e.task_id
      LEFT JOIN specs ts ON ts.id = et.spec_id
      LEFT JOIN projects tp ON tp.id = ts.project_id
      LEFT JOIN runs rr ON rr.id = e.run_id
      LEFT JOIN tasks rt ON rt.id = rr.task_id
      LEFT JOIN specs rs ON rs.id = rt.spec_id
      LEFT JOIN projects rp ON rp.id = rs.project_id
      LEFT JOIN tasks tt ON tt.id = e.task_id
    )
    SELECT * FROM audit_rows
  `
}
