# Security policy

## Supported versions

GET TO IT is under active development. Security fixes are applied to the `main`
branch; no older release line is maintained.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting:

https://github.com/eugenemcmillian3-tech/get-to-it/security/advisories/new

Include the affected route or component, reproduction steps, and the impact you
believe it has. Do not include real credentials, personal data, or data from a
production project. If you accidentally include a secret, rotate it and say so
without repeating the value.

Reports are reviewed on a best-effort basis. There is no bug bounty and no
guaranteed response time. Please give a reasonable window to investigate and
ship a fix before disclosing publicly.

## Scope

In scope: authentication and authorization boundaries, Row Level Security,
server-side request handling, secret handling, and the CI and release path.

Out of scope: denial-of-service testing against a deployment you do not own,
social engineering, and findings that require a compromised account or host.
