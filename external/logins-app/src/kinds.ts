import { SURFACES, admits } from "../../../packages/contracts/src/surfaces.ts";
import type { SurfaceId } from "../../../packages/contracts/src/surfaces.ts";
import type { Namespace } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import type { CustomerSegment } from "../../../packages/contracts/src/operations.ts";

export type KindId = "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "other";
export type Kind = { readonly id: KindId; readonly name: string; readonly canAdd: boolean; readonly note?: string };

const fromRegistry = (id: Exclude<SurfaceId, "S1" | "S5">): Kind => ({ id, name: SURFACES[id].name, canAdd: true });

export const KINDS: readonly Kind[] = [
  fromRegistry("S2"),
  fromRegistry("S3"),
  fromRegistry("S4"),
  { id: "S5", name: "Technician", canAdd: true },
  fromRegistry("S6"),
  fromRegistry("S8"),
  { ...fromRegistry("S7"), canAdd: false, note: "not live yet" },
  { id: "other", name: "Other", canAdd: false },
];

export type UserRecord = {
  readonly id: string; readonly email: string; readonly displayName: string;
  readonly namespace: Namespace; readonly roles: readonly string[];
  readonly orgId: string; readonly orgName: string; readonly regionId: string; readonly regionCode: string;
  /** The customer's segment (0019); null for every org that is not a customer. */
  readonly orgSegment: CustomerSegment | null;
  readonly scopeTier: Tier; readonly scopeId: string; readonly scopeName: string | null;
  readonly firmId: string | null; readonly firmName: string | null;
  readonly crewId: string | null; readonly crewLabel: string | null; readonly crewEmployment: "employed" | "subcontracted" | null;
  /** A technician's crew (0024): its kind, its contractor firm, and whether it is their own service unit — no other active login on it. */
  readonly crewKind: "service" | "install" | null; readonly crewFirmName: string | null; readonly ownUnit: boolean;
  readonly active: boolean;
};

const REGISTRY_KINDS = ["S2", "S3", "S4", "S6", "S7", "S8"] as const;

export const kindsOf = (u: Pick<UserRecord, "namespace" | "roles" | "crewId"> & { readonly scopeTier?: Tier }): readonly KindId[] => {
  // The gateway refuses an org-wide surface (S2, S4) to a login scoped below the company, so it is not listed there.
  const scoped = (id: (typeof REGISTRY_KINDS)[number]) => SURFACES[id].scopeBinding !== "org" || u.scopeTier === undefined || u.scopeTier === "parent";
  const ids: KindId[] = REGISTRY_KINDS.filter((id) => admits(id, u) && scoped(id));
  if (u.crewId !== null) ids.push("S5");
  return ids.length > 0 ? ids : ["other"];
};
