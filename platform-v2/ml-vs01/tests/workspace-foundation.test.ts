import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Workspace Foundation P01A & P01B Boundaries', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('verifies required configuration and control files exist', () => {
    const requiredFiles = [
      'BUILD_STATE.md',
      'DEPENDENCY_MANIFEST.md',
      'CHANGED_FILES.md',
      'PARKED_IDEAS.md',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      '.gitignore',
      'README.md',
      'vitest.config.ts',
      'scripts/verify-runtime.ts',
      'scripts/verify-dependencies-exact.ts',
      'scripts/verify-no-placeholders.ts',
      'scripts/verify-changed-files.ts',
      'scripts/verify-migration-engine.ts',
      'scripts/verify-identity-tenancy-schema.ts',
      'scripts/verify-property-snapshot-schema.ts',
      'scripts/verify-person-contacts-account-lifecycle-schema.ts',
      'scripts/verify-foundation-closeout.ts',
      'db/migrate.ts',
      'db/seed.ts',
      'db/reset-test-database.ts',
      'db/fixtures/identity-tenancy-fixtures.ts',
      'db/migrations/README.md',
      'db/migrations/0001_identity_and_tenancy.sql',
      'db/migrations/0002_property_identity_and_snapshots.sql',
      'db/migrations/0003_person_contacts_and_account_lifecycle.sql',
      'tests/identity-tenancy-schema.test.ts',
      'tests/property-snapshot-schema.test.ts',
      'tests/person-contacts-account-lifecycle-schema.test.ts',
      'tests/foundation-fixtures.test.ts',
      'tests/test-database-reset.test.ts'
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Required file ${relPath} must exist`).toBe(true);
    }
  });

  it('verifies exact dependency declarations in package.json', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.dependencies).toEqual({
      pg: '8.22.0',
      fastify: '5.11.2'
    });

    expect(pkg.devDependencies).toEqual({
      '@types/node': '26.1.2',
      '@types/pg': '8.20.3',
      tsx: '4.23.1',
      typescript: '7.0.2',
      vitest: '4.1.10'
    });
  });

  it('verifies prohibited API, HTTP, and UI artifacts are absent', () => {
    const prohibitedPaths = [
      'src/server.ts',
      'src/app.ts',
      'src/routes',
      'fastify',
      'openapi',
      'ui',
      'components'
    ];

    for (const relPath of prohibitedPaths) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Prohibited path ${relPath} must not exist`).toBe(false);
    }
  });
});
