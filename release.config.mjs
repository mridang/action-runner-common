// noinspection JSUnusedGlobalSymbols
export default {
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'npm run build',
      },
    ],
    [
      '@semantic-release/github',
      {
        // Drop release-asset uploads entirely: consumers pin to a tag and
        // checkout the repo, which already contains action.yml + dist. The
        // multi-stage layout has two main.cjs files (root + stages/) which
        // collide on basename when uploaded as release assets (422).
        assets: [],
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'package-lock.json', 'dist', 'stages/**/dist'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    'semantic-release-major-tag',
  ],
  repositoryUrl: 'git+https://github.com/mridang/action-runner-common.git',
};
