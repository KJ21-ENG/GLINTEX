# Record and action schema

## Read envelope

```text
glintex_read({
  resource,
  process?, id?, search?, status?, area?, category?, action?,
  dateFrom?, dateTo?, order?, cursor?, page?, limit?,
  side?, party?, company?, offset?
})
```

Use only fields that apply to the selected resource. Limits are at most 100.
Production ranges are inclusive, use `YYYY-MM-DD`, and cannot exceed 93 days.
The adapter rejects unknown fields, unsupported processes, arbitrary URLs, and
responses above its configured size cap.

## Action preparation envelope

Every mutation begins with exactly one `glintex_prepare_action` call containing:

```text
{
  action,
  idempotencyKey,
  reason,
  data
}
```

Use a stable, unique idempotency key between 8 and 128 safe characters. The
reason must state the owner's business intent. Preparation validates and stores
a preview; it does not change the target entity.

### Create an owner task

```text
action: owner_task.create
data: {
  title,
  description?,
  area?,
  priority?,
  dueDate?
}
```

`title` is required and at most 160 characters. `description` is nullable and at
most 2,000 characters. `dueDate` is nullable and uses `YYYY-MM-DD`.

### Update an owner task

```text
action: owner_task.update
data: {
  taskId,
  expectedVersion,
  patch: { title?, description?, area?, priority?, status?, dueDate? }
}
```

Read the exact task immediately before preparation and copy its current positive
integer `version` into `expectedVersion`. The patch must change at least one
supported field.

### Complete or cancel an owner task

```text
action: owner_task.complete | owner_task.cancel
data: { taskId, expectedVersion }
```

These actions require the same fresh-version rule.

### Propose a learning candidate

```text
action: learning_candidate.propose
data: { category, statement, evidence? }
```

The statement is at most 1,000 characters and evidence is nullable and at most
2,000 characters. The only effect is a review candidate.

## Confirmation and verification

After preparation, show the complete preview, expiry, and returned command. Stop
and wait for a new owner message consisting exactly of:

```text
CONFIRM GLINTEX GLX-XXXXXXXXXX
```

Only then call `glintex_execute_action` with the returned operation ID and code.
After a successful execution, always call `glintex_verify_action` with that
operation ID before claiming completion. Never repair, shorten, infer, or reuse
a confirmation command.
