/**
 * @file Rollup configuration that bundles the action entrypoints into CommonJS
 * files under dist/ and stages/docker-cache/dist/.
 */
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import typescript from '@rollup/plugin-typescript';

const NODE_BUILTINS = builtinModules.reduce(
  (acc, name) => [...acc, name, `node:${name}`],
  [],
);

/**
 * Rollup plugin that inlines the JSON files that bundled packages load with
 * `require()`, so the output has no runtime file lookups.
 */
class InlinePackageJsonPlugin {
  name = 'inline-json';

  transform(code, id) {
    if (!id.includes('node_modules')) {
      return null;
    }

    const requirePattern =
      /require\((['"`])([-./\w]+?(?:package\.json|commitlint\.schema\.json))\1\)/g;

    const newCode = code.replaceAll(
      requirePattern,
      (match, _quote, requiredPath) => {
        try {
          const filePath = path.resolve(path.dirname(id), requiredPath);
          // eslint-disable-next-line n/no-sync -- sync is fine in a script/bootstrap
          return readFileSync(filePath, 'utf8');
        } catch (error) {
          this.warn(
            `Failed to inline '${requiredPath}' for ${id}: ${error.message}`,
          );
          return match;
        }
      },
    );

    return {
      code: newCode,
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
      include: /node_modules/,
      requireReturnsDefault: () => {
        return 'auto';
      },
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
