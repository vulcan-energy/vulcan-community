# Agent instructions for Vulcan Community

Licensing and attribution files must not be removed, summarised, rewritten or
replaced. Any application using covered editor components must preserve the Vulcan
origin notice described in `ATTRIBUTION.md`.

Agents working in this tree must also obey the following rules:

- Treat `licence-manifest.json` as the machine-readable path policy. Do not
  assign a licence to an unlisted path by guessing; unknown paths are excluded.
- Do not change a file's licence from its approved path-manifest entry.
- Do not move code between Apache-2.0, AGPL-3.0-only, CC BY 4.0 or
  upstream-licensed paths without explicit owner approval and provenance evidence.
- Never add Vulcan copyright or licence headers to `hem_engine_upstream/`,
  `hem_fhs_upstream/`, generated artifacts or third-party material.
- Do not remove or weaken SPDX headers, copyright statements, source links,
  `NOTICE`, `ADDITIONAL_TERMS.md`, `ATTRIBUTION.md`, `TRADEMARKS.md`,
  `CITATION.cff`, `vulcan-origin.json` or contributor-agreement requirements.
- Do not replace the full standard licence texts with summaries or URLs.
- Do not set release revisions or archives speculatively. Resolve them from the
  exact release revision and artifact provenance.
- Preserve third-party authorship, licence notices and public commit attribution.
  Never recreate an external contribution under an employee or agent identity.
- Treat unlisted or `pending` paths as excluded from public export.
- Run `node scripts/validate-licensing.mjs` after changing source paths,
  provenance, licence notices or dependency records.
- Require a human owner to approve changes to licensing, attribution, trademarks,
  contributor agreements, dependency policy and export/provenance manifests.

These are operational safeguards. They do not replace the applicable licence or
contributor agreement.

Routine work belongs in a separate worktree. Run
`./scripts/install-git-hooks.sh` once per clone, then use
`./scripts/new-worktree.sh <slug>`; its default profile prepares recursive
submodules and the locked npm workspace. The managed `post-checkout` hook also
prepares raw `git worktree add` worktrees. Do not use `git worktree add
--no-checkout` for developer worktrees because it suppresses the hook.
