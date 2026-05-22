# Security Policy

## Supported Versions

Dove's DataViewer is a continuously deployed web app. Security fixes are applied
to the latest release on the `main` branch, which is what powers
[hackthetrack.net](https://hackthetrack.net). Older tagged releases are not
separately patched.

| Version | Supported |
|---------|-----------|
| Latest `main` / newest tag | ✅ |
| Older tags | ❌ |

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, report privately through one of:

- GitHub's [private vulnerability reporting](https://github.com/TheAngryRaven/DovesDataViewer/security/advisories/new)
  (**Security → Report a vulnerability**), or
- a direct message to the maintainer ([@TheAngryRaven](https://github.com/TheAngryRaven)).

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce (a proof of concept if possible).
- Affected area (e.g. a specific parser, the BLE flow, the admin backend).

## What to Expect

- An acknowledgement of your report, typically within a few days.
- An assessment and, if confirmed, a fix on `main` as quickly as is practical.
- Credit for the discovery if you'd like it (let us know your preference).

## Scope Notes

The core app is **offline-first and client-side**: telemetry files are parsed
entirely in the browser and never uploaded. The most relevant areas for
security review are therefore:

- **File parsers** (`src/lib/*Parser.ts`) — these handle untrusted user files.
- **The optional admin backend** (Supabase edge functions in
  `supabase/functions/`) — the only server-side surface, and only active when
  admin is enabled.
- **The BLE device flow** (`src/lib/ble/`) — data exchanged with the
  DovesDataLogger hardware.

Thank you for helping keep the project and its users safe.
