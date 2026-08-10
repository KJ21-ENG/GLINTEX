import { Type } from 'typebox';

const optionalString = (description: string, maxLength = 200) =>
  Type.Optional(Type.String({ minLength: 1, maxLength, description }));

const dateString = (description: string) =>
  Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description }));

const process = Type.Optional(
  Type.Union([
    Type.Literal('cutter'),
    Type.Literal('holo'),
    Type.Literal('coning'),
  ]),
);

export const readParameters = Type.Object(
  {
    resource: Type.Union([
      Type.Literal('health'),
      Type.Literal('reference'),
      Type.Literal('issues'),
      Type.Literal('receives'),
      Type.Literal('on_machine'),
      Type.Literal('stock'),
      Type.Literal('production'),
      Type.Literal('barcode_history'),
      Type.Literal('contractor_settlements'),
    ]),
    process,
    id: optionalString('Exact GLINTEX record ID.', 120),
    barcode: optionalString('Exact barcode to trace.', 160),
    search: optionalString('Bounded case-insensitive search text.', 120),
    status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('paid')])),
    dateFrom: dateString('Inclusive YYYY-MM-DD start date.'),
    dateTo: dateString('Inclusive YYYY-MM-DD end date.'),
    view: Type.Optional(
      Type.Union([
        Type.Literal('machine'),
        Type.Literal('operator'),
        Type.Literal('shift'),
        Type.Literal('item'),
        Type.Literal('yarn'),
      ]),
    ),
    order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
    cursor: optionalString('Opaque cursor returned by a previous read.', 500),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  },
  { additionalProperties: false },
);

export const pluginConfigSchema = Type.Object(
  {
    baseUrl: Type.String({ description: 'GLINTEX production base URL.' }),
    apiTokenFile: Type.String({ description: 'Absolute mode-0600 token file.' }),
    allowedAgentId: Type.String({ minLength: 1 }),
    requestTimeoutMs: Type.Optional(
      Type.Integer({ minimum: 1_000, maximum: 60_000, default: 20_000 }),
    ),
    maxResponseBytes: Type.Optional(
      Type.Integer({ minimum: 65_536, maximum: 4_194_304, default: 2_097_152 }),
    ),
  },
  { additionalProperties: false },
);
