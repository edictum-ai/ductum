/**
 * Canonical public operator-model contract types live in
 * `@ductum/core` (`operator-contract` barrel) and are re-exported here for API
 * consumers that follow the existing ui-contract import pattern.
 */

export type {
  AttemptRuntimeSnapshot,
  OperatorAgent,
  OperatorAttempt,
  OperatorAttemptSnapshot,
  OperatorComponent,
  OperatorFactoryActivity,
  OperatorHarness,
  OperatorLifecycleStatus,
  OperatorModel,
  OperatorProject,
  OperatorProvider,
  OperatorPublicRecord,
  OperatorRecordBase,
  OperatorRecordType,
  OperatorRepair,
  OperatorRepository,
  OperatorSpec,
  OperatorTask,
  OperatorWorkflow,
  PublicContractIssue,
  PublicContractMissingDependency,
  SpecIntake,
  SpecIntakeComponent,
  SpecIntakeProject,
  SpecIntakeRepository,
  SpecIntakeSchemaVersion,
  SpecIntakeSpec,
  SpecIntakeTask,
  WorkPackage,
} from '@ductum/core'
