export async function executeDriveList(drive, folderId) {
  if (!folderId || typeof folderId !== 'string') {
    throw new Error('Server configuration error: missing folder ID');
  }

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives'
    });

    const items = response.data.files.map(file => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      itemType: file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
      modifiedTime: file.modifiedTime || null,
      webViewLink: file.webViewLink || null
    }));

    return {
      ok: true,
      scope: "approved-proof-folder",
      items: items
    };
  } catch (error) {
    console.error('Error fetching Drive data:', error);
    throw new Error('Upstream API failure');
  }
}
