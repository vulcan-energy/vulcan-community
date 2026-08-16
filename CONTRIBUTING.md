# Contributing to Vulcan Community

Issues, bug reports, design discussion and interoperability feedback are welcome.
Code and substantive documentation may be merged only after the contribution
requirements below are satisfied.

Participation is governed by `CODE_OF_CONDUCT.md`. Suspected vulnerabilities must
be reported through `SECURITY.md`, not a public issue.

## Preparing a change

Use Node.js 22 and install the locked dependencies with `npm ci`. For isolated
work, use `./scripts/new-worktree.sh <slug>`; its default profile prepares the
submodules and npm workspace, while raw `git worktree add` receives the same
setup after the managed hooks have been installed. Keep pull
requests focused and explain the behaviour changed. Before requesting review, run:

```text
npm test
npm run typecheck
npm run lint
npm run quality
```

`npm run lint` reports the full current lint result; `npm run quality` is the
enforcing baseline check. Include the results in the pull request and explain any
check that was not run or did not pass.

## Contributor agreement

- Every individual contributor and co-author must have an accepted
  `CLA-INDIVIDUAL.md` on record.
- If an employer or other legal entity owns or may own the contribution, an
  authorised representative must also execute `CLA-ENTITY.md` and identify the
  covered contributor.
- Clearly non-copyrightable corrections, such as an isolated typo or factual
  correction, may be exempted in writing by a maintainer. All code and substantive
  documentation require a CLA.
- The CLAs cover only code, documentation or other authored material intentionally
  offered for inclusion through a pull request, patch or another contribution
  channel expressly designated in writing. Issue reports, feature requests,
  reviews, design discussion and verbal conversation are not CLA submissions
  unless specific material is expressly designated in writing by both sides.
- Individual acceptance is automated. On your first pull request, the CLA check
  posts a comment linking `CLA-INDIVIDUAL.md`; read the agreement, then reply
  with the acceptance statement it specifies, exactly, from your own GitHub
  account. The check records your GitHub handle, the date and the pull request
  in `signatures/v1.1/cla.json` on the `cla-signatures` branch of this
  repository and passes for all your future pull requests. A revised agreement
  starts a new signature file, so acceptance always names the version accepted.
- If you cannot use the automated process, sign `CLA-INDIVIDUAL.md` and send it
  privately to `info@usevulcan.app`, including your GitHub handle and
  pull-request number. Do not commit signed agreements or personal addresses to
  a public repository.
- Entity agreements are handled by email, case by case. An authorised
  representative signs `CLA-ENTITY.md`, attaches the covered-contributor
  schedule specified there (one row per contributor, all requested columns), and
  sends it to `info@usevulcan.app`. Home Energy Foundry Limited countersigns and
  returns the copy by email; the target turnaround is 10 business days. Covered
  contributors are then added to the CLA check's allowlist so their pull
  requests pass automatically.
- A contribution may be merged only when every contributor and co-author is
  covered by a recorded automated acceptance, a written individual agreement or
  a countersigned entity agreement. Automated acceptances are recorded on the
  `cla-signatures` branch; written and entity agreements, which carry personal
  details, are held in a private register recording the agreement version, legal
  name, GitHub handle, employer/entity coverage, acceptance date and covered
  pull requests.

The selected agreements use the Harmony Contributor License Agreement copyright-
licence model and outbound Option Five. Contributors retain ownership, while Home
Energy Foundry Limited receives broad, irrevocable rights to use and sublicense
accepted contributions under open-source, commercial or proprietary terms. When
used under another licence, the contribution must also remain available under the
licence of the material to which it was submitted.

## Pull-request declaration

Every contributor must confirm in the pull request that:

1. they created the contribution or have identified every third-party portion and
   received written approval to submit it;
2. they have authority to grant the rights in the applicable CLA, including any
   required employer permission;
3. the contribution contains no employer, customer or other confidential material;
4. all dependencies and copied material are identified with their licences;
5. materially AI-generated or AI-transformed content is identified, including the
   tool used and the files or sections affected; and
6. all co-authors are named and covered by the appropriate agreements.

Disclosure does not make third-party or generated material acceptable. Maintainers
must still verify that the public AGPL distribution and Home Energy Foundry's
parallel proprietary use are both permitted.

## Licence and attribution changes

Changes to `LICENSE`, `NOTICE`, `ADDITIONAL_TERMS.md`, `ATTRIBUTION.md`,
`TRADEMARKS.md`, contributor agreements, provenance files, dependency policy or
the export manifest require explicit Home Energy Foundry owner approval. Coding
agents must follow the repository `AGENTS.md` and must not summarise, replace or
remove these files.

## Public/private boundary

The public repository is for the community editor, interoperability packages and
other paths explicitly listed in the approved export manifest. Authentication,
billing, hosted services, Pro features, MCP Helper, Vulcan Analyst, SAP calculation,
detailed thermal-bridge solving and internal integrations remain private.

General editor fixes, public APIs and file-format improvements should normally be
developed in the public project once it becomes canonical. Home Energy Foundry
retains discretion over whether a proposed contribution belongs in the public
product and is not obliged to accept any contribution.
