import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('Running verify-dependencies-exact.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.resolve(__dirname, '../package.json');
const lockPath = path.resolve(__dirname, '../package-lock.json');

if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) {
  console.error('ERROR: package.json or package-lock.json missing');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const requiredDependencies: Record<string, string> = {
  'pg': '8.22.0'
};

const requiredDevDependencies: Record<string, string> = {
  '@types/node': '26.1.2',
  '@types/pg': '8.20.3',
  'tsx': '4.23.1',
  'typescript': '7.0.2',
  'vitest': '4.1.10'
};

let errors = false;

for (const [dep, version] of Object.entries(requiredDependencies)) {
  if (pkg.dependencies?.[dep] !== version) {
    console.error(`ERROR: Dependency ${dep} must be exact ${version}, got ${pkg.dependencies?.[dep]}`);
    errors = true;
  }
}

for (const [dep, version] of Object.entries(requiredDevDependencies)) {
  if (pkg.devDependencies?.[dep] !== version) {
    console.error(`ERROR: DevDependency ${dep} must be exact ${version}, got ${pkg.devDependencies?.[dep]}`);
    errors = true;
  }
}

const totalDeps = Object.keys(pkg.dependencies || {}).length;
const totalDevDeps = Object.keys(pkg.devDependencies || {}).length;

if (totalDeps !== 1 || totalDevDeps !== 5) {
  console.error(`ERROR: Unexpected number of dependencies: deps=${totalDeps} (expected 1), devDeps=${totalDevDeps} (expected 5)`);
  errors = true;
}

if (errors) {
  process.exit(1);
}

console.log('Dependencies exact verification PASSED.');
