import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.ts';
import { startScopeServer } from './server.mjs';

const cfg = await loadConfig(fileURLToPath(new URL('../../', import.meta.url)));
const live = await startScopeServer({ cfg, htmlPath: new URL('../../public/_scope-library.html', import.meta.url) });
console.log(`Scope live (read-only, loopback only): ${live.url}\nKeep this process running. Ctrl-C stops the feed. Journal changes refresh within about one second; Structure remains the saved scope.json snapshot.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void live.close().then(() => process.exit(0)));
