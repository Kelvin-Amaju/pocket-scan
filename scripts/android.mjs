import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  cpSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
function run(bin, args, cwd = root) {
  const result = spawnSync(bin, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
function cap(...args) {
  run(process.execPath, [
    resolve("node_modules/@capacitor/cli/bin/capacitor"),
    ...args,
  ]);
}
const action = process.argv[2] || "setup";
if (action === "apk") {
  if (!existsSync("android"))
    throw new Error("Run npm run android:setup first.");
  if (process.platform === "win32")
    run(
      "cmd.exe",
      ["/d", "/s", "/c", "gradlew.bat assembleDebug"],
      resolve("android"),
    );
  else run("sh", ["gradlew", "assembleDebug"], resolve("android"));
  console.log("APK: android/app/build/outputs/apk/debug/app-debug.apk");
} else {
  if (!existsSync("android")) cap("add", "android");
  const dest = "android/app/src/main/java/com/pocketscan/app";
  mkdirSync(dest, { recursive: true });
  for (const file of ["MainActivity.java", "PocketScannerPlugin.java"])
    copyFileSync(`native/android/${file}`, `${dest}/${file}`);
  cpSync("native/android/res", "android/app/src/main/res", { recursive: true });
  const manifest = "android/app/src/main/AndroidManifest.xml";
  let xml = readFileSync(manifest, "utf8");
  const start = "    <!-- POCKET_SCAN_PERMISSIONS_START -->";
  const end = "    <!-- POCKET_SCAN_PERMISSIONS_END -->";
  const block = `${start}\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />\n    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />\n    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />\n    <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />\n${end}`;
  xml = xml.replace(
    /    <!-- POCKET_SCAN_PERMISSIONS_START -->[\s\S]*?    <!-- POCKET_SCAN_PERMISSIONS_END -->\n?/g,
    "",
  );
  xml = xml.replace("</manifest>", `${block}\n</manifest>`);
  // The index is local to this installation and shouldn't be restored to a different device.
  xml = xml.replace(
    /android:allowBackup="true"/,
    'android:allowBackup="false"',
  );
  writeFileSync(manifest, xml);
  cap("sync", "android");
  console.log(
    "Android scanner installed. Native source of truth: native/android/.",
  );
}
