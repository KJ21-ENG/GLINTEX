# Data Models - Local Print Service

No persistent database model.

## Runtime In-Memory Structures
- `jobQueue`: bounded history (max 100 jobs).
- `pendingJobs`: execution queue for serialized print dispatch.
- Job object fields: `id`, `at`, `printer`, `type`, `bytes`, `status`, `error?`.

