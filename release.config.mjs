// noinspection JSUnusedGlobalSymbols
export default {
  branches: ['master'],
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
        assets: ['action.yml', 'dist/**', 'stages/**/dist/**'],
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
