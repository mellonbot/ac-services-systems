-- Crew notes.
--
-- A dispatcher wants to leave freeform commentary on a job so the next shift
-- has context. It is a note, not operational state — no money, no routing, no
-- compliance. Written by hand rather than through operationalTable() because
-- the emitter is for the backbone and this is a text field on a job.
CREATE TABLE IF NOT EXISTS crew_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS crew_notes_assignment_id_idx ON crew_notes (assignment_id);
