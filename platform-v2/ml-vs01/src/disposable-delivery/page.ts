export const DISPOSABLE_DELIVERY_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const DISPOSABLE_DELIVERY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Temporary Download Center</title>
</head>
<body>
  <main>
    <h1>Temporary Download Center</h1>
    <p>Access and download activity is recorded.</p>
    <p id="status" class="status">Checking access…</p>
    <section id="manifest" hidden><h2 id="label">Available media</h2><p id="expiry"></p><div id="categories"></div></section>
  </main>
  <script src="/assets/disposable-delivery.js"></script>
</body>
</html>`;

export const DISPOSABLE_DELIVERY_JAVASCRIPT = `(() => {
  'use strict';
  const credentialMatch = location.pathname.match(/^\\/d\\/([0-9a-f-]{36})$/i);
  let usableSecret = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  history.replaceState(null, '', location.pathname);
  const status = document.getElementById('status');
  const manifestSection = document.getElementById('manifest');
  const categories = document.getElementById('categories');
  const secretPattern = /^[0-9a-f]{64}$/;
  const credentialPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const eventReference = (kind) => 'M15C.' + kind + '.' + crypto.randomUUID().toUpperCase();
  const unavailable = () => { status.textContent = 'This temporary delivery is unavailable.'; };

  if (!credentialMatch || !credentialPattern.test(credentialMatch[1]) || !secretPattern.test(usableSecret)) {
    usableSecret = '';
    unavailable();
    return;
  }

  const credentialId = credentialMatch[1].toLowerCase();
  const post = async (path, body) => fetch(path, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  });

  const download = async (itemId, button) => {
    button.disabled = true;
    try {
      const response = await post('/api/disposable-delivery/download', {
        credentialId,
        secret: usableSecret,
        itemId,
        accessEventReference: eventReference('DOWNLOAD')
      });
      if (!response.ok) { unavailable(); return; }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = response.headers.get('x-medialab-fixture-filename') || 'medialab-synthetic-fixture.bin';
      link.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      button.disabled = false;
    }
  };

  post('/api/disposable-delivery/open', {
    credentialId,
    secret: usableSecret,
    accessEventReference: eventReference('OPEN')
  }).then(async (response) => {
    if (!response.ok) { unavailable(); return; }
    const manifest = await response.json();
    status.textContent = 'Access is currently available.';
    document.getElementById('label').textContent = manifest.stakeholderLabel || 'Available media';
    document.getElementById('expiry').textContent = 'Expires ' + new Date(manifest.expiresAt).toLocaleString();
    for (const category of manifest.categories) {
      const heading = document.createElement('h3');
      heading.textContent = category.label;
      categories.appendChild(heading);
      const list = document.createElement('ul');
      for (const item of category.items) {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Download ' + item.label;
        button.addEventListener('click', () => download(item.id, button));
        row.appendChild(button);
        list.appendChild(row);
      }
      categories.appendChild(list);
    }
    manifestSection.hidden = false;
  }).catch(unavailable);
})();`;
