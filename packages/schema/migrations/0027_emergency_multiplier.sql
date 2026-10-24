-- ===========================================================================
-- 0027 — AN EMERGENCY IS SETTLED AT A MULTIPLE OF THE RATE.
--
-- (Partner answer 2026-10-24: "1.5x multiplier on each rate card".) An
-- emergency is a job's priority, not a service, so 0026 left the old
-- EMERG-CALL rates as text with no code to carry them. The premium now lives
-- on the rate it multiplies:
--
--   rate_cards.emergency_multiplier_bp  basis points, 15000 = 1.5x; every
--                       existing rate takes the default. Integer, because
--                       the money path carries no float.
--   settlement_lines    a line's amount is quantity x rate, and on an
--                       emergency job x the card's multiplier — one division,
--                       half away from zero (domain/money ratedAmount). A
--                       line priced any other way is refused, on every path:
--                       nothing writes lines yet but rows, and whatever
--                       issues statements later cannot price an emergency at
--                       the plain rate.
--
-- The EMERG-CALL rows 0026 left as text stay as they are: the multiplier
-- replaces them, and the office retires them when it next sets that firm's
-- rates.
-- ===========================================================================
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS emergency_multiplier_bp integer NOT NULL DEFAULT 15000 CHECK (emergency_multiplier_bp >= 10000);
COMMENT ON COLUMN rate_cards.emergency_multiplier_bp IS '0027: an emergency job is settled at the rate x this, in basis points (15000 = 1.5x).';

CREATE OR REPLACE FUNCTION ac_settlement_line_is_priced() RETURNS TRIGGER AS $$
DECLARE rc RECORD; prio text; bp numeric; x numeric; expected numeric;
BEGIN
  SELECT rate_minor, emergency_multiplier_bp INTO rc FROM rate_cards WHERE id = NEW.rate_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement line names rate card % that is not visible here', NEW.rate_card_id USING ERRCODE = 'AC422';
  END IF;
  SELECT priority INTO prio FROM jobs WHERE id = NEW.job_id;
  bp := CASE WHEN prio = 'emergency' THEN rc.emergency_multiplier_bp ELSE 10000 END;
  x := NEW.quantity_milli::numeric * rc.rate_minor * bp;
  expected := sign(x) * floor((abs(x) + 5000000) / 10000000);
  IF NEW.amount_minor <> expected THEN
    RAISE EXCEPTION 'settlement line amount % is not quantity x rate%: % x % = %', NEW.amount_minor,
      CASE WHEN bp <> 10000 THEN format(' x the emergency multiplier (%s bp)', bp) ELSE '' END,
      trim_scale(NEW.quantity_milli::numeric / 1000), rc.rate_minor, expected
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_settlement_line_is_priced ON settlement_lines;
CREATE TRIGGER ac_settlement_line_is_priced BEFORE INSERT OR UPDATE OF job_id, rate_card_id, quantity_milli, amount_minor ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION ac_settlement_line_is_priced();
