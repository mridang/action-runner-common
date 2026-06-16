export default {
  entry: ['stages/docker-cache/src/main.ts', 'stages/docker-cache/src/post.ts'],
  ignoreDependencies: [/^@semantic-release\//, 'semantic-release-major-tag'],
};
