# Implementation Plan: SAF Folder Picker + Dark Theme

**Project:** Call Sync Mobile App  
**Scope:** `DeviceSetupScreen.tsx`, `LoginScreen.tsx`, `AndroidManifest.xml`, new utility `safUriToPath.ts`  
**Target API:** Android 29+ (SAF via Storage Access Framework)  
**Author:** Engineering  
**Date:** May 2026

---

## 1. Pre-Implementation: Critical Issues Found in Existing Code

These are bugs present *before* this feature work begins. You must understand them before touching anything.

### Issue 1 — `RNFS.readDir` Will Fail on Android 13+ (API 33+) ⚠️

The manifest declares `READ_MEDIA_AUDIO` for API 33+ instead of `READ_EXTERNAL_STORAGE`. `READ_MEDIA_AUDIO` is a MediaStore permission — it grants access to audio file *metadata via ContentResolver*, not filesystem directory listing. `RNFS.readDir(storagePath)` in `callSync.ts` will silently fail or throw a permissions error on every Android 13+ device.

**This is a pre-existing bug, not caused by this change.** However, the folder picker work is the right time to address it because:
- You are already touching the storage path flow end-to-end.
- Ignoring it means the folder picker will appear to work but call syncing will still be broken on Android 13+.

**Recommended fix (included in this plan):** Add `MANAGE_EXTERNAL_STORAGE` to the manifest and request it at runtime. Note: Google Play Store requires a declaration of purpose for this permission — plan for that before publishing.

### Issue 2 — SAF Returns a `content://` URI, RNFS Needs a Real Path

`react-native-document-picker`'s `pickDirectory()` returns a SAF URI like:
```
content://com.android.externalstorage.documents/tree/primary%3ARecordings
```
`RNFS.readDir` cannot consume this. A conversion utility is required to extract the real filesystem path before storing it in the Zustand store.

---

## 2. Full Scope of Changes

| File | Change Type | What Changes |
|---|---|---|
| `AndroidManifest.xml` | Modify | Add `MANAGE_EXTERNAL_STORAGE` |
| `services/safUriToPath.ts` | **New file** | SAF URI → real path conversion |
| `screens/DeviceSetupScreen.tsx` | Modify | Replace path TextInput with folder picker button; dark theme |
| `screens/LoginScreen.tsx` | Modify | Dark theme only |
| `callSync.ts` | No change | Works as-is once path is correct |
| `useStore.ts` | No change | `storagePath` field is already in place |
| `offlineQueue.ts` | No change | Not affected |
| `api.ts` | No change | Not affected |

---

## 3. Dependency to Install

Install `react-native-document-picker`. It is the only library needed. It provides a native SAF `pickDirectory()` intent on Android with no extra permissions required for the picker UI itself.

```bash
npm install react-native-document-picker
```

> **Do not** use `react-native-fs` directory browsing for the picker. Building a custom recursive folder browser using `RNFS.readDir` starting from `/storage/emulated/0/` looks simple but breaks on scoped storage, requires hard-coded root paths, and does not handle SD cards. The SAF picker is the Android-sanctioned approach for API 29+.

For iOS: `pickDirectory()` is not relevant here since this app reads call logs and is Android-only. No iOS configuration needed.

---

## 4. AndroidManifest.xml Changes

Add the following permission inside `<manifest>`, alongside the existing permissions:

```xml
<!-- Required for RNFS.readDir on Android 13+ (API 33+) -->
<!-- Declare purpose in Play Store listing under "All Files Access" -->
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
```

No other changes to the manifest are needed. The `CAMERA` permission already covers the QR scanner. The existing `READ_MEDIA_AUDIO` and `READ_EXTERNAL_STORAGE` entries remain as-is.

---

## 5. New File: `services/safUriToPath.ts`

Create this file. Its sole responsibility is converting a SAF document tree URI to a filesystem path that `RNFS.readDir` can use.

```typescript
/**
 * Converts a SAF document tree URI to a real filesystem path.
 *
 * Handles two cases:
 *  - Primary storage: content://.../tree/primary%3ARecordings → /storage/emulated/0/Recordings
 *  - SD card:         content://.../tree/XXXX-YYYY%3ARecordings → /storage/XXXX-YYYY/Recordings
 *
 * Returns null if the URI cannot be parsed (unexpected format, network provider, etc.)
 */
export function safUriToPath(uri: string): string | null {
  try {
    const decoded = decodeURIComponent(uri);

    // Extract the tree segment: everything after "/tree/"
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
```

**Limitation:** This conversion only works reliably for the `com.android.externalstorage.documents` authority (physical storage). Cloud provider URIs (Google Drive, etc.) will return `null`. In those cases, show the user an error — call recordings cannot exist in cloud storage.

---

## 6. Changes to `DeviceSetupScreen.tsx`

### 6a. Folder Picker Logic

Replace the `storagePath` `TextInput` with a button that opens the system folder picker. On successful selection, convert the URI and validate before storing.

The key import and handler:

```typescript
import DocumentPicker from "react-native-document-picker";
import { PermissionsAndroid, Platform } from "react-native";
import { safUriToPath } from "../services/safUriToPath";

// Request MANAGE_EXTERNAL_STORAGE on Android 11+ before setup
async function requestStoragePermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (Platform.Version < 30) return true; // READ_EXTERNAL_STORAGE covers API 29

  // MANAGE_EXTERNAL_STORAGE cannot be requested via PermissionsAndroid.
  // Must redirect user to system settings.
  const { check, PERMISSIONS, RESULTS, openSettings } =
    await import("react-native-permissions");
  const result = await check(PERMISSIONS.ANDROID.MANAGE_EXTERNAL_STORAGE);
  if (result !== RESULTS.GRANTED) {
    Alert.alert(
      "Storage Permission Required",
      "This app needs 'All Files Access' to read call recordings. Tap Open Settings and enable it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => openSettings() },
      ]
    );
    return false;
  }
  return true;
}

const onPickFolder = async () => {
  try {
    const result = await DocumentPicker.pickDirectory();
    if (!result?.uri) return;

    const realPath = safUriToPath(result.uri);
    if (!realPath) {
      Alert.alert(
        "Invalid Folder",
        "Could not resolve this folder path. Please select a folder from device storage, not a cloud location."
      );
      return;
    }
    setStoragePath(realPath);
  } catch (err) {
    if (!DocumentPicker.isCancel(err)) {
      Alert.alert("Picker Error", "Failed to open folder picker.");
    }
    // User cancelled — do nothing
  }
};
```

> **Note:** `react-native-permissions` is an optional dependency if you want to check `MANAGE_EXTERNAL_STORAGE` status before opening the picker. If you do not want to add another library, skip the permission pre-check and handle the `RNFS.readDir` failure in `callSync.ts` instead by catching the error and surfacing it to the user.

### 6b. UI: Replace TextInput with Picker Button + Display

Replace this block in the JSX:

```tsx
// REMOVE:
<Text style={styles.label}>Recording Folder Path</Text>
<TextInput
  value={storagePath}
  onChangeText={setStoragePath}
  style={styles.input}
  placeholder="/storage/emulated/0/Recordings"
/>
```

With this:

```tsx
// ADD:
<Text style={styles.label}>Recording Folder</Text>
<TouchableOpacity style={styles.folderPickerButton} onPress={onPickFolder}>
  <Text style={styles.folderPickerButtonText} numberOfLines={1} ellipsizeMode="middle">
    {storagePath ? storagePath : "Tap to select folder…"}
  </Text>
</TouchableOpacity>
```

The `ellipsizeMode="middle"` keeps the path readable when it is long (e.g. `/storage/emulated/0/MIUI/sound_recorder/call_rec`).

---

## 7. Dark Theme Color Palette

Apply this palette to both screens. The intent is high contrast on dark — not a pure black theme, since `#1a1714` (the existing dark ink color) already anchors the design.

| Token | Old Value | New Value | Usage |
|---|---|---|---|
| `card` background | `#ffffff` | `#1a1714` | Card container |
| `input` background | `#f0ede6` | `#2b2724` | Input / picker button bg |
| `input` border | `#e8e2d9` | `#3d3835` | Subtle border |
| `label` text | `#1a1714` | `#e8e2d9` | Field labels |
| `input` text | `#1a1714` | `#f5f2ed` | Typed text |
| `input` placeholder | (default) | `#6b6460` | Placeholder text |
| `button` background | `#e8761a` | `#e8761a` | Primary action — unchanged |
| `card` border | `#e8e2d9` | `#3d3835` | Card outline |
| Banner background | `rgba(232,118,26,0.1)` | `rgba(232,118,26,0.15)` | Pending uploads banner |
| Banner text | `#e8761a` | `#e8761a` | Banner text — unchanged |
| Secondary button bg | `#ffffff` | `#2b2724` | "Scan QR" button |
| Secondary button border | `#e8e2d9` | `#3d3835` | "Scan QR" border |
| Secondary button text | `#1a1714` | `#f5f2ed` | "Scan QR" label |
| Note / hint text | `#8a8278` | `#7a7470` | Small hint text |

The scanner modal in `LoginScreen` already has a dark background (`#1a1714`) — no change needed there.

---

## 8. Complete Updated StyleSheets

### `DeviceSetupScreen.tsx` styles

```typescript
const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1714",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3d3835",
    padding: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#e8e2d9",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    padding: 10,
    borderRadius: 8,
    color: "#f5f2ed",
  },
  folderPickerButton: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    padding: 10,
    borderRadius: 8,
  },
  folderPickerButtonText: {
    color: "#f5f2ed",
    fontSize: 14,
  },
  button: {
    marginTop: 16,
    backgroundColor: "#e8761a",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  banner: {
    backgroundColor: "rgba(232,118,26,0.15)",
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  bannerText: { fontSize: 12, color: "#e8761a", fontWeight: "700" },
});
```

### `LoginScreen.tsx` styles

```typescript
const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1714",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3d3835",
    padding: 16,
  },
  label: { fontSize: 14, fontWeight: "600", color: "#e8e2d9", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#3d3835",
    backgroundColor: "#2b2724",
    padding: 10,
    borderRadius: 8,
    color: "#f5f2ed",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#e8761a",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: "#2b2724",
    borderWidth: 1,
    borderColor: "#3d3835",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#f5f2ed", fontWeight: "700" },
  note: { marginTop: 10, fontSize: 12, color: "#7a7470" },
  // Scanner modal styles — already dark, unchanged
  scannerRoot: { flex: 1, backgroundColor: "#1a1714" },
  scannerHeader: {
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1a1714",
  },
  scannerTitle: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  closeButton: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  closeButtonText: { color: "#1a1714", fontWeight: "700" },
  scannerBody: { flex: 1, backgroundColor: "#1a1714" },
  camera: { flex: 1 },
});
```

---

## 9. Execution Order

Follow this order strictly. Do not skip steps or combine them.

**Step 1** — Install the dependency:
```bash
npm install react-native-document-picker
cd android && ./gradlew clean && cd ..
```
Verify the library auto-links by checking `android/settings.gradle` for `react-native-document-picker`. React Native 0.60+ auto-links; no manual `MainApplication.java` changes needed.

**Step 2** — Create `services/safUriToPath.ts` with the utility function from Section 5.

**Step 3** — Update `AndroidManifest.xml` with `MANAGE_EXTERNAL_STORAGE` from Section 4.

**Step 4** — Update `DeviceSetupScreen.tsx`: add imports, add `onPickFolder` handler, replace the `TextInput` JSX block with the picker button, replace the full `StyleSheet` with the new dark version from Section 8.

**Step 5** — Update `LoginScreen.tsx`: replace the full `StyleSheet` with the new dark version from Section 8. No logic changes.

**Step 6** — Test (see Section 10).

---

## 10. Testing Checklist

Test on a physical Android device — the emulator does not reliably simulate call recordings or real storage paths.

- [ ] SAF picker opens when tapping "Tap to select folder…"
- [ ] Selecting a folder on primary storage (`/storage/emulated/0/...`) resolves to the correct real path
- [ ] Long paths display with middle ellipsis and do not overflow the card
- [ ] Cancelling the picker (back button) does not change the stored path or crash
- [ ] Selecting a Google Drive folder shows the "Invalid Folder" alert and does not store the URI
- [ ] After setup, `syncCallsOnce()` in `callSync.ts` reads the resolved path without errors
- [ ] On Android 11+ (API 30+), if `MANAGE_EXTERNAL_STORAGE` is not granted, the settings redirect alert appears
- [ ] Dark theme renders correctly on both screens — no white flash, placeholder text readable
- [ ] TextInput in LoginScreen shows white text on dark background when typing

---

## 11. Known Risks and Limitations

**Play Store approval for `MANAGE_EXTERNAL_STORAGE`:** Google requires a justification for "All Files Access" permission. You will need to declare in the Play Console that the app reads call recordings from a user-selected directory for business call tracking. Apps that do not justify this permission are rejected.

**Manufacturer-specific recording paths:** Different OEMs store call recordings in different directories. Xiaomi uses `/storage/emulated/0/MIUI/sound_recorder/call_rec/`. Samsung, OnePlus, and others use their own paths. The folder picker solves this correctly — the user selects the right folder manually, which is the only reliable approach. Do not attempt to auto-detect paths.

**`safUriToPath` does not cover all edge cases:** If a user's device uses a non-standard storage authority (some custom ROMs do), the conversion will return `null` and show the "Invalid Folder" error. This is the safe failure mode. In practice, standard AOSP and major OEMs all use `com.android.externalstorage.documents`.

**`TextInput` `placeholderTextColor` is missing in current code:** React Native on Android does not inherit placeholder color from `StyleSheet` — you must pass `placeholderTextColor` as a prop. Without it, the placeholder text in the dark inputs will remain dark grey (nearly invisible). Add `placeholderTextColor="#6b6460"` as a prop to every `TextInput` in both screens.

```tsx
// Example — apply to all TextInput elements in both screens
<TextInput
  placeholderTextColor="#6b6460"
  // ... rest of props
/>
```
