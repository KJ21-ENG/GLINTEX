-- Add only the missing Shift line to this event. Keep all custom text, routing,
-- enabled flags, and attribution intact; never rerun the full template seed.
WITH target AS (
  SELECT "id", "template",
    CASE WHEN strpos("template", E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END AS newline
  FROM "WhatsappTemplate"
  WHERE "event" = 'receive_from_coning_machine_created'
    AND "template" !~ $re$@shift(?![A-Za-z0-9_.])|\{\{[[:space:]]*shift[[:space:]]*\}\}$re$
  FOR UPDATE
), amended AS (
  SELECT "id", "template", newline,
    regexp_replace(
      "template",
      $re$(^|\n)([^\n]*(@date(?![A-Za-z0-9_.])|\{\{[[:space:]]*date[[:space:]]*\}\})[^\n]*)$re$,
      E'\\1🕒 *Shift:* @shift' || newline || E'\\2'
    ) AS with_shift
  FROM target
)
UPDATE "WhatsappTemplate" AS stored
SET "template" = CASE
  WHEN amended.with_shift <> amended."template" THEN amended.with_shift
  ELSE amended."template"
    || CASE WHEN amended."template" = '' OR right(amended."template", 1) = E'\n' THEN '' ELSE amended.newline END
    || '🕒 *Shift:* @shift'
END
FROM amended
WHERE stored."id" = amended."id";
