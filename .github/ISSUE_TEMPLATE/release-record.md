---
name: Release record
about: Record merge, post-merge E2E, deployment and approval evidence for a production release.
title: "Release: "
labels: ""
assignees: ""
---

A blank required field means **NO-GO**. See the release checklist in
[OPERATIONS.md](https://github.com/eugenemcmillian3-tech/get-to-it/blob/main/OPERATIONS.md#release-checklist).

## Release record

| Field | Value |
| --- | --- |
| Release date (UTC) | `________` |
| Pre-merge source revision (`npm run release:check`) | `________` |
| PR | `________` |
| Merge revision on `main` | `________` |
| Post-merge E2E run URL | `________` |
| Post-merge E2E result | `________` |
| Production deployment ID | `________` |
| Production `/api/health` revision | `________` |
| Manual smoke checks | `________` |
| Rollback / backup reference (if applicable) | `________` |
| Approved by / UTC | `________` |

After merging, run:

```bash
npm run check:e2e:post-merge -- --commit <merge-sha>
```

The checker prints this block with the merge revision and E2E run URL filled in.
The URL must be the push run on `main`, not the advisory pull-request run.
