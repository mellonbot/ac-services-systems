-- ===========================================================================
-- 0026 — A FIRM'S RATE IS FOR A SERVICE WE OPEN JOBS FOR.
--
-- rate_cards.service_code was free text, upper-cased by the handler, and
-- 0025's catalogue never reached it: a rate could be set for HVAC_REPAIR
-- while every job is HVAC-REPAIR, and no settlement could ever join the two.
-- Now the rate is the catalogue's code, as a job's is:
--
--   rate_cards.service_code REFERENCES service_codes — NOT VALID, so a rate
--                           set before this migration under a code we
--                           cannot map stays readable (a settlement line may
--                           already cite it by id); every write from now on
--                           is checked. setRateCard refuses by name first.
--   the known spellings     are mapped, install ones included (a price is
--                           not a sale; 0025's reason for leaving install
--                           JOBS alone does not apply). A rename that would
--                           put two prices on one day for one firm and code
--                           is skipped — rate_cards_no_overlap would refuse
--                           it — and that row keeps its text for the office.
--   EMERG-CALL is not mapped. 0025 read an emergency JOB as a repair, which
--                           it is; an emergency RATE is a call-out premium,
--                           a different price, and folding it into the repair
--                           rate would re-price every repair. It keeps its
--                           text: the catalogue has no code for a priority.
-- ===========================================================================
WITH spelling(spelling, code) AS (VALUES
    ('HVAC-REPAIR', 'HVAC-REPAIR'), ('REPAIR-HVAC', 'HVAC-REPAIR'), ('REPAIRS', 'HVAC-REPAIR'), ('REPAIR', 'HVAC-REPAIR'),
    ('COMPRESSOR-REPLACEMENT', 'HVAC-REPAIR'),
    ('PM-VISIT', 'PM-VISIT'), ('PM-RTU', 'PM-VISIT'), ('PM-Q2', 'PM-VISIT'), ('PM-QTR', 'PM-VISIT'),
    ('PM-SPRING', 'PM-VISIT'), ('SPRING-TUNE-UP', 'PM-VISIT'), ('PM-ROUTE', 'PM-VISIT'),
    ('DIAGNOSTIC', 'DIAGNOSTIC'), ('WARRANTY-CALLBACK', 'WARRANTY-CALLBACK'),
    ('CONDENSER-INSTALL', 'EQUIPMENT-CHANGEOUT'), ('RTU-CHANGEOUT', 'EQUIPMENT-CHANGEOUT'), ('EQUIPMENT-CHANGEOUT', 'EQUIPMENT-CHANGEOUT'),
    ('NEW-INSTALL', 'NEW-INSTALL'), ('DUCTWORK', 'DUCTWORK'), ('STARTUP-COMMISSIONING', 'STARTUP-COMMISSIONING')
), target AS (
  -- Every rate with the code it would carry: its mapped code, or its own text.
  SELECT r.id, r.firm_id, r.effective, r.service_code, COALESCE(s.code, r.service_code) AS code
    FROM rate_cards r
    LEFT JOIN spelling s ON s.spelling = upper(regexp_replace(btrim(r.service_code), '[_ ]+', '-', 'g'))
)
UPDATE rate_cards r SET service_code = t.code
  FROM target t
 WHERE t.id = r.id AND t.code <> t.service_code
   AND EXISTS (SELECT 1 FROM service_codes c WHERE c.code = t.code)
   -- Two rows that would land on one firm, code and day: neither moves.
   AND NOT EXISTS (SELECT 1 FROM target o WHERE o.firm_id = t.firm_id AND o.id <> t.id AND o.code = t.code AND o.effective && t.effective);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_cards_service_code_fkey') THEN
    ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_service_code_fkey FOREIGN KEY (service_code) REFERENCES service_codes (code) NOT VALID;
  END IF;
END $$;
