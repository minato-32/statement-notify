
# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes are released against the latest published
`0.x` version only. Pin a version and upgrade to the latest patch to receive fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security reports.

Report privately via GitHub's [private vulnerability reporting](https://github.com/minato-32/statement-notify/security/advisories/new)
("Security" tab → "Report a vulnerability"). Include:

- affected version(s),
- a description of the issue and its impact,
- reproduction steps or a proof of concept, if available.

You can expect an initial acknowledgement within 7 days. Once a fix is available,
a patched version is published to npm and an advisory is issued.

## Scope

This package ships runtime logic only (no native code, no install/lifecycle
scripts, no network or filesystem access of its own). Persistence and transport
are provided by the host application through injected adapters, so most security
properties depend on how the consumer wires those adapters.
