/**
 * Converts a SAF document tree URI to a real filesystem path for RNFS.readDir.
 *
 * Handles:
 *  - Primary storage: content://.../tree/primary%3ARecordings → /storage/emulated/0/Recordings
 *  - SD card:         content://.../tree/XXXX-YYYY%3ARecordings → /storage/XXXX-YYYY/Recordings
 *
 * Returns null for cloud provider URIs (Google Drive, etc.) — call recordings cannot exist there.
 */
export function safUriToPath(uri: string): string | null {
  try {
    const decoded = decodeURIComponent(uri);

    const treeMatch = decoded.match(/\/tree\/([^/]+)/);
    if (!treeMatch) return null;

    const treeId = treeMatch[1]; // e.g. "primary:Recordings" or "ABCD-1234:Folder"

    if (treeId.startsWith("primary:")) {
      const relativePath = treeId.slice("primary:".length);
      return `/storage/emulated/0/${relativePath}`;
    }

    // SD card volumes: "XXXX-YYYY:path"
    const sdMatch = treeId.match(/^([A-F0-9]{4}-[A-F0-9]{4}):(.*)$/i);
    if (sdMatch) {
      const [, volume, relativePath] = sdMatch;
      return `/storage/${volume}/${relativePath}`;
    }

    return null;
  } catch {
    return null;
  }
}
