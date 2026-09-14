# infra

Non-negotiable #10: infrastructure as code **from the first server**, not after
the third one is already hand-configured and nobody remembers which.

This directory is a build target, and WS-A A5 gates on it existing before
anything is racked. It is empty because no infrastructure decision has been made
yet — that is D7, the only non-negotiable in §7.2 with no mechanism behind it.

What lands here, and what each is holding:

- `network/` — regions are the shard boundary; the VPC layout has to make
  `region_id` routable rather than merely present
- `database/` — Postgres, the four roles from `migrations/0002`, and the
  restore-test schedule (#11, an operations calendar item with a name attached)
- `monitoring/` — external by construction. Monitoring that lives on the thing it
  monitors reports green while the thing is on fire (#12)
- `storage/` — object storage behind `packages/storage`'s key scheme
