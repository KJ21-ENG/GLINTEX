# Record schema

The only tool envelope is:

```text
glintex_read({
  resource,
  process?, id?, barcode?, search?, status?,
  dateFrom?, dateTo?, view?, order?, cursor?, limit?, page?
})
```

Use only fields relevant to the selected resource. The tool rejects unknown
fields, unsupported processes, arbitrary paths, production ranges over 93 days,
and limits over 100.

There is no write envelope in phase one. Creates, updates, deletes, reversals,
mark-paid actions, exports, sends, attachments, and dry-run mutations are all
unavailable. Never construct a payload for them or describe a read as a change.
