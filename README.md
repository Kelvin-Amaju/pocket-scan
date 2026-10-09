# Pocket Scan — React + Capacitor

A mobile-first, local file browser with native Android media indexing and user-selected folder scans.

**This package contains the React app and Android source project, not a compiled APK.** The web build is validated. Android compilation and real-device permission/provider testing must be completed on your Android development machine.

## 1. Run the React app

Install Node.js 22 or newer (Node 24 LTS works). Extract the ZIP and open the `pocket-scan` folder in VS Code.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. No API keys, server, account or database installation is required.

- Choose a folder to inspect its contents and subfolders.
- Use **Choose files** if your browser does not support selecting directories.
- Search filenames and folders; filter Photos, Videos or Audio; change sorting and grid/list view.
- Browser images, videos and audio can be previewed if their format is supported by your browser.
- Browser selections are session-only. Reloading requires choosing the files again. File bytes are not copied into browser storage.
- The empty first-run screen is intentional: there are no fabricated files, counts, storage totals or sample media.

## 2. Build for Android — in order

Install Android Studio 2025.2.1 or newer, Android SDK Platform 36, its build tools and platform tools. Use JDK 21 (Android Studio's matching bundled JDK is easiest). Node.js must be at least version 22.

The generated Android project is already included. Run:

```bash
npm ci
npm run android:setup
npm run android:open
```

In Android Studio:

1. Allow Gradle to sync and install any requested SDK components.
2. Select JDK 21 under **Settings → Build, Execution, Deployment → Build Tools → Gradle** if needed.
3. Connect a phone with USB debugging enabled, or start an emulator with media files on it.
4. Press **Run** to install and open the app.
5. To export a debug APK, use **Build → Generate App Bundles or APKs → Generate APKs** (menu wording can vary by Studio version).

After the SDK and Java paths are configured, the command-line alternative is:

```bash
npm run android:apk
```

Output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

For subsequent React or scanner changes:

```bash
npm run android:sync
npm run android:open
```

`android:setup` and `android:sync` are safe to repeat. They copy the scanner, activity, icon and theme resources from `native/android/`, apply the permission block once, and run Capacitor sync. Edit the files in `native/android/` rather than their generated copies.

On Windows, Android Studio can build without global Gradle; this project includes the Gradle wrapper. CLI builds also need `JAVA_HOME` to point to JDK 21 and the Android SDK location in `ANDROID_HOME` or `android/local.properties`. The app itself does not depend on a Node server after installation. Do not use `file://` to preview `dist`; use `npm run preview`.

## 3. What is implemented

| Feature | Android APK | Browser |
| --- | --- | --- |
| Discover photos, videos, audio | MediaStore collections | Selected files/folder only |
| Scan a selected folder recursively | Android SAF directory picker | Directory upload where supported |
| Remember selected folders | Persistent read URI grants | Session only |
| Retain index between launches | IndexedDB metadata snapshots | Session only |
| Progressive results | Native batches of 100 | Batches of 100 |
| Cancel current scan | CancellationSignal + cooperative checks | Cooperative cancellation |
| Cached list preserved after failure/cancel | Yes | Yes |
| Thumbnails | Android thumbnails, visible items only | Selected images, visible items only |
| Open files | Android “Open with” chooser | Built-in media preview/download |
| Real device storage totals | Internal data volume via StatFs | Not displayed |
| Scan photos/videos/audio separately | Yes | Filter a chosen folder |
| Search, sort, grid/list, pagination | Yes | Yes |

Other UI: sticky header, mobile bottom navigation, foldable/narrow layouts, progress indicator, green/error toasts, access management, settings, index clearing with confirmation, branded launcher icon and splash screen. No file deletion or modification is performed.

## 4. How scanning works

React calls the `PocketScanner` Capacitor plugin. The Java scanner uses one worker thread for indexing; thumbnail work uses a separate bounded pool. Metadata crosses the native bridge in batches. Files are never read in full or converted to Base64 during indexing. Small thumbnails are encoded separately and held in a bounded, in-memory UI cache.

**MediaStore:** a query per requested media collection, retrieving URI, filename, MIME type, size, modification date and relative folder. This reads Android's existing index rather than recursively crawling the whole device. It does not force Android to index newly created or hidden files.

**SAF:** the system folder picker grants read-only access. A breadth-first traversal queries child metadata once per directory. Visited directory IDs prevent repeat traversal. Provider cancellation support varies; an uncooperative provider may delay stopping until its current query returns. If a subtree fails, the scan reports an error and preserves the previous snapshot. Cloud providers still loading a listing are treated as incomplete; retry after they finish syncing.

**Index:** a completed scan replaces only its source's snapshot. A photo-only scan keeps previously indexed video/audio entries. Rescans reconcile deletions by replacing the completed category/folder list. These are metadata refreshes, not a MediaStore generation-based incremental sync. Cancellation and errors keep the previous saved index. The UI shows up to 60 results at once, with Show more. Very large indexes still reside in JS memory; million-file collections need database-backed pagination.

The same physical file indexed through MediaStore and SAF can appear twice because Android returns different URI identities. Deduplication is by URI, not filename or file contents. Indexed size is the sum of those records, not used device storage. Device storage in Settings reports the real internal data volume, not a sum including removable SD cards.

## 5. Permissions and Android behavior

- Android 7–12: `READ_EXTERNAL_STORAGE` (manifest capped at API 32).
- Android 13+: request only the media categories being scanned.
- Android 14+: supports selected photos/videos as well as full access. The UI identifies limited visual access and includes **Manage access**.
- SAF folders use their explicit URI grant; no all-files access or storage write permission is requested.
- Android restricts selection of protected locations such as `Android/data`, `Android/obb` and certain root directories. Choose an accessible subfolder instead.
- Permissions can be revoked, SD cards removed, and files moved. Rescan after changing permissions. Old cached metadata is not proof of current access.
- A remembered folder that stops working should be disconnected and selected again.
- Android opening uses content URIs with temporary read permission. A compatible viewer/player must be installed.
- HEIC, unusual audio/video codecs and thumbnails depend on Android/browser capabilities. Unsupported thumbnails use a file-type icon.
- Scans run while this app process exists. They are not persistent background jobs; Android may terminate work after you close the app. Relaunch and scan again.
- Android restores the previous completed index after process termination. Folder grants persist until revoked, disconnected or uninstalled.
- The standard Capacitor Internet permission remains in the generated manifest; this application has no network endpoints or remote assets.

For Google Play distribution, review the store's current photo/video permission requirements for your use case. A debug APK is for local testing; release signing and store submission are not configured.

## 6. Project map

```text
src/App.tsx                         Screens and scan lifecycle
src/styles.css                      Responsive styling
src/scanner.ts                      Typed Capacitor interface
src/db.ts                           Metadata snapshots (IndexedDB)
src/Thumb.tsx                        Lazy thumbnails, queue and bounded cache
src/utils.mjs                       Classification, search, sorting, units
native/android/PocketScannerPlugin.java   Android scanner source
native/android/MainActivity.java          Plugin registration
native/android/res/                       Icons and themes
scripts/android.mjs                  Repeatable Android setup/sync/APK command
android/                            Generated Android Studio project
capacitor.config.ts                 App ID, name and web build path
tests/                             Utility tests
```

Default app ID: `com.pocketscan.app`. Renaming the Java package requires updating the Java sources, destination path in `scripts/android.mjs`, Capacitor app ID and Android project namespace/application ID together.

## 7. Validation

```bash
npm test
npm run build
```

Optional browser integration tests (requires a Playwright browser download):

```bash
npx playwright install chromium
npm run test:browser
```

These include a simulated Capacitor bridge to exercise React scan state. They do not test Android storage APIs.

See `VALIDATION.md` for completed checks and the real-device checklist. There is no compiled APK in this archive. Do not interpret source generation or `cap sync` as an Android compilation/device test.

## Official references

- https://capacitorjs.com/docs/plugins/android
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://developer.android.com/training/data-storage/shared/media
- https://developer.android.com/training/data-storage/shared/documents-files
- https://developer.android.com/about/versions/14/changes/partial-photo-video-access
