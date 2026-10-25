# Releasing

Releases are tag-driven: pushing a `v*` tag runs
`.github/workflows/release.yml`, which checks the tag against `package.json`,
runs the tests, and publishes to npm with a provenance attestation.

## One-time setup: npm scope and trusted publishing

1. The package is scoped (`@stijnus/dsh-moodboard`); the publishing npm account
   must own the `@stijnus` scope. `publishConfig.access` is already `public`.
2. Configure npm trusted publishing for the package
   (<https://www.npmjs.com/package/@stijnus/dsh-moodboard> → **Settings** →
   **Trusted publishing**):
   - Organization or user: `Stijnus`
   - Repository: `dsh-moodboard`
   - Workflow filename: `release.yml`
   - Environment: leave empty
   - Allowed actions: enable direct `npm publish`
3. For the very first publication (the package does not exist yet), add the
   same trusted-publisher configuration as a **pending** publisher before the
   tag is pushed, and complete it within two days. Alternatively publish `0.1.0`
   once with an interactive `npm login`, then configure trusted publishing for
   later tags. Never commit a token.

Without trusted publishing the workflow still runs tests and tag checks, then
fails at the publish step.

## Cut a release

```bash
npm version patch --no-git-tag-version   # or minor / major
# move the [Unreleased] entries in CHANGELOG.md under the new version

release_version="$(node -p "require('./package.json').version")"
git add -A
git commit -m "${release_version}: <summary>"
git tag -a "v${release_version}" -m "${release_version}"
git push origin main
git push origin "v${release_version}"
```

The tag push starts the release workflow. It checks that the tag matches
`package.json`, runs `npm test`, skips an already published version, publishes
with provenance, and waits until the version is visible on npm.

## Verify

```bash
npm test
npm pack --dry-run
npm view @stijnus/dsh-moodboard version
npm view "@stijnus/dsh-moodboard@${release_version}" dist.attestations
```

Then install the exact packed tarball into a throwaway profile and check the
panel, agent tool, HTTP API and persistence before announcing the release.
Keep the release notes honest about what was and was not exercised.

## Notes

- npm publishes asynchronously: `npm view` can lag by minutes.
- Do not publish the same version from two places while a tag workflow runs.
- Bump `version` in `package.json` only through `npm version` or an equivalent
  edit, and keep `engines.dsh` at the tested Harness range.
