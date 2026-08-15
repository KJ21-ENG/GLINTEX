import { Type } from 'typebox';

const optionalText = (description: string, maxLength = 200) => Type.Optional(
  Type.String({ minLength: 1, maxLength, description }),
);
const nullableText = (description: string, maxLength = 2_000) => Type.Optional(
  Type.Union([Type.String({ minLength: 1, maxLength, description }), Type.Null()]),
);
const date = (description: string) => Type.Optional(
  Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description }),
);

export const readParameters = Type.Object({
  resource: Type.Union([
    Type.Literal('health'),
    Type.Literal('reference'),
    Type.Literal('issues'),
    Type.Literal('receives'),
    Type.Literal('on_machine'),
    Type.Literal('stock'),
    Type.Literal('production'),
    Type.Literal('contractor_settlements'),
    Type.Literal('finance_outstanding'),
    Type.Literal('finance_runs'),
    Type.Literal('owner_tasks'),
    Type.Literal('learning_candidates'),
    Type.Literal('operation_history'),
    Type.Literal('system_status'),
  ]),
  process: Type.Optional(Type.Union([
    Type.Literal('cutter'),
    Type.Literal('holo'),
    Type.Literal('coning'),
    Type.Literal('all'),
  ])),
  id: optionalText('Exact record identifier.', 120),
  search: optionalText('Bounded case-insensitive search text.', 120),
  status: optionalText('Resource-specific status filter.', 40),
  area: optionalText('Owner-task area filter.', 40),
  category: optionalText('Learning-candidate category filter.', 60),
  action: optionalText('Operation action filter.', 80),
  dateFrom: date('Inclusive YYYY-MM-DD start date.'),
  dateTo: date('Inclusive YYYY-MM-DD end date.'),
  dateBasis: Type.Optional(Type.Union([
    Type.Literal('business', { description: 'Filter by the stored work/business date.' }),
    Type.Literal('record', { description: 'Filter by record creation date in Asia/Kolkata.' }),
  ])),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  cursor: optionalText('Opaque cursor returned by a previous read.', 500),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  side: Type.Optional(Type.Union([Type.Literal('debtor'), Type.Literal('creditor')])),
  party: optionalText('Tally party-name filter.', 200),
  company: optionalText('Tally company filter.', 300),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
}, { additionalProperties: false });

const commonAction = {
  idempotencyKey: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' }),
  reason: Type.String({ minLength: 1, maxLength: 500 }),
};

const taskArea = Type.Union([
  Type.Literal('FINANCE'),
  Type.Literal('INVENTORY'),
  Type.Literal('TECHNOLOGY'),
  Type.Literal('APPLICATION'),
  Type.Literal('OPERATIONS'),
  Type.Literal('GENERAL'),
]);
const priority = Type.Union([
  Type.Literal('LOW'),
  Type.Literal('MEDIUM'),
  Type.Literal('HIGH'),
  Type.Literal('URGENT'),
]);
const taskStatus = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('BLOCKED'),
  Type.Literal('DONE'),
  Type.Literal('CANCELLED'),
]);

// Keep one root object because the OpenClaw provider's strict tool-schema
// conversion retains only the first branch of a root union. This remains a
// bounded superset: unknown keys are rejected here, while the agent API applies
// the action-specific required/forbidden-field contract before preparation.
export const prepareActionParameters = Type.Object({
  action: Type.Union([
    Type.Literal('owner_task.create'),
    Type.Literal('owner_task.update'),
    Type.Literal('owner_task.complete'),
    Type.Literal('owner_task.cancel'),
    Type.Literal('learning_candidate.propose'),
  ]),
  ...commonAction,
  data: Type.Object({
    title: optionalText('Required only for owner_task.create.', 160),
    description: nullableText('Task description; owner_task.create only.'),
    area: Type.Optional(taskArea),
    priority: Type.Optional(priority),
    dueDate: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
    taskId: optionalText('Required for owner-task update, complete, or cancel.', 80),
    expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    patch: Type.Optional(Type.Object({
      title: optionalText('Replacement title.', 160),
      description: nullableText('Replacement description.'),
      area: Type.Optional(taskArea),
      priority: Type.Optional(priority),
      status: Type.Optional(taskStatus),
      dueDate: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])),
    }, { additionalProperties: false, minProperties: 1 })),
    category: Type.Optional(Type.Union([
      Type.Literal('OWNER_PREFERENCE'),
      Type.Literal('DOMAIN_RULE'),
      Type.Literal('WORKFLOW_GAP'),
      Type.Literal('PROCESS_IMPROVEMENT'),
    ])),
    statement: optionalText('Required only for learning_candidate.propose.', 1_000),
    evidence: nullableText('Bounded evidence; learning_candidate.propose only.'),
  }, { additionalProperties: false, minProperties: 1 }),
}, { additionalProperties: false });

export const executeActionParameters = Type.Object({
  operationId: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }),
  confirmationCode: Type.String({ pattern: '^GLX-[A-F0-9]{10}$' }),
}, { additionalProperties: false });

export const verifyActionParameters = Type.Object({
  operationId: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }),
}, { additionalProperties: false });

export const pluginConfigSchema = Type.Object({
  baseUrl: Type.String(),
  tallyBaseUrl: Type.String(),
  apiTokenFile: Type.String(),
  allowedAgentId: Type.String({ pattern: '^[a-z][a-z0-9-]{2,63}$' }),
  ownerTelegramId: Type.String({ pattern: '^\\d{5,20}$' }),
  requestTimeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 60_000, default: 20_000 })),
  maxResponseBytes: Type.Optional(Type.Integer({ minimum: 65_536, maximum: 4_194_304, default: 2_097_152 })),
}, { additionalProperties: false });
