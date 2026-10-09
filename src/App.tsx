import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  Image,
  LayoutGrid,
  List,
  LoaderCircle,
  Music2,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { bytes, categoryFor, dedupe, filterEntries } from "./utils.mjs";
import type {
  Category,
  Entry,
  Folder as FolderType,
  ScanEvent,
  Snapshot,
  Tab,
} from "./types";
import { isAndroid, Scanner } from "./scanner";
import {
  clearSnapshots,
  readSnapshots,
  removeSnapshot,
  saveSnapshot,
} from "./db";
import Thumb from "./Thumb";
type Active = {
  id: string;
  scope: string;
  label: string;
  category: string;
  items: Entry[];
  base: Entry[];
  count: number;
};
const categories = [
  { id: "photos", label: "Photos", Icon: Image, desc: "Every little moment" },
  { id: "videos", label: "Videos", Icon: Video, desc: "Memories in motion" },
  { id: "audio", label: "Audio", Icon: Music2, desc: "Sounds worth keeping" },
] as const;
export default function App() {
  const [tab, setTab] = useState<Tab>("all");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [folderScope, setFolderScope] = useState("");
  const [active, setActive] = useState<Active | null>(null);
  const activeRef = useRef<Active | null>(null);
  const snapshotsRef = useRef<Snapshot[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState("grid");
  const [limit, setLimit] = useState(60);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [storage, setStorage] = useState<{
    total: number;
    available: number;
  } | null>(null);
  const [preview, setPreview] = useState<Entry | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [picking, setPicking] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const notify = (text: string, error = false) => setToast({ text, error });
  const replaceSnapshots = (next: Snapshot[]) => {
    snapshotsRef.current = next;
    setSnapshots(next);
  };
  useEffect(() => {
    mounted.current = true;
    let listener: { remove: () => Promise<void> } | undefined;
    let disposed = false;
    async function setup() {
      try {
        let cached: Snapshot[] = [];
        try {
          cached = await readSnapshots();
        } catch {
          if (!disposed)
            notify("Saved index unavailable. You can still scan files.", true);
        }
        if (disposed) return;
        replaceSnapshots(cached);
        if (isAndroid) {
          const result = await Scanner.listFolders();
          if (disposed) return;
          setFolders(result.folders);
          Scanner.storageInfo()
            .then((s) => {
              if (!disposed) setStorage(s);
            })
            .catch(() => {});
          listener = await Scanner.addListener("scanProgress", onProgress);
          if (disposed) {
            await listener.remove();
            return;
          }
        }
        setReady(true);
      } catch (e) {
        if (!disposed) {
          notify(errorText(e), true);
          setReady(true);
        }
      }
    }
    void setup();
    return () => {
      disposed = true;
      mounted.current = false;
      void listener?.remove();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => setLimit(60), [tab, query, sort, folderScope]);
  useEffect(() => {
    setPreviewFailed(false);
    if (!preview?.file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(preview.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  useEffect(() => {
    if (!settings && !preview) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettings(false);
        setPreview(null);
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[role=dialog] button:not(:disabled),[role=dialog] a[href],[role=dialog] input,[role=dialog] select",
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [settings, preview]);
  async function onProgress(event: ScanEvent) {
    const job = activeRef.current;
    if (!job || event.scanId !== job.id) return;
    if (event.items?.length) {
      job.items.push(...event.items);
      job.count = event.count;
    }
    if (event.state === "batch") {
      if (mounted.current) setActive({ ...job });
      return;
    }
    if (event.state === "complete") {
      const snapshot: Snapshot = {
        scope: job.scope,
        items: dedupe([...job.base, ...job.items]),
        updated: Date.now(),
        limited: event.limited,
      };
      replaceSnapshots([
        ...snapshotsRef.current.filter((s) => s.scope !== job.scope),
        snapshot,
      ]);
      try {
        await saveSnapshot(snapshot);
        notify(
          `${event.count.toLocaleString()} files indexed${event.skipped ? ` · ${event.skipped} folders skipped` : ""}${event.limited ? " · limited photo/video access" : ""}.`,
        );
      } catch {
        notify("Scan complete. Could not save the index on this device.", true);
      }
    } else if (event.state === "error")
      notify(event.message || "Scan failed. Previous index kept.", true);
    else notify("Scan stopped. Previous index kept.");
    activeRef.current = null;
    if (mounted.current) setActive(null);
  }
  async function scan(category = "all", folder?: FolderType, reselect = false) {
    if (activeRef.current || !ready) return;
    if (!isAndroid) {
      folderInput.current?.click();
      return;
    }
    const scope = folder ? `folder:${folder.uri}` : "media";
    const base =
      category === "all" || folder
        ? []
        : (
            snapshotsRef.current.find((s) => s.scope === scope)?.items || []
          ).filter((e) => e.category !== category);
    const job: Active = {
      id: crypto.randomUUID(),
      scope,
      label: folder?.name || (category === "all" ? "Media library" : category),
      category,
      items: [],
      base,
      count: 0,
    };
    activeRef.current = job;
    setActive(job);
    if (folder) {
      setFolderScope(scope);
      setTab("folders");
    }
    try {
      await Scanner.startScan({
        scanId: job.id,
        scope,
        category,
        treeUri: folder?.uri,
        reselect,
      });
    } catch (e) {
      activeRef.current = null;
      setActive(null);
      notify(errorText(e), true);
    }
  }
  async function cancel() {
    const job = activeRef.current;
    if (!job) return;
    if (isAndroid) {
      try {
        await Scanner.cancelScan({ scanId: job.id });
      } catch (e) {
        notify(errorText(e), true);
      }
    } else {
      activeRef.current = null;
      setActive(null);
      notify("Scan stopped. Previous index kept.");
    }
  }
  async function chooseFolder() {
    if (activeRef.current || picking) return;
    if (!isAndroid) {
      folderInput.current?.click();
      return;
    }
    setPicking(true);
    try {
      const folder = await Scanner.chooseFolder();
      setFolders((f) => [...f.filter((x) => x.uri !== folder.uri), folder]);
      await scan("all", folder);
    } catch (e) {
      if (!errorText(e).toLowerCase().includes("cancel"))
        notify(errorText(e), true);
    } finally {
      setPicking(false);
    }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length || activeRef.current) return;
    const list = Array.from(files);
    if (folderInput.current) folderInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";
    const root = list[0].webkitRelativePath.split("/")[0];
    const name = list[0].webkitRelativePath ? root : "Selected files";
    const scope = `web:${name}`;
    const job: Active = {
      id: crypto.randomUUID(),
      scope,
      label: name,
      category: "all",
      items: [],
      base: [],
      count: 0,
    };
    activeRef.current = job;
    setActive(job);
    setTab("folders");
    setFolderScope(scope);
    for (let i = 0; i < list.length; i += 100) {
      if (activeRef.current?.id !== job.id) return;
      for (const file of list.slice(i, i + 100)) {
        const path = file.webkitRelativePath || file.name;
        job.items.push({
          id: `${scope}/${path}`,
          uri: "",
          name: file.name,
          mime: file.type,
          size: file.size,
          modified: file.lastModified,
          folder: path.includes("/")
            ? path.slice(0, path.lastIndexOf("/"))
            : name,
          category: categoryFor(file.type, file.name) as Category,
          scope,
          file,
        });
      }
      job.count = job.items.length;
      setActive({ ...job });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (activeRef.current?.id !== job.id) return;
    replaceSnapshots([
      ...snapshotsRef.current.filter((s) => s.scope !== scope),
      { scope, items: job.items, updated: Date.now() },
    ]);
    activeRef.current = null;
    setActive(null);
    notify(
      `${job.count.toLocaleString()} files ready. Browser files stay in this session.`,
    );
    if (folderInput.current) folderInput.current.value = "";
    if (fileInput.current) fileInput.current.value = "";
  }
  async function openEntry(entry: Entry) {
    if (isAndroid) {
      try {
        await Scanner.openFile({ uri: entry.uri, mime: entry.mime });
      } catch (e) {
        notify(errorText(e), true);
      }
    } else setPreview(entry);
  }
  async function forget(folder: FolderType) {
    try {
      await Scanner.forgetFolder({ uri: folder.uri });
      await removeSnapshot(`folder:${folder.uri}`);
      replaceSnapshots(
        snapshotsRef.current.filter((s) => s.scope !== `folder:${folder.uri}`),
      );
      setFolders((f) => f.filter((x) => x.uri !== folder.uri));
      if (folderScope === `folder:${folder.uri}`) setFolderScope("");
      notify("Folder disconnected. Your files are unchanged.");
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  async function clear() {
    try {
      await clearSnapshots();
      replaceSnapshots([]);
      setConfirmClear(false);
      notify("Saved index cleared. Your files are unchanged.");
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  const currentSnapshots = useMemo(
    () =>
      active
        ? [
            ...snapshots.filter((s) => s.scope !== active.scope),
            {
              scope: active.scope,
              items: [...active.base, ...active.items],
              updated: Date.now(),
            },
          ]
        : snapshots,
    [snapshots, active],
  );
  const all: Entry[] = useMemo(
    () => dedupe(currentSnapshots.flatMap((s) => s.items)),
    [currentSnapshots],
  );
  const filtered: Entry[] = useMemo(
    () =>
      filterEntries(
        tab === "folders"
          ? folderScope
            ? all.filter((e) => e.scope === folderScope)
            : all.filter((e) => e.scope !== "media")
          : all,
        query,
        ["photos", "videos", "audio"].includes(tab) ? tab : "",
        sort,
      ),
    [all, tab, folderScope, query, sort],
  );
  const count = (id: string) => all.filter((x) => x.category === id).length;
  const lastScan = Math.max(0, ...snapshots.map((s) => s.updated));
  const folderViews = [
    ...folders.map((f) => ({ ...f, scope: `folder:${f.uri}` })),
    ...snapshots
      .filter((s) => s.scope.startsWith("web:"))
      .map((s) => ({ uri: "", name: s.scope.slice(4), scope: s.scope })),
  ];
  const title =
    tab === "all"
      ? "Your library"
      : tab === "folders"
        ? "Your folders"
        : categories.find((c) => c.id === tab)?.label;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("all");
          }}
        >
          <span className="brand-icon">
            <ScanLine />
          </span>
          Pocket<span className="brand-light">Scan</span>
        </a>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {[
            { id: "all", label: "Overview", Icon: LayoutGrid },
            ...categories,
            { id: "folders", label: "Folders", Icon: Folder },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={tab === id ? "selected" : ""}
            >
              <Icon size={19} />
              {label}
              {id !== "all" && id !== "folders" && <span>{count(id)}</span>}
            </button>
          ))}
        </nav>
        <div className="side-footer">
          <div className="privacy-mini">
            <ShieldCheck size={21} />
            <div>
              Yours. Always.<small>Files stay on your device.</small>
            </div>
          </div>
          <button className="settings-button" onClick={() => setSettings(true)}>
            <Settings size={18} />
            Settings
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-icon">
              <ScanLine size={21} />
            </span>
            <b>Pocket Scan</b>
          </div>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <span className="device-badge">
              <span />
              {isAndroid ? "On this device" : "Browser session"}
            </span>
            <button
              className="icon-button"
              aria-label="Open settings"
              onClick={() => setSettings(true)}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>
        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">A LITTLE ORDER. A LOT OF SPACE.</p>
              <h1>
                {title}
                <span>.</span>
              </h1>
              <p>Find your files. Keep your flow.</p>
            </div>
            <button
              className="primary"
              onClick={() =>
                scan(["photos", "videos", "audio"].includes(tab) ? tab : "all")
              }
              disabled={!!active || !ready}
            >
              <RefreshCw size={17} />
              {isAndroid
                ? "Scan " +
                  (["photos", "videos", "audio"].includes(tab) ? tab : "media")
                : "Choose a folder"}
            </button>
          </section>
          {tab === "all" && (
            <section className="hero">
              <div className="hero-copy">
                <span className="pill">
                  <ShieldCheck size={14} /> PRIVATE BY DESIGN
                </span>
                <h2>
                  <span className="desktop-title">
                    Everything you need.
                    <br />
                    Right where you left it.
                  </span>
                  <span className="mobile-title">
                    Your files.
                    <br />
                    Simply organized.
                  </span>
                </h2>
                <p>
                  Bring your photos, videos and audio together.
                  <br className="desktop-only" /> A lighter way to explore
                  what’s on your device.
                </p>
                <button
                  className="hero-button"
                  onClick={chooseFolder}
                  disabled={!!active || picking}
                >
                  <FolderOpen size={18} />
                  Open a folder
                  <ArrowUpRight size={17} />
                </button>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit o1" />
                <div className="orbit o2" />
                <div className="floating-tile photo-tile">
                  <Image size={36} />
                </div>
                <div className="floating-tile audio-tile">
                  <Music2 size={32} />
                </div>
                <div className="folder-art">
                  <div className="folder-back" />
                  <div className="folder-paper" />
                  <div className="folder-front">
                    <ScanLine size={48} />
                  </div>
                </div>
                <div className="art-caption">
                  <span /> SIMPLY ORGANIZED
                </div>
              </div>
            </section>
          )}
          <section className="category-grid">
            {categories.map(({ id, label, Icon, desc }) => (
              <div
                className={`category-card ${id} ${tab === id ? "active-card" : ""}`}
                key={id}
              >
                <button className="category-main" onClick={() => setTab(id)}>
                  <span className="category-icon">
                    <Icon size={23} />
                  </span>
                  <ArrowUpRight className="category-arrow" size={19} />
                  <h3>
                    {label}
                    <span>{count(id).toLocaleString()}</span>
                  </h3>
                  <p>{desc}</p>
                </button>
                <button
                  className="category-scan"
                  onClick={() => scan(id)}
                  disabled={!!active || !ready}
                >
                  <RefreshCw size={13} />
                  {isAndroid ? "Scan " + label.toLowerCase() : "Choose folder"}
                </button>
              </div>
            ))}
          </section>
          {active && (
            <section className="scan-progress" role="status">
              <span className="scanning-icon">
                <ScanLine size={22} />
              </span>
              <div>
                <strong>Scanning {active.label}…</strong>
                <p>
                  {active.count.toLocaleString()} files found · you can keep
                  browsing
                </p>
                <div className="indeterminate" />
              </div>
              <button className="text-button" onClick={cancel}>
                Stop
              </button>
            </section>
          )}
          {!isAndroid && (
            <div className="browser-note">
              <Smartphone size={19} />
              <span>
                Browser mode: choose files to explore. Device-wide scanning is
                available in the Android app.
              </span>
              <button
                onClick={() => fileInput.current?.click()}
                disabled={!!active}
              >
                Choose files
                <Plus size={14} />
              </button>
            </div>
          )}
          {snapshots.some((s) => s.limited) && (
            <div className="browser-note">
              <ShieldCheck size={18} />
              <span>
                Android has granted access to selected photos or videos.
              </span>
              <button
                disabled={!!active}
                onClick={() => scan("all", undefined, true)}
              >
                Manage access
              </button>
            </div>
          )}
          {tab === "folders" && (
            <section className="folders-section">
              <div className="section-heading">
                <h2>Connected folders</h2>
                <button
                  className="text-button"
                  onClick={chooseFolder}
                  disabled={!!active || picking}
                >
                  <Plus size={16} />
                  Add folder
                </button>
              </div>
              <div className="folder-chips">
                <button
                  className={!folderScope ? "chosen" : ""}
                  onClick={() => setFolderScope("")}
                >
                  All folders
                </button>
                {folderViews.map((f) => (
                  <div
                    className={`folder-chip ${folderScope === f.scope ? "chosen" : ""}`}
                    key={f.scope}
                  >
                    <button onClick={() => setFolderScope(f.scope)}>
                      <Folder size={16} />
                      {f.name}
                    </button>
                    {f.uri && (
                      <>
                        <button
                          aria-label={`Rescan ${f.name}`}
                          onClick={() => scan("all", f)}
                          disabled={!!active}
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          aria-label={`Disconnect ${f.name}`}
                          disabled={!!active}
                          onClick={() => forget(f)}
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="library-section">
            <div className="section-heading">
              <div>
                <h2>
                  {tab === "all"
                    ? "All files"
                    : tab === "folders"
                      ? folderViews.find((f) => f.scope === folderScope)
                          ?.name || "Folder files"
                      : `Your ${tab}`}{" "}
                  <span className="count-badge">
                    {filtered.length.toLocaleString()}
                  </span>
                </h2>
                <p>
                  {active
                    ? "Discovering files…"
                    : lastScan
                      ? `Last scan ${new Date(lastScan).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : "Your next discovery starts here"}
                </p>
              </div>
              <div className="view-switch">
                <button
                  aria-label="Grid view"
                  aria-pressed={layout === "grid"}
                  onClick={() => setLayout("grid")}
                  className={layout === "grid" ? "chosen" : ""}
                >
                  <LayoutGrid size={17} />
                </button>
                <button
                  aria-label="List view"
                  aria-pressed={layout === "list"}
                  onClick={() => setLayout("list")}
                  className={layout === "list" ? "chosen" : ""}
                >
                  <List size={18} />
                </button>
              </div>
            </div>
            <div className="filter-bar">
              <label className="search">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search files or folders"
                  aria-label="Search files or folders"
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
              <label className="sort">
                <ArrowDownUp size={16} />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Sort files"
                >
                  <option value="recent">Newest first</option>
                  <option value="name">Name A–Z</option>
                  <option value="size">Largest first</option>
                </select>
              </label>
            </div>
            {!ready ? (
              <div className="empty">
                <LoaderCircle className="spin" />
                <h3>Opening your library</h3>
              </div>
            ) : !filtered.length ? (
              <div className="empty">
                <div className="empty-icon">
                  {query ? <Search size={34} /> : <FolderOpen size={38} />}
                </div>
                <h3>
                  {query
                    ? "No matches found"
                    : active
                      ? "Looking for your files…"
                      : "A fresh start for your files"}
                </h3>
                <p>
                  {query
                    ? "Try a different name or folder."
                    : "Scan your media or choose a folder to see real files here."}
                </p>
                {!query && !active && (
                  <button className="secondary" onClick={chooseFolder}>
                    <Plus size={16} />
                    Choose a folder
                  </button>
                )}
              </div>
            ) : (
              <div className={`file-results ${layout}`}>
                {filtered.slice(0, limit).map((entry) => (
                  <button
                    className="file-card"
                    key={entry.id}
                    onClick={() => openEntry(entry)}
                  >
                    <Thumb entry={entry} />
                    <div className="file-info">
                      <strong title={entry.name}>{entry.name}</strong>
                      <span title={entry.folder}>
                        {entry.folder || "Device media"}
                      </span>
                    </div>
                    <div className="file-meta">
                      <span>{bytes(entry.size)}</span>
                      <span>
                        {entry.modified
                          ? new Date(entry.modified).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )
                          : "—"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {filtered.length > limit && (
              <button
                className="load-more secondary"
                onClick={() => setLimit((l) => l + 60)}
              >
                Show more · {filtered.length - limit} remaining
              </button>
            )}
          </section>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={14} />
              No uploads. No account. Just your files.
            </span>
            <span>
              {all.length.toLocaleString()} indexed ·{" "}
              {bytes(all.reduce((n, e) => n + e.size, 0))}
            </span>
          </footer>
        </div>
      </main>
      <nav className="bottom-nav">
        {[
          { id: "all", label: "Home", Icon: LayoutGrid },
          ...categories,
          { id: "folders", label: "Folders", Icon: Folder },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id as Tab)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <input
        ref={folderInput}
        type="file"
        multiple
        {...{ webkitdirectory: "", directory: "" }}
        hidden
        onChange={(e) => void importFiles(e.target.files)}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => void importFiles(e.target.files)}
      />
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={19} /> : <Check size={19} />}
          <span>{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>Make yourself at home.</h2>
              <button
                autoFocus
                className="icon-button"
                onClick={() => setSettings(false)}
                aria-label="Close settings"
              >
                <X />
              </button>
            </div>
            <div className="settings-block">
              <ShieldCheck />
              <h3>Private, on purpose.</h3>
              <p>
                Scanning reads file information on your device. Pocket Scan has
                no server, tracking or uploads. Opening a file may launch
                another app you choose.
              </p>
            </div>
            <div className="settings-row">
              <HardDrive />
              <div>
                <strong>Device storage</strong>
                <p>
                  {storage
                    ? `${bytes(storage.available)} free of ${bytes(storage.total)}`
                    : "Available in the Android app"}
                </p>
              </div>
            </div>
            {isAndroid && (
              <button
                className="settings-row actionable"
                onClick={() =>
                  Scanner.openSettings().catch((e) =>
                    notify(errorText(e), true),
                  )
                }
              >
                <Settings />
                <div>
                  <strong>Android permissions</strong>
                  <p>Manage media access in device settings.</p>
                </div>
                <ChevronRight />
              </button>
            )}
            <div className="settings-block">
              <h3>Saved file index</h3>
              <p>
                Only metadata is saved in the APK. Rescan to refresh changes.
                Browser selections last for this session.
              </p>
              {confirmClear ? (
                <div className="confirm-row">
                  <span>Clear the saved list?</span>
                  <button
                    className="danger"
                    disabled={!!active}
                    onClick={clear}
                  >
                    Clear
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setConfirmClear(false)}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  className="secondary"
                  disabled={!!active}
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 size={16} />
                  Clear index
                </button>
              )}
            </div>
            <p className="version">Pocket Scan 1.0 · React + Capacitor</p>
          </section>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <section
            className="modal preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="File preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>{preview.name}</h2>
              <button
                autoFocus
                className="icon-button"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                <X />
              </button>
            </div>
            {previewUrl && !previewFailed && preview.category === "photos" ? (
              <img
                className="preview-image"
                src={previewUrl}
                alt={preview.name}
                onError={() => setPreviewFailed(true)}
              />
            ) : previewUrl &&
              !previewFailed &&
              preview.category === "videos" ? (
              <video
                controls
                src={previewUrl}
                onError={() => setPreviewFailed(true)}
              />
            ) : previewUrl && !previewFailed && preview.category === "audio" ? (
              <audio
                controls
                src={previewUrl}
                onError={() => setPreviewFailed(true)}
              />
            ) : (
              <div className="settings-block">
                <FolderOpen />
                <p>
                  {previewFailed
                    ? "This format cannot be previewed in your browser."
                    : "Preview unavailable for this file type."}
                </p>
              </div>
            )}
            <p>
              {bytes(preview.size)} · {preview.mime || "Unknown file type"}
            </p>
            {previewUrl && (
              <a
                className="secondary"
                href={previewUrl}
                download={preview.name}
              >
                Download file
              </a>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "Something went wrong. Please try again.";
}
