import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface FileEntry {
  name: string;
  size: number;
  ext: string;
  is_zlib: boolean;
}

interface SngInfo {
  encrypted_size?: number;
  iv?: string;
  uncompressed_size?: number;
  actual_decompressed?: number;
  hex_preview?: string;
  signature?: string;
  error?: string;
}

interface InspectResult {
  type: string;
  name: string;
  raw_size: number;
  ext: string;
  hex_preview: string;
  is_text: boolean;
  text_content: string;
  is_sng: boolean;
  sng_info: SngInfo | null;
}

type Tab = "explorer" | "repacker";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function hexDump(hex: string): string {
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 32) {
    const chunk = hex.slice(i, i + 32);
    const offset = (i / 2).toString(16).padStart(8, "0");
    const bytes = chunk.match(/.{2}/g)?.join(" ") || "";
    const ascii = (chunk.match(/.{2}/g) || [])
      .map(h => {
        const c = parseInt(h, 16);
        return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
      })
      .join("");
    lines.push(`${offset}  ${bytes.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("explorer");

  // Keys — user must bring their own
  const [psarcKey, setPsarcKey] = useState("");
  const [psarcIv, setPsarcIv] = useState("");
  const [sngKey, setSngKey] = useState("");

  // Explorer state
  const [archivePath, setArchivePath] = useState("");
  const [fileList, setFileList] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<InspectResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Repacker state
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [newPsarcKey, setNewPsarcKey] = useState("");
  const [newPsarcIv, setNewPsarcIv] = useState("");
  const [newSngKey, setNewSngKey] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  // Resizable columns
  const [filePanelWidth, setFilePanelWidth] = useState(380);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<string>("repacker-progress", (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.type === "log") {
          setLogs((prev) => [...prev, data.message]);
        } else if (data.type === "progress") {
          setProgress({ current: data.current, total: data.total });
        } else if (data.type === "done") {
          setIsRunning(false);
          setLogs((prev) => [...prev, "✅ Batch Repacking Complete!"]);
        }
      } catch {
        setLogs((prev) => [...prev, event.payload]);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── Resize handling ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = filePanelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, [filePanelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(200, Math.min(800, dragStartWidth.current + delta));
      setFilePanelWidth(newWidth);
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Key Save/Load (Slopsmith JSON format) ──
  const loadKeys = async () => {
    const selected = await open({
      filters: [{ name: "JSON Key Files", extensions: ["json"] }],
    });
    if (selected && typeof selected === "string") {
      try {
        const raw: string = await invoke("read_file_contents", { path: selected });
        const data = JSON.parse(raw);
        if (data.SLOPSMITH_ARC_KEY) setPsarcKey(data.SLOPSMITH_ARC_KEY);
        if (data.SLOPSMITH_ARC_IV) setPsarcIv(data.SLOPSMITH_ARC_IV);
        if (data.SLOPSMITH_ZLIB_KEY) setSngKey(data.SLOPSMITH_ZLIB_KEY);
      } catch (e) {
        alert("Failed to load keys: " + e);
      }
    }
  };

  const saveKeys = async () => {
    const selected = await save({
      defaultPath: "keys.json",
      filters: [{ name: "JSON Key Files", extensions: ["json"] }],
    });
    if (selected) {
      const data = {
        SLOPSMITH_ARC_KEY: psarcKey,
        SLOPSMITH_ARC_IV: psarcIv,
        SLOPSMITH_ZLIB_KEY: sngKey,
      };
      try {
        await invoke("write_file_contents", {
          path: selected,
          contents: JSON.stringify(data, null, 2),
        });
      } catch (e) {
        alert("Failed to save keys: " + e);
      }
    }
  };

  // ── Explorer Actions ──
  const openArchive = async () => {
    const selected = await open({
      filters: [{ name: "PSARC Archives", extensions: ["psarc"] }],
    });
    if (selected && typeof selected === "string") {
      setArchivePath(selected);
      setFileList([]);
      setSelectedFile(null);
      setInspectData(null);
      setIsLoading(true);
      try {
        const raw: string = await invoke("list_psarc", {
          filePath: selected, key: psarcKey, iv: psarcIv,
        });
        const data = JSON.parse(raw);
        if (data.type === "file_list") {
          setFileList(data.files);
        } else if (data.type === "error") {
          alert("Error: " + data.message);
        }
      } catch (e) {
        alert("Failed to open archive: " + e);
      }
      setIsLoading(false);
    }
  };

  const inspectFile = async (name: string) => {
    setSelectedFile(name);
    setInspectData(null);
    setIsLoading(true);
    try {
      const raw: string = await invoke("inspect_entry", {
        filePath: archivePath, entryName: name,
        key: psarcKey, iv: psarcIv, sngKey: sngKey,
      });
      const data = JSON.parse(raw);
      if (data.type === "inspect_result") {
        setInspectData(data);
      } else if (data.type === "error") {
        alert("Inspect error: " + data.message);
      }
    } catch (e) {
      alert("Inspect failed: " + e);
    }
    setIsLoading(false);
  };

  // ── Repacker Actions ──
  const selectInputDir = async () => {
    const selected = await open({ directory: true });
    if (selected && typeof selected === "string") setInputDir(selected);
  };
  const selectOutputDir = async () => {
    const selected = await open({ directory: true });
    if (selected && typeof selected === "string") setOutputDir(selected);
  };
  const selectSingleFile = async () => {
    const selected = await open({
      filters: [{ name: "PSARC Archives", extensions: ["psarc"] }],
    });
    if (selected && typeof selected === "string") setInputDir(selected);
  };
  const generateKeys = () => {
    const rh = (len: number) =>
      Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase();
    setNewPsarcKey(rh(64));
    setNewPsarcIv(rh(32));
    setNewSngKey(rh(64));
  };

  const loadNewKeys = async () => {
    const selected = await open({
      filters: [{ name: "JSON Key Files", extensions: ["json"] }],
    });
    if (selected && typeof selected === "string") {
      try {
        const raw: string = await invoke("read_file_contents", { path: selected });
        const data = JSON.parse(raw);
        if (data.SLOPSMITH_ARC_KEY) setNewPsarcKey(data.SLOPSMITH_ARC_KEY);
        if (data.SLOPSMITH_ARC_IV) setNewPsarcIv(data.SLOPSMITH_ARC_IV);
        if (data.SLOPSMITH_ZLIB_KEY) setNewSngKey(data.SLOPSMITH_ZLIB_KEY);
      } catch (e) {
        alert("Failed to load keys: " + e);
      }
    }
  };

  const saveNewKeys = async () => {
    const selected = await save({
      defaultPath: "new_keys.json",
      filters: [{ name: "JSON Key Files", extensions: ["json"] }],
    });
    if (selected) {
      const data = {
        SLOPSMITH_ARC_KEY: newPsarcKey,
        SLOPSMITH_ARC_IV: newPsarcIv,
        SLOPSMITH_ZLIB_KEY: newSngKey,
      };
      try {
        await invoke("write_file_contents", {
          path: selected,
          contents: JSON.stringify(data, null, 2),
        });
      } catch (e) {
        alert("Failed to save keys: " + e);
      }
    }
  };

  const extractFile = async () => {
    if (!selectedFile || !archivePath) return;
    const selected = await save({
      defaultPath: selectedFile.split("/").pop() || "extracted_file",
    });
    if (selected) {
      try {
        await invoke("extract_single_file", {
          archivePath, entryName: selectedFile,
          key: psarcKey, iv: psarcIv, outputPath: selected,
        });
        alert("Extracted successfully!");
      } catch (e) {
        alert("Extract failed: " + e);
      }
    }
  };

  const handleRepack = async () => {
    if (!inputDir || !outputDir) { alert("Select input and output directories!"); return; }
    if (!newPsarcKey || !newPsarcIv || !newSngKey) { alert("Generate or input new keys!"); return; }
    setIsRunning(true); setLogs([]); setProgress({ current: 0, total: 0 });
    try {
      await invoke("run_repacker", {
        inputDir, outputDir, oldPsarcKey: psarcKey, oldPsarcIv: psarcIv,
        newPsarcKey, newPsarcIv, oldSngKey: sngKey, newSngKey, overwrite
      });
    } catch (error) {
      setIsRunning(false);
      setLogs((prev) => [...prev, `Error: ${error}`]);
    }
  };

  // ── File icon helper ──
  const getIcon = (ext: string) => {
    switch (ext) {
      case ".sng": return "🔐";
      case ".xml": return "📄";
      case ".json": case ".hsan": case ".manifest": return "📋";
      case ".dds": return "🖼️";
      case ".bnk": case ".wem": return "🔊";
      case ".dlc": return "📦";
      default: return "📁";
    }
  };

  return (
    <div className="app-container">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>PSARC</h1>
          <span className="logo-sub">Archiver</span>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-btn ${activeTab === "explorer" ? "active" : ""}`}
                  onClick={() => setActiveTab("explorer")}>
            🔍 Explorer
          </button>
          <button className={`nav-btn ${activeTab === "repacker" ? "active" : ""}`}
                  onClick={() => setActiveTab("repacker")}>
            🔄 Repacker
          </button>
        </nav>

        <div className="sidebar-keys">
          <div className="keys-header">
            <h3>🔑 Your Keys</h3>
            <div className="keys-actions">
              <button onClick={loadKeys} className="tiny-btn" title="Load keys from JSON">📂</button>
              <button onClick={saveKeys} className="tiny-btn" title="Save keys to JSON">💾</button>
            </div>
          </div>
          <p className="key-hint">Bring your own keys</p>
          <div className="key-input">
            <label>PSARC KEY</label>
            <input type="text" value={psarcKey} onChange={e => setPsarcKey(e.target.value)}
                   placeholder="SLOPSMITH_ARC_KEY..." />
          </div>
          <div className="key-input">
            <label>PSARC IV</label>
            <input type="text" value={psarcIv} onChange={e => setPsarcIv(e.target.value)}
                   placeholder="SLOPSMITH_ARC_IV..." />
          </div>
          <div className="key-input">
            <label>ZLIB KEY</label>
            <input type="text" value={sngKey} onChange={e => setSngKey(e.target.value)}
                   placeholder="SLOPSMITH_ZLIB_KEY..." />
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="main-content">
        {activeTab === "explorer" && (
          <div className="explorer-layout">
            {/* File List Panel */}
            <div className="file-panel" style={{ width: filePanelWidth, minWidth: filePanelWidth }}>
              <div className="panel-header">
                <h2>Archive Contents</h2>
                <button onClick={openArchive} className="action-btn">📂 Open PSARC</button>
              </div>
              {archivePath && (
                <div className="archive-path">{archivePath.split("\\").pop()}</div>
              )}
              {isLoading && !inspectData && <div className="loading">Loading...</div>}
              <div className="file-list">
                {fileList.map((f, i) => (
                  <div
                    key={i}
                    className={`file-row ${selectedFile === f.name ? "selected" : ""} ${f.is_zlib ? "inspectable" : ""}`}
                    onClick={() => inspectFile(f.name)}
                  >
                    <span className="file-icon">{getIcon(f.ext)}</span>
                    <span className="file-name">{f.name}</span>
                    <span className="file-size">{formatBytes(f.size)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Resize Handle */}
            <div className="resize-handle" onMouseDown={onResizeStart} />

            {/* Inspector Panel */}
            <div className="inspect-panel">
              <div className="panel-header">
                <h2>Inspector</h2>
                {selectedFile && (
                  <button onClick={extractFile} className="action-btn">💾 Extract File</button>
                )}
              </div>
              {!inspectData && !isLoading && (
                <div className="empty-state">Select a file to inspect</div>
              )}
              {isLoading && inspectData === null && selectedFile && (
                <div className="loading">Inspecting {selectedFile}...</div>
              )}
              {inspectData && (
                <div className="inspect-content">
                  <div className="inspect-meta">
                    <div className="meta-row">
                      <span className="meta-label">File</span>
                      <span className="meta-value">{inspectData.name}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Size</span>
                      <span className="meta-value">{formatBytes(inspectData.raw_size)}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Type</span>
                      <span className="meta-value">{inspectData.ext}</span>
                    </div>
                  </div>

                  {inspectData.is_text && (
                    <div className="inspect-section">
                      <h3>Text Content</h3>
                      <pre className="text-viewer">{inspectData.text_content}</pre>
                    </div>
                  )}

                  {inspectData.sng_info && (
                    <div className="inspect-section sng-section">
                      <h3>🔐 Deep Zlib Inspection</h3>
                      {inspectData.sng_info.error ? (
                        <div className="sng-error">❌ {inspectData.sng_info.error}</div>
                      ) : (
                        <>
                          <div className="meta-row">
                            <span className="meta-label">IV</span>
                            <span className="meta-value mono">{inspectData.sng_info.iv}</span>
                          </div>
                          <div className="meta-row">
                            <span className="meta-label">Encrypted</span>
                            <span className="meta-value">{formatBytes(inspectData.sng_info.encrypted_size || 0)}</span>
                          </div>
                          <div className="meta-row">
                            <span className="meta-label">Decompressed</span>
                            <span className="meta-value">{formatBytes(inspectData.sng_info.actual_decompressed || 0)}</span>
                          </div>
                          {inspectData.sng_info.hex_preview && (
                            <>
                              <h4>Decompressed Hex (first 256 bytes)</h4>
                              <pre className="hex-viewer">{hexDump(inspectData.sng_info.hex_preview)}</pre>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="inspect-section">
                    <h3>Raw Hex (first 256 bytes)</h3>
                    <pre className="hex-viewer">{hexDump(inspectData.hex_preview)}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "repacker" && (
          <div className="repacker-layout">
            <div className="card">
              <h2>Input / Output</h2>
              <div className="flex-row">
                <button onClick={selectInputDir} className="secondary-btn">Browse Folder</button>
                <button onClick={selectSingleFile} className="secondary-btn">Single File</button>
                <input type="text" readOnly value={inputDir} placeholder="Path to input archives..." />
              </div>
              <div className="flex-row">
                <button onClick={selectOutputDir} className="secondary-btn">Browse Output</button>
                <input type="text" readOnly value={outputDir} placeholder="Output directory..." />
              </div>
            </div>

            <div className="card accent-card">
              <div className="header-row">
                <h2>New Encryption Keys</h2>
                <div className="keys-actions">
                  <button onClick={loadNewKeys} className="tiny-btn" title="Load new keys from JSON">📂</button>
                  <button onClick={saveNewKeys} className="tiny-btn" title="Save new keys to JSON">💾</button>
                  <button onClick={generateKeys} className="action-btn">🎲 Generate</button>
                </div>
              </div>
              <div className="input-group">
                <label>New PSARC Key</label>
                <input type="text" value={newPsarcKey} onChange={e => setNewPsarcKey(e.target.value)}
                       placeholder="32-byte hex or any string" />
              </div>
              <div className="input-group">
                <label>New PSARC IV</label>
                <input type="text" value={newPsarcIv} onChange={e => setNewPsarcIv(e.target.value)}
                       placeholder="16-byte hex or any string" />
              </div>
              <div className="input-group">
                <label>New Zlib Key</label>
                <input type="text" value={newSngKey} onChange={e => setNewSngKey(e.target.value)}
                       placeholder="32-byte hex or any string" />
              </div>
            </div>

            <div className="flex-row" style={{ alignItems: "center", marginBottom: "1.25rem", marginTop: "-0.5rem" }}>
              <input type="checkbox" id="overwrite-check" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} style={{ width: "auto" }} />
              <label htmlFor="overwrite-check" style={{ fontSize: "0.85rem", color: "var(--text)", marginLeft: "0.5rem", cursor: "pointer" }}>
                Overwrite existing output files
              </label>
            </div>

            <button className={`primary-btn ${isRunning ? "running" : ""}`}
                    onClick={handleRepack} disabled={isRunning}>
              {isRunning ? "Repacking..." : "🔄 Repack Archives"}
            </button>

            {progress.total > 0 && (
              <div className="progress-section">
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill"
                       style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                </div>
                <p className="progress-text">{progress.current} / {progress.total}</p>
              </div>
            )}

            <div className="logs-section">
              <h3>Activity Log</h3>
              <div className="log-window" ref={logRef}>
                {logs.map((log, i) => (
                  <div key={i} className="log-entry">{log}</div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
