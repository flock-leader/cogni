// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/node-app-scaffold/node-local-paths`
 * Purpose: FOUNDATION allowlist for the node-template→fork sync, and the derived "is this path
 *   node-local (Tier 3)?" predicate. The foundation (Tier 1 + Tier 2) is the ENUMERATED source of
 *   truth; Tier 3 is the COMPLEMENT (`everything − foundation`), never enumerated.
 * Scope: Pure — no IO. The facade reads node-template's `.cogni/sync-manifest.yaml#foundation` text via
 *   the App; this module turns it into a typed glob list + a matcher. Reused by the adapter to restore
 *   the fork's version of every path NOT in the foundation.
 * Invariants:
 *   - FOUNDATION_IS_ENUMERATED: the SSOT is the foundation (platform substrate), DECLARED in
 *     node-template's `.cogni/sync-manifest.yaml#foundation`. The operator never enumerates Tier 3.
 *   - TIER3_IS_THE_COMPLEMENT: a path is node-local (Tier 3) iff it is NOT in the foundation allowlist.
 *     This makes sovereignty the DEFAULT and the platform an opt-in allowlist (anti-BaaS to invert).
 *   - TIER3_NEVER_SYNCED: a Tier-3 path is carved OUT of the Tier-2 upstream merge — node-template is a
 *     starter, so its identity/presentation/product never overwrites a fork's. (spec.repo-sync-contract.)
 *   - Failure-mode asymmetry: missing a path in the foundation allowlist → a fork misses a substrate
 *     update (staleness, drift-detectable, NON-destructive). Enumerating Tier 3 instead would mean a
 *     missed entry silently clobbers a fork's sovereign code (destructive). Enumerate the safe-to-miss
 *     thing — the finite foundation — never the infinite product surface.
 * Side-effects: none
 * Links: .cogni/sync-manifest.yaml, src/app/_facades/deploy/canonical-fork-sync.server.ts,
 *   src/adapters/server/vcs/github-repo-write.ts, docs/spec/repo-sync-contract.md
 * @public
 */

import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Floor FOUNDATION set — used only when the source manifest carries no `foundation:` block (older
 * node-template revisions). The live SSOT is node-template's `.cogni/sync-manifest.yaml#foundation`.
 *
 * This is the platform substrate node-template owns and syncs into every fork: the irreducible plumbing
 * a Cogni node needs to BE a Cogni node. It deliberately does NOT include any presentation/identity/
 * product surface — those are Tier 3 by being absent here (TIER3_IS_THE_COMPLEMENT). Anything not listed
 * is sovereign-by-default and restored to the fork's own version inside the merge.
 *
 * NOTE: missing an entry here is NON-destructive (the fork just misses a substrate update — staleness,
 * drift-detectable), so this floor errs toward UNDER-claiming. A node-template PR that grows the shared
 * substrate adds the path to `.cogni/sync-manifest.yaml#foundation` in the same PR.
 */
export const DEFAULT_FOUNDATION_PATHS: readonly string[] = [
  // Tier 1 — the flight contract (force-overwritten by syncCanonicalFilesToFork). Listed here so the
  // Tier-2 merge carries them as foundation too (the two mechanisms agree, never fight).
  ".github/workflows/ci.yaml",
  ".github/workflows/pr-build.yml",
  ".github/workflows/pr-lint.yaml",
  "scripts/check-node-ci-workflow.mjs",
  // Tier 2 — foundational substrate (three-way merge). Below.
  // Cognition/runtime API surface — the platform seam every node exposes.
  "app/src/app/api/**",
  // Shared application substrate (env, logging, ports wiring, cross-cutting helpers).
  "app/src/shared/**",
  // Bootstrap / capability composition root.
  "app/src/bootstrap/**",
  // Graph runtime (agent graphs the platform ships).
  "graphs/**",
  // Workspace packages — knowledge-base/-store, db-schema, repo-spec, etc. (the platform libraries).
  "packages/**",
] as const;

/** Schema for the `foundation:` block of a sync manifest. Absent ⇒ fall back to the default floor. */
const FoundationManifestSchema = z.object({
  foundation: z.array(z.string().min(1)).optional(),
});

/**
 * Parse the FOUNDATION (Tier 1 + Tier 2) glob allowlist out of a `.cogni/sync-manifest.yaml` body.
 * Returns the declared list when present, else {@link DEFAULT_FOUNDATION_PATHS}. Malformed YAML / wrong
 * shape also falls back to the default floor (fail-safe: a parse error must never widen the foundation
 * to swallow the whole repo and clobber a fork's sovereign code).
 */
export function parseFoundationPaths(
  manifestYaml: string | null | undefined
): readonly string[] {
  if (!manifestYaml) return DEFAULT_FOUNDATION_PATHS;
  let parsed: unknown;
  try {
    parsed = parseYaml(manifestYaml);
  } catch {
    return DEFAULT_FOUNDATION_PATHS;
  }
  const result = FoundationManifestSchema.safeParse(parsed);
  if (!result.success || !result.data.foundation?.length) {
    return DEFAULT_FOUNDATION_PATHS;
  }
  return result.data.foundation;
}

const REGEX_META = new Set([
  ".",
  "+",
  "?",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
  "\\",
]);

/** Compile a single repo-relative glob (`**`, `*`) into an anchored RegExp. Mirrors detect-sync-drift.mjs. */
function globToRegex(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (REGEX_META.has(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Build a predicate that tests whether a repo-relative path is in the FOUNDATION allowlist (Tier 1 + 2).
 * Compiles each glob once; the returned closure is cheap to call per tree entry.
 */
export function makeFoundationMatcher(
  foundationPaths: readonly string[]
): (path: string) => boolean {
  const regexes = foundationPaths.map(globToRegex);
  return (path: string) => regexes.some((re) => re.test(path));
}

/**
 * Build a predicate that tests whether a repo-relative path is node-local (Tier 3) — the COMPLEMENT of
 * the foundation allowlist (`!isFoundation(path)`). Sovereign-by-default: any path NOT enumerated as
 * foundation is treated as the fork's own and restored inside the merge (TIER3_IS_THE_COMPLEMENT).
 */
export function makeNodeLocalMatcher(
  foundationPaths: readonly string[]
): (path: string) => boolean {
  const isFoundation = makeFoundationMatcher(foundationPaths);
  return (path: string) => !isFoundation(path);
}
