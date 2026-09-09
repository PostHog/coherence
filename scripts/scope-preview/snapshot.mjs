import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { loadConfig } from '../../src/config.ts';
import { readScopeReadings } from './readings.mjs';

const rootFlag = process.argv.indexOf('--project');
const cfg = await loadConfig(rootFlag < 0 ? fileURLToPath(new URL('../..', import.meta.url)) : resolve(process.argv[rootFlag + 1]));
const readings = readScopeReadings(cfg);
const digest = createHash('sha256').update(JSON.stringify(readings)).digest('hex');
await writeFile(join(cfg.root, 'public/scope-readings.json'), JSON.stringify({ digest, ...readings }, null, 2) + '\n');
console.log(`Scope readings captured: ${readings.journal.records.length} journal entries, ${readings.defects.length} defects, ${readings.experiments.length} experiment events, ${readings.sessions.length} sessions. Contains local journal text and hook observations; no hooks executed.`);
