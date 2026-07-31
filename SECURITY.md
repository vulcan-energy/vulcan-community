# Security policy

## Supported versions

Vulcan Community has not made a public release. Until it does, reports against
the current `main` branch are accepted. After versioned releases begin, the most
recent release and `main` will be supported; older releases are not supported
unless their release notes say otherwise.

Forks, modified builds and private Vulcan products are not supported under this
policy.

## Reporting a vulnerability

Do not open a public issue. Email `info@usevulcan.app` with **Security report** in
the subject and include, where possible:

- the affected component, release or commit;
- reproduction steps and the expected impact;
- whether credentials, personal data, private source or local files may be
  exposed; and
- a safe contact method for follow-up.

Home Energy Foundry Limited targets acknowledgement within 7 calendar days and
an initial scope and severity assessment within 21 calendar days. These are
response targets, not remediation deadlines. Fix and disclosure timing depends on
the impact, complexity and release path and will be discussed with the reporter.

## Scope

In scope:

- vulnerabilities in code in this repository or an official Vulcan Community
  artifact built from it;
- unintended access to files outside those selected by the user;
- code execution, script injection or sandbox escape caused by untrusted project,
  CSV, JSON or IFC input; and
- a dependency or build-integrity issue with a demonstrated impact on an official
  artifact.

Out of scope:

- the hosted Vulcan service, MCP Helper, Vulcan Analyst and other private products
  (report these privately to the same address, but this policy does not govern
  their handling);
- forks, unofficial builds and unsupported revisions;
- social engineering, denial-of-service testing or automated scanning of hosted
  services;
- dependency version reports without a demonstrated path to impact; and
- HEM/FHS modelling or calculation disagreements without a security impact.

## Safe harbour and coordinated disclosure

When researching in good faith, use only accounts, files and devices you own or
have permission to test. Stop after confirming the issue. Do not access other
people's data, retain data, establish persistence, degrade a service or use an
issue beyond what is needed to demonstrate it.

If you follow this policy, Home Energy Foundry Limited will treat your research as
authorised for the purpose of the Computer Misuse Act 1990 and will not initiate
legal action against you for accidental, good-faith violations of this policy. We
cannot authorise testing of third-party systems or bind third parties.

Please allow a reasonable opportunity to investigate and remedy a confirmed issue
before publishing details. We will work with you on a disclosure date and credit,
if wanted, but cannot promise a particular remediation date.
