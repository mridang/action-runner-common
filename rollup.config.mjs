/**
 * @file Rollup configuration that bundles the action entrypoints into CommonJS
 * files under dist/ and stages/docker-cache/dist/.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`]);

/** Matches the node_modules directory in a module path. */
const NODE_MODULES_PATTERN = /node_modules/u;

/**
 * Rollup plugin that inlines the JSON files that bundled packages load with
 * `require()`, so the output has no runtime file lookups.
 */
class InlinePackageJsonPlugin {
  name = 'inline-json';

  async transform(code, id) {
    if (!id.includes('node_modules')) {
      return null;
    }

    const requirePattern =
      /require\((['"`])([-./\w]+?(?:package\.json|commitlint\.schema\.json))\1\)/gu;

    const matches = [...code.matchAll(requirePattern)];
    const replacements = await Promise.all(
      matches.map(async ([match, , requiredPath]) => {
        try {
          const filePath = path.resolve(path.dirname(id), requiredPath);
          return await readFile(filePath, 'utf8');
        } catch (error) {
          this.warn(
            `Failed to inline '${requiredPath}' for ${id}: ${error.message}`,
          );
          return match;
        }
      }),
    );
    const segmentStart = (index) =>
      index === 0 ? 0 : matches[index - 1].index + matches[index - 1][0].length;
    const rewrittenCode =
      matches
        .map(
          (found, index) =>
            code.slice(segmentStart(index), found.index) + replacements[index],
        )
        .join('') + code.slice(segmentStart(matches.length));

    return {
      code: rewrittenCode,
      map: null,
    };
  }
}

const makeConfig = (input, output, configOverrides = {}) => ({
  input,
  output: {
    file: output,
    format: 'cjs',
    sourcemap: true,
    inlineDynamicImports: true,
    interop: (id) => {
      // For Node.js built-in modules (e.g., 'buffer', 'fs/promises'):
      // Return 'default' to ensure they are treated as pure CommonJS modules,
      // without extra '.default' wrappers, matching Node.js's native behavior.
      if (NODE_BUILTINS.includes(id)) {
        return 'default';
      }
      // For all other modules, return 'esModule' so they get the
      // `__esModule: true` flag, allowing `import Foo from 'foo'` to work.
      return 'esModule';
    },
  },
  onwarn(warning, warn) {
    switch (warning.code) {
      case 'CIRCULAR_DEPENDENCY':
      case 'THIS_IS_UNDEFINED': {
        return;
      }
      default: {
        warn(warning);
      }
    }
  },
  plugins: [
    json({
      preferConst: true,
      compact: true,
    }),
    new InlinePackageJsonPlugin(),
    resolve({
      exportConditions: ['node', 'default'],
      preferBuiltins: true,
    }),
    commonjs({
      include: NODE_MODULES_PATTERN,
      requireReturnsDefault: () => 'auto',
      ignore: NODE_BUILTINS,
    }),
    typescript({
      tsconfig: './tsconfig.json',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: path.dirname(output),
      ...configOverrides.typescript,
    }),
  ],
  external: NODE_BUILTINS,
});

// noinspection JSUnusedGlobalSymbols,SpellCheckingInspection

/**
 * Lists the Rollup options for every CommonJS bundle the action ships.
 * @param {object} configOverrides - Extra options merged into the TypeScript plugin.
 * @returns {object[]} One Rollup configuration per entrypoint.
 * @example
 * export default buildConfigs({ typescript: { sourceMap: false } });
 */
const buildConfigs = (configOverrides = {}) => [
  makeConfig('src/main.ts', 'dist/main.cjs', configOverrides),
  makeConfig(
    'stages/docker-cache/src/main.ts',
    'stages/docker-cache/dist/main.cjs',
    configOverrides,
  ),
  makeConfig(
    'stages/docker-cache/src/post.ts',
    'stages/docker-cache/dist/post.cjs',
    configOverrides,
  ),
];

export default buildConfigs;
