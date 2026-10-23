-- ===========================================================================
-- 0022 — ONE LIVE CREW PER JOB.
--
-- (Whole-repo review, 2026-10-22.) Nothing held a job to one live
-- assignment: two dispatchers, or one double-click, left two, and every board
-- read that joins the live assignment listed the job twice. The handler now
-- locks the job and refuses a job that is not waiting for a crew; this index
-- is the same rule where no handler can skip it.
--
-- Any job that already holds more than one live assignment keeps the newest;
-- the others are released, with the reason saying why.
-- ===========================================================================
UPDATE assignments a SET released_at = now(), release_reason = 'superseded: one live crew per job (0022)'
 WHERE a.released_at IS NULL
   AND EXISTS (SELECT 1 FROM assignments b
                WHERE b.job_id = a.job_id AND b.released_at IS NULL
                  AND (b.assigned_at, b.id) > (a.assigned_at, a.id));

CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_live_per_job ON assignments (job_id) WHERE released_at IS NULL;
