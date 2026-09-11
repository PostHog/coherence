// Compatibility entry point; the implementation now ships with Coherence.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const at = process.argv.indexOf('--project');
const root = at < 0 ? fileURLToPath(new URL('../..', import.meta.url)) : resolve(process.argv[at + 1]);
const args = [fileURLToPath(new URL('../../src/cli.ts', import.meta.url)), 'scope'];
args.push('--serve');
const child = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
