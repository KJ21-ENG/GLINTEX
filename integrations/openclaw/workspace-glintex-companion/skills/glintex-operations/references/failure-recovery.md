# Failure recovery

- **Unauthorized owner context:** when `glintex_read` returns its owner-context
  error, call no further GLINTEX tool and explain that the direct chat is not
  verified for this deployment. Do not preemptively deny merely because the
  visible prompt omits the runtime's hidden owner flag.
- **Backend token not configured:** report that live GLINTEX reads are not yet
  enabled; do not request or expose the token in chat.
- **Backend credential rejected:** report that the production read identity is
  inactive or misconfigured. Never describe this as a sender or owner-verification
  failure.
- **Forbidden scope:** name the unavailable GLINTEX area and stop. Never look for
  a broader tool or credential.
- **Validation:** correct only an objective resource, process, date, or limit
  mismatch. Ask if a correction changes the business meaning.
- **Timeout or size limit:** narrow the date range, search, process, page, or limit
  once. Do not loop blindly.
- **Empty result:** restate exact filters and ask one focused question before
  broadening them.
- **Conflicting lineage or totals:** show both sources, compact arithmetic, and the
  missing or contradictory evidence. Do not silently choose the convenient row.
- **Unavailable mutation:** state that phase one is read-only. Never imply that a
  record, attachment, payment, message, or deployment changed.
