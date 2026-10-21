import { SURFACES, admits } from "../../../packages/contracts/src/surfaces.ts";
import type { SurfaceId } from "../../../packages/contracts/src/surfaces.ts";
import type { Namespace } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";

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
  readonly scopeTier: Tier; readonly scopeId: string; readonly scopeName: string | null;
  readonly firmId: string | null; readonly firmName: string | null;
  readonly crewId: string | null; readonly crewLabel: string | null; readonly crewEmployment: "employed" | "subcontracted" | null;
  readonly active: boolean;
};

const REGISTRY_KINDS = ["S2", "S3", "S4", "S6", "S7", "S8"] as const;

export const kindsOf = (u: Pick<UserRecord, "namespace" | "roles" | "crewId">): readonly KindId[] => {
  const ids: KindId[] = REGISTRY_KINDS.filter((id) => admits(id, u));
  if (u.crewId !== null) ids.push("S5");
  return ids.length > 0 ? ids : ["other"];
};
