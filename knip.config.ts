export default {
  entry: ['stages/docker-cache/src/main.ts', 'stages/docker-cache/src/post.ts'],
  ignore: ['knip.config.ts'],
  ignoreDependencies: [/^@semantic-release\//],
};
