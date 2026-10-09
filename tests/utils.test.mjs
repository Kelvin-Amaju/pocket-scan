import test from "node:test";
import assert from "node:assert/strict";
import { bytes, categoryFor, dedupe, filterEntries } from "../src/utils.mjs";
test("classifies common media even when MIME is missing", () => {
  assert.equal(categoryFor("", "holiday.HEIC"), "photos");
  assert.equal(categoryFor("audio/flac", "unknown"), "audio");
  assert.equal(categoryFor("", "clip.MKV"), "videos");
  assert.equal(categoryFor("application/pdf", "doc.pdf"), "other");
});
test("searches names and folder paths without changing the original list", () => {
  const entries = [
    {
      id: "1",
      name: "Zebra.png",
      folder: "Trips/Lagos",
      category: "photos",
      size: 100,
      modified: 30,
    },
    {
      id: "2",
      name: "Audio.mp3",
      folder: "Music",
      category: "audio",
      size: 500,
      modified: 10,
    },
  ];
  assert.equal(filterEntries(entries, " LAGOS ", "", "recent")[0].id, "1");
  assert.equal(filterEntries(entries, "", "audio", "size")[0].id, "2");
  assert.equal(filterEntries(entries, "", "", "name")[0].id, "2");
  assert.equal(entries[0].id, "1");
});
test("deduplicates same source URI and keeps updated metadata", () => {
  assert.deepEqual(
    dedupe([
      { id: "one", size: 1 },
      { id: "one", size: 2 },
      { id: "two", size: 3 },
    ]),
    [
      { id: "one", size: 2 },
      { id: "two", size: 3 },
    ],
  );
});
test("formats real byte values including empty files", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(1024), "1.0 KB");
  assert.equal(bytes(1024 ** 3), "1.0 GB");
});
