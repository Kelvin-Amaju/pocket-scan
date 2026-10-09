# Validation report

## Completed

- `npm run build`: TypeScript check and Vite production build passed.
- `npm test`: four utility tests passed (media classification, search/filter/sort, duplicate URI reconciliation, byte formatting).
- `npm run android:setup`: generated the Android project, installed the native scanner and synced web assets.
- Repeated Android sync: passed; scanner source was recopied and the manifest retained one permission block.
- Browser interaction checks passed: folder import with nested photos/audio/documents, case-insensitive search, sorting, category filtering, image preview, grid/list switch, clear-index confirmation/cancel, session reset on reload.
- Layout checks passed at 320, 390, 768 and 1440 CSS pixels without horizontal document overflow.
- Desktop and mobile screenshots were rendered and visually reviewed; included in `docs/`.
- React native-bridge simulations passed: progressive batches, replacing only a completed category, limited-access banner, cancellation rollback, stale-event rejection, failed-scan rollback and saved metadata after reload.
- No JavaScript page errors were reported by the interaction checks.

The headless browser tests were run using a locally supplied Chromium binary because the standard Playwright browser archive could not be downloaded in this environment. The portable test script in `tests/browser.cjs` uses Playwright's normal installed browser.

## Not completed here

Android Gradle compilation, APK signing, emulator tests and physical-device tests. This environment has Java 17 and no configured Android SDK/JDK 21. Capacitor sync does not compile Java or prove that device permissions/content providers work. The archive contains source, not a compiled APK.

## Android acceptance checklist

- Build with JDK 21 / SDK 36 and install on an Android phone.
- Test API 24–32 legacy permission, API 33 granular permissions and API 34+ selected visual access.
- Deny permission, grant partial access, select more files and revoke access in system settings. Rescan and verify the accessible results.
- Scan Photos, Videos and Audio separately. Confirm the other categories are retained.
- Choose a nested local folder; confirm persistent access after force-closing and relaunching.
- Start a large scan, cancel midway, and verify the old index remains intact.
- Remove or rename a file, rescan successfully, and verify the list reconciles.
- Disconnect a folder and confirm the app loses its grant while files stay unchanged.
- Test SD card removal, inaccessible subfolders, unsupported formats and a provider that is still loading.
- Open a content URI in a compatible native viewer and check temporary read permission.
- Verify actual internal storage readings in Settings.
- Check safe areas, keyboard navigation, portrait/landscape and narrow/foldable screens on hardware.
- Terminate the app during scanning; relaunch and confirm the last completed index returns.

No scan-duration promise is made: device speed, library size, provider latency and permission scope all affect timing.
