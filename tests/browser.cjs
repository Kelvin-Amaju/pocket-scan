const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync("tests/artifacts", { recursive: true });
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { cwd: process.cwd(), stdio: "ignore" },
);
(async () => {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch("http://127.0.0.1:5173");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page
    .getByRole("heading", { name: "A fresh start for your files" })
    .waitFor();
  await page.screenshot({
    path: "tests/artifacts/desktop.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "tests/artifacts/mobile.png", fullPage: true });
  await page
    .locator("input[webkitdirectory]")
    .setInputFiles(path.resolve("tests/fixtures/Weekend"));
  await page.getByText("4 files ready.", { exact: false }).waitFor();
  assert.equal(await page.locator(".file-card").count(), 4);
  await page
    .getByRole("textbox", { name: "Search files or folders" })
    .fill("GARDEN");
  assert.equal(await page.locator(".file-card").count(), 1);
  await page.locator(".file-card").click();
  await page.getByRole("dialog", { name: "File preview" }).waitFor();
  await page.locator(".preview-image").waitFor();
  assert.equal(
    await page
      .locator(".preview-image")
      .evaluate((el) => el.complete && el.naturalWidth > 0),
    true,
  );
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("combobox", { name: "Sort files" }).selectOption("name");
  assert.equal(
    await page.locator(".file-info strong").first().innerText(),
    "Garden.png",
  );
  await page.getByRole("button", { name: "List view", exact: true }).click();
  assert.equal(await page.locator(".file-results.list").count(), 1);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Audio", exact: true })
    .click();
  assert.equal(await page.locator(".file-card").count(), 1);
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await page.screenshot({
    path: "tests/artifacts/mobile-with-files.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Clear index", exact: true }).click();
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  assert.equal(await page.locator(".file-card").count(), 4);
  await page.getByRole("button", { name: "Clear index", exact: true }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  assert.equal(await page.locator(".file-card").count(), 0);
  await page.reload();
  await page
    .getByRole("heading", { name: "A fresh start for your files" })
    .waitFor();
  assert.equal(await page.locator(".file-card").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: four responsive widths, real folder import, search, sorting, category filter, image preview, grid/list, clear confirmation, reload, no JS errors.",
  );

  const native = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  native.on("pageerror", (e) => errors.push(e.message));
  await native.addInitScript(() => {
    const listeners = new Map();
    let seq = 0;
    window.androidBridge = {};
    window.__scanMock = {
      current: null,
      emit(event) {
        for (const cb of listeners.values()) cb(event);
      },
    };
    window.Capacitor = {
      PluginHeaders: [
        {
          name: "PocketScanner",
          methods: [
            ...[
              "startScan",
              "cancelScan",
              "listFolders",
              "storageInfo",
              "thumbnail",
              "openFile",
              "chooseFolder",
              "forgetFolder",
              "openSettings",
            ].map((name) => ({ name, rtype: "promise" })),
            { name: "addListener", rtype: "callback" },
            { name: "removeListener", rtype: "callback" },
          ],
        },
      ],
      nativeCallback(plugin, method, options, callback) {
        if (method === "addListener") {
          const id = String(++seq);
          listeners.set(id, callback);
          return id;
        }
        listeners.delete(options.callbackId);
      },
      async nativePromise(plugin, method, options) {
        if (method === "listFolders") return { folders: [] };
        if (method === "storageInfo")
          return { total: 100000, available: 40000 };
        if (method === "thumbnail") throw new Error("No thumbnail in test");
        if (method === "startScan") {
          window.__scanMock.current = options;
          return {};
        }
        if (method === "cancelScan") {
          window.__scanMock.emit({
            scanId: options.scanId,
            state: "cancelled",
            count: 0,
          });
          return {};
        }
        return {};
      },
    };
  });
  await native.goto("http://127.0.0.1:5173");
  await native.getByRole("button", { name: "Scan media", exact: true }).click();
  await native.evaluate(() => {
    const m = window.__scanMock;
    const id = m.current.scanId;
    m.emit({
      scanId: id,
      state: "batch",
      count: 3,
      items: [
        { id: "p", uri: "content://p", name: "Photo.jpg", category: "photos" },
        { id: "v", uri: "content://v", name: "Video.mp4", category: "videos" },
        { id: "a", uri: "content://a", name: "Song.mp3", category: "audio" },
      ].map((e) => ({
        ...e,
        scope: "media",
        folder: "Library",
        mime: "application/octet-stream",
        size: 100,
        modified: 1,
      })),
    });
    m.emit({ scanId: id, state: "complete", count: 3 });
  });
  await native.getByText("3 files indexed.", { exact: false }).waitFor();
  assert.equal(await native.locator(".file-card").count(), 3);
  await native
    .getByRole("button", { name: "Scan photos", exact: true })
    .click();
  await native.evaluate(() => {
    const m = window.__scanMock;
    const id = m.current.scanId;
    m.emit({
      scanId: id,
      state: "batch",
      count: 1,
      items: [
        {
          id: "p2",
          uri: "content://p2",
          name: "New.jpg",
          category: "photos",
          scope: "media",
          folder: "Library",
          mime: "image/jpeg",
          size: 200,
          modified: 2,
        },
      ],
    });
    m.emit({ scanId: id, state: "complete", count: 1, limited: true });
  });
  await native.getByText("1 files indexed", { exact: false }).waitFor();
  assert.equal(await native.locator(".file-card").count(), 3);
  assert.equal(await native.getByText("Photo.jpg", { exact: true }).count(), 0);
  await native
    .getByRole("button", { name: "Manage access", exact: true })
    .waitFor();
  await native.getByRole("button", { name: "Scan media", exact: true }).click();
  await native.evaluate(() => {
    const m = window.__scanMock;
    m.emit({
      scanId: m.current.scanId,
      state: "batch",
      count: 1,
      items: [
        {
          id: "partial",
          uri: "content://partial",
          name: "Partial.jpg",
          category: "photos",
          scope: "media",
          folder: "Library",
          mime: "image/jpeg",
          size: 100,
          modified: 3,
        },
      ],
    });
  });
  await native.getByText("Partial.jpg", { exact: true }).waitFor();
  await native.getByRole("button", { name: "Stop", exact: true }).click();
  await native
    .getByText("Scan stopped. Previous index kept.", { exact: true })
    .waitFor();
  assert.equal(await native.locator(".file-card").count(), 3);
  assert.equal(
    await native.getByText("Partial.jpg", { exact: true }).count(),
    0,
  );
  await native.evaluate(() =>
    window.__scanMock.emit({ scanId: "stale", state: "complete", count: 0 }),
  );
  assert.equal(await native.locator(".file-card").count(), 3);
  await native.getByRole("button", { name: "Scan media", exact: true }).click();
  await native.evaluate(() => {
    const m = window.__scanMock;
    m.emit({
      scanId: m.current.scanId,
      state: "error",
      count: 0,
      message: "Provider unavailable",
    });
  });
  await native.getByText("Provider unavailable", { exact: true }).waitFor();
  assert.equal(await native.locator(".file-card").count(), 3);
  await native.reload();
  await native.getByText("New.jpg", { exact: true }).waitFor();
  assert.equal(await native.locator(".file-card").count(), 3);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: simulated native batches, category reconciliation, limited-access UI, cancellation rollback, stale-event isolation, error rollback, persisted index after reload. Android APIs themselves remain untested.",
  );

  await browser.close();
  server.kill();
})().catch((e) => {
  server.kill();
  console.error(e);
  process.exit(1);
});
