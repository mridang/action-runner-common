# Runner Common Setup GitHub Action

A composite GitHub Action that bundles the common first-step setup applied at the top of every workflow across all of my repos. One `uses:` line replaces the boilerplate of hardening the runner and configuring Docker layer caching, with both upstream actions pinned by full commit SHA.

## Features

- **Runner Hardening**: Invokes [`step-security/harden-runner`](https://github.com/step-security/harden-runner) with a configurable egress policy (default `audit`) to observe or enforce outbound traffic from the runner.
- **Docker Image Cache**: Invokes [`ScribeMD/docker-cache`](https://github.com/ScribeMD/docker-cache) to persist pulled and built Docker images across workflow runs, dramatically reducing pull time on subsequent jobs.
- **Pinned by SHA**: Every upstream action is pinned to a full commit SHA, not a floating tag, so consumer workflows never have to audit the dependency graph themselves.
- **Forward-Compatible Surface**: Future common setup steps land here behind toggle inputs, so consumer workflows pick them up by bumping the tag rather than editing each repo individually.

### Why?

- **Reusability**: This action is designed to be the universal first step in every workflow across every repo, eliminating copy-pasted setup boilerplate.
- **Supply-Chain Hygiene**: Upstream actions are pinned to full SHAs and audited once here, rather than per-workflow. Updates are reviewed and re-released centrally.
- **Forward-Compatible**: New shared concerns (extra caches, telemetry, environment setup) can be added behind toggle inputs without touching consumer workflows. Bump the tag, propagate everywhere.
- **Fast Execution**: Both bundled stages (hardening + Docker cache) are designed to add seconds, not minutes, to a job's startup time, while saving significant time on subsequent runs.

## Usage

To use this action, add it as the **first step** of every job in your workflow file.

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Runner Common Setup
        uses: mridang/action-runner-common@v1
        with:
          harden-egress-policy: 'audit' # Default is 'audit'
          docker-cache: 'true' # Default is 'true'

      - name: Checkout code
        uses: actions/checkout@v5

      # ...rest of the job
```

This action will harden the runner, prepare the Docker layer cache, and (on post) save the cache back. Toggle inputs let you opt individual stages out per job when they aren't needed (e.g. set `docker-cache: 'false'` on jobs that don't touch Docker).

### Inputs

- `harden-egress-policy` (optional, default: `'audit'`): Passed to `step-security/harden-runner`. One of `'audit'` or `'block'`. `'audit'` observes outbound traffic and reports it; `'block'` enforces an allowlist via `harden-allowed-endpoints`. Start with `'audit'` and graduate to `'block'` once the report is clean.
- `harden-allowed-endpoints` (optional, default: `''`): Newline-separated list of allowed endpoints, used when `harden-egress-policy` is `'block'`. Each entry is `host:port`, e.g. `api.github.com:443`.
- `harden-disable-sudo` (optional, default: `'false'`): Passed to `step-security/harden-runner`. When `'true'`, disables `sudo` on the runner. Recommended for jobs that don't need elevated privileges.
- `docker-cache` (optional, default: `'true'`): When `'false'`, skips the Docker cache step entirely. Set this on jobs that don't touch Docker.
- `docker-cache-key` (optional, default: `''`): Override the cache key passed to `ScribeMD/docker-cache`. When empty, a sensible default is derived from `runner.os`, `github.workflow`, and `github.job`.
- `docker-cache-read-only` (optional, default: `'false'`): When `'true'`, restores the Docker cache but does not save it on cache miss. Recommended for PR branches to avoid cache pollution from untrusted code.

## Outputs

None

### Stages

What this action actually does, in order:

- **`step-security/harden-runner@0634a26`** (v2.12.0): Installs the StepSecurity agent and applies the configured egress policy. Surfaces a per-job runtime summary linking to the policy report.
- **`ScribeMD/docker-cache@fb28c93`** (0.5.0): Restores cached Docker images on the pre-step and saves them back on the post-step via `actions/cache`. The cache key defaults to `docker-cache-${{ runner.os }}-${{ github.workflow }}-${{ github.job }}`.

Both upstream actions are pinned by full commit SHA. Updating an upstream means bumping the SHA in [`action.yml`](action.yml) and cutting a new release of this action — consumers do not need to audit the change themselves.

## Known Issues

- `ScribeMD/docker-cache` does not support `restore-keys` (partial cache restoration) by design — see its README for the reasoning. The cache key must match exactly for a hit.
- `harden-egress-policy: 'block'` requires every outbound host to be listed in `harden-allowed-endpoints`, including hosts used by tools your job invokes (npm registry, package CDNs, etc.). Start with `'audit'`, review the runtime report, then graduate to `'block'`.
- This action is intended to be the **first** step of every job. Placing it after `actions/checkout` or other steps is supported but defeats the purpose of hardening the runner before user code runs.

## Useful links

- **[step-security/harden-runner](https://github.com/step-security/harden-runner):** The runner-hardening action this composite wraps. Read its docs to understand egress policies and the StepSecurity report.
- **[ScribeMD/docker-cache](https://github.com/ScribeMD/docker-cache):** The Docker layer caching action this composite wraps.
- **[Pinning Actions by SHA](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions):** GitHub's guidance on why every third-party action in this repo is pinned by full commit SHA rather than tag.

## Contributing

If you have suggestions for how this app could be improved, or
want to report a bug, open an issue—we'd love all and any
contributions.

## License

Apache License 2.0 © 2025 Mridang Agarwalla
