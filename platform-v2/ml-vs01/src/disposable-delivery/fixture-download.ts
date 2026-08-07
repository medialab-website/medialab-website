import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SyntheticFixtureDownload {
  bytes: Buffer;
  filename: string;
  contentType: 'application/octet-stream';
  sha256: string;
}

export function createSyntheticFixtureDownload(itemId: string): SyntheticFixtureDownload {
  if (!UUID_PATTERN.test(itemId)) {
    throw new Error('A canonical item identifier is required');
  }

  const normalizedItemId = itemId.toLowerCase();
  const bytes = Buffer.from(
    `MEDIALAB SYNTHETIC DISPOSABLE DELIVERY FIXTURE\nVERSION:1\nITEM:${normalizedItemId}\n`,
    'utf8'
  );

  return {
    bytes,
    filename: `medialab-synthetic-${normalizedItemId.slice(0, 8)}.bin`,
    contentType: 'application/octet-stream',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}
