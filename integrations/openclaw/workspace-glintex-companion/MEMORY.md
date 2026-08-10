# Memory policy

Keep only durable GLINTEX conventions and owner preferences here.

Do not store:

- live stock, balances, statuses, totals, settlement amounts, or record lists;
- credentials, tokens, secrets, or complete private documents;
- facts that can be read from GLINTEX;
- unverified assumptions.

For every current project fact, call `glintex_read`. When memory and live data
disagree, live data wins and the discrepancy should be reported.
