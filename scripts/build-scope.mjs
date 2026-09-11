import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('../src/readings/scope/app.jsx', import.meta.url))],
  bundle: true, outfile: fileURLToPath(new URL('../dist/readings/scope/client.js', import.meta.url)),
  minify: true, legalComments: 'inline', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  // Keep vendored multiline shader strings escaped in the generated HTML artifact.
  supported: { 'template-literal': false },
});
