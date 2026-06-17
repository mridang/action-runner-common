import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { dirname, resolve as r, dirname as dn } from 'node:path';
import { readFileSync } from 'node:fs';
import * as nodules from 'node:module';
import typescript from '@rollup/plugin-typescript';

const NODE_BUILTINS = nodules.builtinModules.reduce(
  (acc, name) => acc.concat([name, `node:${name}`]),
  [],
);

const inlinePackageJsonPlugin = {
  name: 'inline-json',
  transform(code, id) {
    if (!id.includes('node_modules')) {
      return null;
    }

    const requirePattern =
      /require\((['"`])([-./\w]+?(?:package\.json|commitlint\.schema\.json))\1\)/g;

    const newCode = code.replace(
      requirePattern,
      (match, quote, requiredPath) => {
        try {
          const filePath = r(dirname(id), requiredPath);
          return readFileSync(filePath, 'utf-8');
        } catch (e) {
          this.warn(
            `Failed to inline '${requiredPath}' for ${id}: ${e.message}`,
          );
          return match;
        }
      },
    );

    return {
      code: newCode,
      map: null,
    };
  },
};

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
      case 'THIS_IS_UNDEFINED':
        return;
      default:
        warn(warning);
    }
  },
  plugins: [
    json({
      preferConst: true,
      compact: true,
    }),
    inlinePackageJsonPlugin,
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
      outDir: dn(output),
      ...configOverrides.typescript,
    }),
  ],
  external: NODE_BUILTINS,
});

// noinspection JSUnusedGlobalSymbols,SpellCheckingInspection
export default (configOverrides = {}) => [
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
