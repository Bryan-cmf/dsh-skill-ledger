import { defineConfig } from 'tsdown'

/**
 * Standalone DSH plugin package build.
 *
 * Host half:  lib/index.js  — plain ESM (node), consumed by the cordis loader.
 * Client half: lib/client.js — closure-factory artifact in the exact
 *              window.__ModuleLoader__.load({ id, factory }) format the DSH
 *              web runtime serves from /plugins/<id>/client.js.
 */
const ID = '@bryan-cmf/dsh-skill-ledger'

/** Resolved from the shell's frozen module table (PLATFORM_MODULES). */
const EXTERNALS = ['react', 'react/jsx-runtime']

export default defineConfig([
  {
    name: ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: EXTERNALS,
      alwaysBundle: true,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
