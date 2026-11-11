/**
 * @file Knip configuration that declares the docker-cache entrypoints.
 */
export default {
  entry: ['stages/docker-cache/src/main.ts', 'stages/docker-cache/src/post.ts'],
  ignoreDependencies: [/^@semantic-release\//, 'semantic-release-major-tag'],
};
