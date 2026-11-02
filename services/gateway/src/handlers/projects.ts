import type { UnitOfWork } from "../db/unit-of-work.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import { requireUuid, requireText } from "./jobs.ts";
import { iso } from "../db/sql.ts";
import type {
  CreateProjectInput, CreateProjectOutput, ListProjectsInput, ListProjectsOutput, ProjectState,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * 0024 — WHAT AN INSTALL WAS SOLD UNDER. Every install job sits under a
 * project, and a project's foreman is the person who sold it.
 *
 *   - THE SELLER IS A FOREMAN. An active internal user holding `foreman`.
 *     Said here by name; 0024's ac_project_seller_is_a_foreman says it for
 *     every other path.
 *   - THE AGREEMENT IS IN FORCE. Nothing is sold under a draft or an ended one.
 *   - THE CUSTOMER AND REGION ARE THE AGREEMENT'S. Never typed in, the same
 *     rule a job follows from its site.
 */
const requireIso = (v: unknown, field: string): Date => {
  if (typeof v !== "string") throw new BadInput(`${field} is required`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadInput(`${field} must be an ISO datetime`);
  return d;
};

export const listProjects = async (uow: UnitOfWork, input: ListProjectsInput): Promise<ListProjectsOutput> => {
  const orgId = input.orgId === undefined || input.orgId === "" ? null : requireUuid(input.orgId, "orgId");
  const projects = await uow.tx.query<{
    id: string; org_id: string; region_id: string; contract_id: string; customer: string; name: string;
    foreman_id: string | null; foreman_name: string | null; ws: string; we: string; state: ProjectState; install_jobs: number;
  }>(
    `SELECT p.id, p.org_id, p.region_id, p.contract_id, o.name AS customer, p.name, p.foreman_id, u.display_name AS foreman_name,
            ${iso("lower(p.service_window)")} AS ws, ${iso("upper(p.service_window)")} AS we, p.state,
            (SELECT count(*)::int FROM jobs j WHERE j.project_id = p.id AND j.work_class = 'install') AS install_jobs
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       LEFT JOIN users u ON u.id = p.foreman_id
      WHERE ($1::uuid IS NULL OR p.org_id = $1)
      ORDER BY lower(p.service_window) DESC, p.name`,
    [orgId],
  );
  const foremen = await uow.tx.query<{ id: string; name: string }>(
    `SELECT id, display_name AS name FROM users WHERE namespace = 'internal' AND active AND roles ? 'foreman' ORDER BY display_name`,
  );
  return {
    projects: projects.map((p) => ({
      id: p.id, orgId: p.org_id, regionId: p.region_id, contractId: p.contract_id, customer: p.customer, name: p.name,
      foremanId: p.foreman_id, foremanName: p.foreman_name, serviceWindowStart: p.ws, serviceWindowEnd: p.we,
      state: p.state, installJobs: p.install_jobs,
    })),
    foremen,
  };
};

export const createProject = async (uow: UnitOfWork, input: CreateProjectInput, newId: () => string): Promise<CreateProjectOutput> => {
  const contractId = requireUuid(input.contractId, "contractId");
  const name = requireText(input.name, "name");
  const foremanId = requireUuid(input.foremanId, "foremanId");
  const windowStart = requireIso(input.serviceWindowStart, "serviceWindowStart");
  const windowEnd = requireIso(input.serviceWindowEnd, "serviceWindowEnd");
  if (windowEnd.getTime() <= windowStart.getTime()) throw new InputRefused("serviceWindowEnd must be after serviceWindowStart — an empty window is not a project", "bad_window");

  const contract = (await uow.tx.query<{ id: string; org_id: string; region_id: string; state: string }>(
    `SELECT id, org_id, region_id, state FROM contracts WHERE id = $1`, [contractId]))[0];
  if (!contract) throw new InputRefused(`no agreement ${contractId} visible in this scope`, "unknown_contract");
  if (contract.state !== "active") throw new InputRefused(`agreement ${contractId} is ${contract.state} — nothing is sold under an agreement that is not in force`, "contract_not_in_force");

  const seller = (await uow.tx.query<{ id: string; display_name: string; namespace: string; active: boolean; roles: string[] }>(
    `SELECT id, display_name, namespace, active, roles FROM users WHERE id = $1`, [foremanId]))[0];
  if (!seller || seller.namespace !== "internal") throw new InputRefused(`no one ${foremanId} on our staff`, "unknown_foreman");
  if (!seller.active || !seller.roles.includes("foreman")) {
    throw new InputRefused(`${seller.display_name} is not ${seller.active ? "a foreman" : "active"} — a project is sold by a foreman, and they stay on it as the person who sold it`, "not_a_foreman");
  }

  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "project", entityId: id, action: "project.create", topic: "project.created",
      before: null,
      after: { id, contractId, name, foremanId, serviceWindowStart: windowStart.toISOString(), serviceWindowEnd: windowEnd.toISOString(), state: "planned" },
      orgId: contract.org_id, regionId: contract.region_id,
      payload: { contractId, foremanId },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO projects (id, org_id, region_id, contract_id, name, foreman_id, service_window)
         VALUES ($1, $2, $3, $4, $5, $6, tstzrange($7::timestamptz, $8::timestamptz, '[)'))`,
        [id, contract.org_id, contract.region_id, contractId, name, foremanId, windowStart.toISOString(), windowEnd.toISOString()],
      );
    },
  );
  return { id, orgId: contract.org_id, regionId: contract.region_id, eventId };
};
