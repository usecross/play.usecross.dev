import runtime from '../packages/starters/runtime.json';

if (runtime.crossInertia.pullRequest && process.env.CROSS_INERTIA_ALLOW_UNRELEASED !== '1') {
  console.error(`Deployment blocked: this branch uses unreleased CrossInertia PR #146 (${runtime.crossInertia.revision}).
Merge/release the upstream fix and switch to a published wheel before normal production deployment.
For an explicitly approved candidate deployment only: CROSS_INERTIA_ALLOW_UNRELEASED=1 bun run deploy`);
  process.exit(1);
}
