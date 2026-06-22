// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/shared/node-app-scaffold/node-local-paths`
 * Purpose: Unit-prove the FOUNDATION allowlist parser + the foundation matcher and its COMPLEMENT
 *   (node-local) matcher — the SSOT carve-out polarity for fork sync (enumerate foundation; Tier 3 is
 *   everything else, sovereign-by-default).
 * Scope: Pure (`parseFoundationPaths` + `makeFoundationMatcher` + `makeNodeLocalMatcher`); no IO.
 * Links: src/shared/node-app-scaffold/node-local-paths.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOUNDATION_PATHS,
  makeFoundationMatcher,
  makeNodeLocalMatcher,
  parseFoundationPaths,
} from "@/shared/node-app-scaffold/node-local-paths";

describe("parseFoundationPaths", () => {
  it("returns the declared foundation block when present", () => {
    const yaml = `schema: 2
foundation:
  - "app/src/app/api/**"
  - "packages/**"
exclude:
  - ".git/**"
`;
    expect(parseFoundationPaths(yaml)).toEqual([
      "app/src/app/api/**",
      "packages/**",
    ]);
  });

  it("falls back to the default floor when the manifest has no foundation block", () => {
    const yaml = `schema: 2
exclude:
  - ".git/**"
`;
    expect(parseFoundationPaths(yaml)).toBe(DEFAULT_FOUNDATION_PATHS);
  });

  it("falls back to the default floor when foundation is empty", () => {
    expect(parseFoundationPaths("schema: 2\nfoundation: []\n")).toBe(
      DEFAULT_FOUNDATION_PATHS
    );
  });

  it("falls back to the default floor on missing / malformed input (fail-safe)", () => {
    expect(parseFoundationPaths(null)).toBe(DEFAULT_FOUNDATION_PATHS);
    expect(parseFoundationPaths(undefined)).toBe(DEFAULT_FOUNDATION_PATHS);
    expect(parseFoundationPaths(": : not : yaml : [")).toBe(
      DEFAULT_FOUNDATION_PATHS
    );
  });

  it("default floor is the platform substrate, never presentation/identity", () => {
    expect(DEFAULT_FOUNDATION_PATHS).toContain("app/src/app/api/**");
    expect(DEFAULT_FOUNDATION_PATHS).toContain("packages/**");
    // The node's FACE is the complement — it must NOT be enumerated as foundation.
    expect(DEFAULT_FOUNDATION_PATHS).not.toContain("app/src/app/(public)/**");
    expect(DEFAULT_FOUNDATION_PATHS).not.toContain(".cogni/repo-spec.yaml");
  });
});

describe("makeFoundationMatcher", () => {
  const isFoundation = makeFoundationMatcher([
    "app/src/app/api/**",
    "packages/**",
  ]);

  it("matches foundation substrate paths (deep)", () => {
    expect(isFoundation("app/src/app/api/v1/cognition/_bundle.ts")).toBe(true);
    expect(isFoundation("packages/knowledge-base/src/seeds/base.ts")).toBe(
      true
    );
  });

  it("does NOT match non-foundation paths", () => {
    expect(isFoundation("app/src/app/(public)/page.tsx")).toBe(false);
    expect(isFoundation(".cogni/repo-spec.yaml")).toBe(false);
  });
});

describe("makeNodeLocalMatcher (Tier 3 = the COMPLEMENT of foundation)", () => {
  const FOUNDATION = [
    ".github/workflows/ci.yaml",
    "app/src/app/api/**",
    "app/src/shared/**",
    "packages/**",
  ];
  const isNodeLocal = makeNodeLocalMatcher(FOUNDATION);

  it("treats foundation paths as NOT node-local", () => {
    expect(isNodeLocal("app/src/app/api/v1/cognition/_bundle.ts")).toBe(false);
    expect(isNodeLocal("packages/knowledge-base/src/seeds/base.ts")).toBe(
      false
    );
    expect(isNodeLocal("app/src/shared/env/server-env.ts")).toBe(false);
    expect(isNodeLocal(".github/workflows/ci.yaml")).toBe(false);
  });

  it("treats node identity/presentation as node-local (the complement)", () => {
    expect(isNodeLocal("app/src/app/(public)/page.tsx")).toBe(true);
    expect(isNodeLocal("app/src/app/(public)/landing/hero/Hero.tsx")).toBe(
      true
    );
    expect(isNodeLocal("app/src/features/home/components/Pitch.tsx")).toBe(true);
    expect(isNodeLocal(".cogni/repo-spec.yaml")).toBe(true);
    expect(isNodeLocal("public/branding/logo.svg")).toBe(true);
  });

  it("treats an UNKNOWN new node path as sovereign (node-local) by default", () => {
    // A brand-new product surface the operator never anticipated must default to the fork's own —
    // sovereign-by-default. This is the load-bearing safety property of the inverted polarity.
    expect(isNodeLocal("app/src/features/whatever-new-product/page.tsx")).toBe(
      true
    );
    expect(isNodeLocal("some/totally/novel/path.ts")).toBe(true);
  });

  it("empty foundation ⇒ EVERYTHING is node-local (fail-closed: no upstream change lands)", () => {
    const allSovereign = makeNodeLocalMatcher([]);
    expect(allSovereign("app/src/app/api/v1/cognition/_bundle.ts")).toBe(true);
    expect(allSovereign("packages/anything.ts")).toBe(true);
  });
});
