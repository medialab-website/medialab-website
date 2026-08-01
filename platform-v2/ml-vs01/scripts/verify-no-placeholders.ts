import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('Running verify-no-placeholders.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file: string) => {
    const fullPath = path.join(dirPath, file);
    if (file === 'node_modules' || file === '.git' || file === 'dist') return;

    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

const allFiles = getAllFiles(baseDir);
const forbiddenTerms = [
  'TODO',
  'FIXME',
  'test.skip',
  'it.skip',
  'describe.skip'
];

let foundErrors = false;

for (const filePath of allFiles) {
  if (filePath.endsWith('verify-no-placeholders.ts')) continue;

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const term of forbiddenTerms) {
    if (content.includes(term)) {
      console.error(`FORBIDDEN PLACEHOLDER '${term}' FOUND IN FILE: ${filePath}`);
      foundErrors = true;
    }
  }
}

if (foundErrors) {
  console.error('ERROR: Placeholder verification failed.');
  process.exit(1);
}

console.log('No-placeholders verification PASSED.');
