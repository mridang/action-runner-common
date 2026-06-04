module.exports = {
  entry: [
    'src/index.ts',
    'stages/docker-cache/src/main.ts',
    'stages/docker-cache/src/post.ts',
    'stages/generic-cache/src/main.ts',
    'stages/generic-cache/src/post.ts',
  ],
  ignoreDependencies: [
    '@semantic-release/.*?',
    '@commitlint/config-conventional',
  ],
};
