import noDbInSurface from "./rules/no-db-in-surface.js";
import noCrossBillingImport from "./rules/no-cross-billing-import.js";
import noEmploymentTypeInField from "./rules/no-employment-type-in-field.js";
import noFloatMoney from "./rules/no-float-money.js";
import noClockInDomain from "./rules/no-clock-in-domain.js";
import noStorageBypass from "./rules/no-storage-bypass.js";
import noClearanceForgery from "./rules/no-clearance-forgery.js";
import noFetchInSurface from "./rules/no-fetch-in-surface.js";

/**
 * Eight rules. All "error". None "warn".
 *
 * A warning is a rule that has decided not to be one. Every rule here maps to a
 * commitment whose violation converts a later phase into a rewrite, so there is
 * nothing for a warning to express.
 */
export default {
  rules: {
    "no-db-in-surface": noDbInSurface,
    "no-cross-billing-import": noCrossBillingImport,
    "no-employment-type-in-field": noEmploymentTypeInField,
    "no-float-money": noFloatMoney,
    "no-clock-in-domain": noClockInDomain,
    "no-storage-bypass": noStorageBypass,
    "no-clearance-forgery": noClearanceForgery,
    "no-fetch-in-surface": noFetchInSurface,
  },
};
