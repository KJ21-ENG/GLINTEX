-- An intermediate, unreleased rehearsal migration briefly installed this
-- trigger. Remove it idempotently so any copied rehearsal database converges
-- on the same nullable old-writer semantics as fresh and production installs.
DROP TRIGGER IF EXISTS classify_holo_receive_wastage_bucket
  ON "ReceiveFromHoloMachineRow";
DROP FUNCTION IF EXISTS classify_holo_receive_wastage_bucket();
