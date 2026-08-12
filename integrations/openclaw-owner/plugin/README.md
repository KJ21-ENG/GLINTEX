# GLINTEX Owner Operations plugin

This plugin gives exactly one OpenClaw agent a fixed GLINTEX capability surface.
It never exposes shell, filesystem, browser, deployment, payment, messaging, or
database tools.

Reads go to the dedicated loopback agent API or the fixed read-only Tally report
API. Business writes are limited to owner tasks and governed learning proposals.
Every write is prepared first, then requires a fresh owner Telegram message in
the exact form `CONFIRM GLINTEX GLX-XXXXXXXXXX`, and must be verified after it
executes.

The raw agent token must exist only in the configured absolute file with mode
`0600`. The OpenClaw config must set the plugin entry's
`hooks.allowConversationAccess` to `true`; the hook uses only the structured
current turn to enforce one-time confirmation.
