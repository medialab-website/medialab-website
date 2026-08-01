import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('Running verify-packet-boundary.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

const prohibitedPatterns = [
  'db/migrations',
  'migrations',
  'src/server.ts',
  'src/app.ts',
  'src/routes',
  'fastify',
  'openapi',
  'db/fixtures',
  'db/seeds',
  'reseed',
  'reset.ts',
  'ui',
  'components'
];

let violationsFound = false;

for (const relPath of prohibitedPatterns) {
  const target = path.join(baseDir, relPath);
  if (fs.existsSync(target)) {
    console.error(`PROHIBITED ARTIFACT DETECTED: ${relPath}`);
    violationsFound = true;
  }
}

if (violationsFound) {
  console.error('ERROR: Packet boundary verification failed. Prohibited artifacts detected.');
  process.exit(1);
}

console.log('Packet boundary verification PASSED. Zero prohibited artifacts found.');
