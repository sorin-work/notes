import { build } from 'esbuild';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { buildVersion, precacheList, VERSION_FILE, WORKER_FILE } from './precache';

function filesIn(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path, root) : [relative(root, path)];
  });
}

/**
 * Builds src/sw/worker.ts into /sw.js with the list of this build's files,
 * and writes /version.json with `buildId`, the id the app is built with
 * (`__BUILD_ID__`). Only for `vite build`.
 */
export function serviceWorker(buildId: string): Plugin {
  let publicDir = '';
  return {
    name: 'notes-service-worker',
    apply: 'build',
    // After Vite has added index.html to the bundle.
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    async generateBundle(_options, bundle) {
      const contents = new Map<string, string | Uint8Array>();
      for (const item of Object.values(bundle)) {
        contents.set(item.fileName, item.type === 'chunk' ? item.code : item.source);
      }
      if (publicDir) {
        for (const file of filesIn(publicDir)) contents.set(file, readFileSync(join(publicDir, file)));
      }
      const precache = precacheList(contents.keys());
      const version = buildVersion([...contents].filter(([name]) => precache.includes(`/${name}`)));
      const result = await build({
        entryPoints: [join(import.meta.dirname, '../src/sw/worker.ts')],
        bundle: true,
        write: false,
        format: 'iife',
        minify: true,
        target: 'es2022',
        define: { __PRECACHE__: JSON.stringify(precache), __VERSION__: JSON.stringify(version) },
      });
      this.emitFile({ type: 'asset', fileName: WORKER_FILE, source: result.outputFiles[0]?.text ?? '' });
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: `${JSON.stringify({ build: buildId })}\n` });
    },
  };
}
