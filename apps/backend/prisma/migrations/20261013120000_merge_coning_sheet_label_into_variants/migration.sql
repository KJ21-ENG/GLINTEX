-- "Issue to coning · A4 sheet" was a label of its own; it becomes variants of "Issue to coning".
-- Its saved designs are appended to the coning issue variants (the design in use is unchanged).
-- The old rows stay, so desktop apps that predate the merge keep printing until they update.
DO $$
DECLARE
  sheet jsonb;
  current jsonb;
  live jsonb;
  merged jsonb;
  item jsonb;
  new_id text;
  new_name text;
  stamp text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT content->'variants' INTO sheet FROM "StickerTemplate" WHERE "stageKey" = 'v2v:coning_issue_sheet';
  IF sheet IS NULL OR jsonb_typeof(sheet) <> 'array' OR jsonb_array_length(sheet) = 0 THEN
    SELECT jsonb_build_array(jsonb_build_object('id', 'standard', 'name', 'Standard', 'template', content, 'updatedAt', stamp))
      INTO sheet FROM "StickerTemplate" WHERE "stageKey" = 'v2:coning_issue_sheet';
  END IF;
  IF sheet IS NULL THEN RETURN; END IF;

  SELECT content INTO current FROM "StickerTemplate" WHERE "stageKey" = 'v2v:coning_issue';
  IF current IS NULL OR jsonb_typeof(current->'variants') <> 'array' THEN
    SELECT content INTO live FROM "StickerTemplate" WHERE "stageKey" = 'v2:coning_issue';
    -- Only the old designer's row exists: the designer converts it; nothing to merge into here.
    IF live IS NULL THEN RETURN; END IF;
    current := jsonb_build_object('version', 1, 'activeId', 'standard',
      'variants', jsonb_build_array(jsonb_build_object('id', 'standard', 'name', 'Standard', 'template', live, 'updatedAt', stamp)));
  END IF;

  merged := current->'variants';
  FOR item IN SELECT value FROM jsonb_array_elements(sheet) LOOP
    new_id := CASE WHEN item->>'id' = 'standard' THEN 'a4-sheet' ELSE left('sheet-' || (item->>'id'), 40) END;
    new_name := CASE WHEN item->>'name' = 'Standard' THEN 'A4 sheet' ELSE left(item->>'name', 54) END;
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(merged) v WHERE v->>'id' = new_id);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(merged) v WHERE lower(v->>'name') = lower(new_name)) THEN
      new_name := new_name || ' (A4)';
    END IF;
    EXIT WHEN jsonb_array_length(merged) >= 20;
    merged := merged || jsonb_build_array(jsonb_build_object('id', new_id, 'name', new_name, 'template', item->'template',
      'updatedAt', coalesce(item->>'updatedAt', stamp)));
  END LOOP;

  INSERT INTO "StickerTemplate" ("id", "stageKey", "dimensions", "content", "createdAt", "updatedAt")
  VALUES ('template-v2v-coning_issue-merged', 'v2v:coning_issue',
    jsonb_build_object('kind', 'variants', 'count', jsonb_array_length(merged)),
    jsonb_set(current, '{variants}', merged), now(), now())
  ON CONFLICT ("stageKey") DO UPDATE SET
    "dimensions" = EXCLUDED."dimensions", "content" = EXCLUDED."content", "updatedAt" = now();
END $$;
