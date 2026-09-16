/**
 * PR TITLES — a pull request is named after what it changes, or it is not named.
 *
 * GitHub titles a PR from the BRANCH when it cannot title it from a single
 * commit, which is how "Claude/site design branding rksmnj" ended up on a full
 * rebrand — and why that rebrand sat unmerged while `main` moved past it. A
 * title nobody can read is a review nobody does.
 *
 * The rule is narrow on purpose: this rewrites a title only when GitHub wrote
 * it, never when a person did. The two shapes a machine produces are the branch
 * name spelled out, and a commit subject truncated at GitHub's 72-character
 * ceiling with the tail pushed into the body. Everything else is left alone —
 * a guard that overwrites human judgement gets switched off within a week.
 */

import { fileURLToPath } from "node:url";

/** A commit, as much of one as this file needs. `parents` is how a merge is spotted. */
export type PrCommit = { readonly subject: string; readonly body: string; readonly parents: number };

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * GitHub's fallback title is the branch with its separators spelled as spaces:
 * `claude/site-design-branding-rksmnj` → "Claude/site design branding rksmnj".
 * Compared on alphanumerics only, so the punctuation it picks does not matter.
 */
export const isBranchDerived = (title: string, branch: string): boolean => norm(title) === norm(branch);

/** GitHub cuts a commit subject at 72 chars and marks the cut. The tail lands in the body. */
export const isTruncated = (title: string): boolean => /(?:…|\.\.\.)\s*$/.test(title);

/** Only these three. A title a person typed is never touched. */
export const needsTitle = (title: string, branch: string): boolean =>
  title.trim() === "" || isBranchDerived(title, branch) || isTruncated(title);

/**
 * The headline is the first non-merge commit: the one GitHub would have used
 * had the PR been a single commit, and in a stack of three reliably the change
 * the other two serve.
 */
export const titleFrom = (commits: readonly PrCommit[]): string | null =>
  commits.find((c) => c.parents < 2)?.subject.trim() || null;

/**
 * A body is written only when there is none. The first commit's message carries
 * the reasoning; the rest are listed so a reviewer sees the shape of the stack
 * without opening the commits tab.
 */
export const bodyFrom = (commits: readonly PrCommit[]): string | null => {
  const real = commits.filter((c) => c.parents < 2);
  const head = real[0];
  if (!head) return null;
  const rest = real.slice(1);
  const lines = [head.body.trim()];
  if (rest.length) lines.push(`### Also in this branch\n\n${rest.map((c) => `- ${c.subject}`).join("\n")}`);
  const out = lines.filter(Boolean).join("\n\n").trim();
  return out || null;
};

/**
 * When GitHub truncated the subject it left the tail as the body's first line.
 * Restoring the full title would otherwise strand that fragment above the real
 * description — which is exactly what PR #7 carried for a day.
 */
export const stripTruncatedTail = (body: string, fullTitle: string): string => {
  const m = body.match(/^\s*(?:…|\.\.\.)\s*(.*?)(?:\r?\n|$)/);
  if (!m) return body;
  const tail = (m[1] ?? "").trim();
  return tail && fullTitle.endsWith(tail) ? body.slice(m[0].length).replace(/^\s+/, "") : body;
};

/** The decision, with no network in it — which is the whole reason it is testable. */
export const retitle = (
  pr: { readonly title: string; readonly body: string; readonly branch: string },
  commits: readonly PrCommit[],
): { readonly title?: string; readonly body?: string } => {
  if (!needsTitle(pr.title, pr.branch)) return {};
  const title = titleFrom(commits);
  if (!title) return {};
  const patch: { title: string; body?: string } = { title };
  const existing = stripTruncatedTail(pr.body ?? "", title).trim();
  if (!existing) {
    const body = bodyFrom(commits);
    if (body) patch.body = body;
  } else if (existing !== (pr.body ?? "").trim()) {
    patch.body = existing;
  }
  return patch;
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { GITHUB_REPOSITORY: repo, PR_NUMBER: number, GITHUB_TOKEN: token } = process.env;
  if (!repo || !number || !token) {
    console.error("pr-title: GITHUB_REPOSITORY, PR_NUMBER and GITHUB_TOKEN are required");
    process.exit(1);
  }
  const api = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`pr-title: ${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const pr = (await api(`pulls/${number}`)) as { title: string; body: string | null; head: { ref: string } };
  const raw = (await api(`pulls/${number}/commits?per_page=100`)) as readonly {
    commit: { message: string };
    parents?: readonly unknown[];
  }[];
  const commits: PrCommit[] = raw.map((c) => {
    const [subject = "", ...rest] = c.commit.message.split(/\r?\n/);
    return { subject, body: rest.join("\n").trim(), parents: c.parents?.length ?? 1 };
  });

  const patch = retitle({ title: pr.title, body: pr.body ?? "", branch: pr.head.ref }, commits);
  if (!Object.keys(patch).length) {
    console.log(`pr-title: #${number} is named after what it changes — left alone`);
  } else {
    await api(`pulls/${number}`, { method: "PATCH", body: JSON.stringify(patch) });
    console.log(`pr-title: #${number} → ${patch.title}`);
  }
}
