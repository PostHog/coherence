import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { loadConfig } from '../../src/config.ts';
import { startScopeServer } from './server.mjs';

const rootFlag = process.argv.indexOf('--project');
const cfg = await loadConfig(rootFlag < 0 ? fileURLToPath(new URL('../..', import.meta.url)) : resolve(process.argv[rootFlag + 1]));
const live = await startScopeServer({ cfg, htmlPath: join(cfg.root, 'public/_scope-library.html') });
console.log(`Scope live (read-only, loopback only): ${live.url}\nProject: ${cfg.root}\nKeep this process running. Ctrl-C stops the feed. All four tabs refresh automatically (750 ms polling plus derivation time). Watching never runs tests or writes evidence; guarantees show recorded verification, not fresh checks of each edit.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void live.close().then(() => process.exit(0)));
