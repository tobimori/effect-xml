# Changesets

Changesets record user-visible changes and control package versions.

1. Run `vp run changeset` for each user-visible change.
2. Select the version change and write a concise summary.
3. Commit the generated Markdown file with the implementation.

After changes reach `main`, the release workflow updates a release pull request. Merging that pull request publishes the package and creates a GitHub release.

Repository setup requires:

- npm trusted publishing for `tobimori/effect-xml` and `release.yml`
- Permission for GitHub Actions to create pull requests
