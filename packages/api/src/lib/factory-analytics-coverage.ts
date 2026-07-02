export function coverageKindCaseSql(): string {
  return `
    CASE
      WHEN cost_usd > 0 THEN 'known'
      WHEN (tokens_in > 0 OR tokens_out > 0) THEN 'price_missing'
      WHEN terminal_state IS NULL AND stage != 'done' THEN 'pending'
      ELSE 'usage_missing'
    END
  `
}

export function coverageReasonCaseSql(): string {
  return `
    CASE
      WHEN (${coverageKindCaseSql()}) = 'price_missing' THEN 'price_missing'
      WHEN COALESCE(NULLIF(runs.runtime_model, ''), agents.model, '') LIKE 'recorded:%' THEN 'operator_recorded'
      ELSE 'scanner_missing'
    END
  `
}
