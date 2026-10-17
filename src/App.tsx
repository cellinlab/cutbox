import { useEffect, useState } from "react";
import {
  Film,
  Folder,
  Database,
  SquarePen,
  Clapperboard,
  ListChecks,
  HardDrive,
  Plus,
  Search,
  LayoutGrid,
  List,
  ArrowRight,
  FolderOpen,
  X,
  Download,
  Settings,
  Tags,
  GitBranch,
  Undo2,
  Redo2,
} from "lucide-react";
import type { Snapshot, Job, Capabilities } from "./types";
import { Empty, Thumb, Modal, time, ErrorContext } from "./ui";
import { Assets } from "./Assets";
import { Editor } from "./Editor";
import { Templates } from "./Templates";
import { ToolsWorkspace } from "./ToolsWorkspace";
import { StoryWorkspace } from "./StoryWorkspace";
import { Search as SearchFilters, emptyFilters, matchesMedia } from "./Search";
import { Collections } from "./Collections";
const nav = [
  ["library", "素材库", Folder],
  ["assets", "资产", Database],
  ["annotate", "标注工作台", SquarePen],
  ["study", "拉片", Clapperboard],
  ["collections", "素材集合", Folder],
  ["templates", "标注模板", Tags],
  ["story", "故事与关系", GitBranch],
  ["tools", "分析与维护", Settings],
  ["jobs", "任务中心", ListChecks],
] as const;
const descriptions = {
  library: "每一帧，都有值得留下的信息。",
  assets: "让角色、场景与声音，拥有自己的档案。",
  annotate: "记录看见的细节，保留回到原片的线索。",
  study: "从镜头观察，到声画表达。",
  collections: "整理参考，带入下一次创作。",
  jobs: "查看本地处理与导出进度。",
  templates: "定义字段与规则，重复使用你的标注方式。",
  story: "关联证据、事件与人物，构建可游玩的分支。",
  tools: "本地分析、模型配置、可靠备份与修订历史。",
};
export default function App() {
  const [page, setPage] = useState<(typeof nav)[number][0]>("library");
  const [data, setData] = useState<Snapshot>({
    media: [],
    entities: [],
    annotations: [],
    collections: [],
    templates: [],
    events: [],
    relations: [],
    stories: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [mediaId, setMediaId] = useState<string>();
  const [initialTime, setInitialTime] = useState(0);
  const [filters, setFilters] = useState(emptyFilters);
  const [history, setHistory] = useState<{
    canUndo: boolean;
    canRedo: boolean;
  }>();
  const [profile, setProfile] = useState<"full" | "trimmed">("full");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [pack, setPack] = useState<{
    mode: "import" | "export";
    entityIds?: string[];
    collectionId?: string;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    if (!window.cutbox) return;
    let live = true;
    Promise.all([window.cutbox.snapshot(), window.cutbox.capabilities()])
      .then(([snapshot, caps]) => {
        if (live) {
          setData(snapshot);
          setCapabilities(caps);
          setReady(true);
        }
      })
      .catch((e) => live && setError(String(e.message || e)));
    const unsubscribe = window.cutbox.onJob((job) =>
      setJobs((prev) => [job, ...prev.filter((x) => x.id !== job.id)]),
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (ready)
      void window
        .cutbox!.history()
        .then(setHistory)
        .catch((e) => setError(String(e)));
  }, [data, ready]);
  useEffect(() => {
    if (window.cutbox)
      void window.cutbox
        .jobs()
        .then(setJobs)
        .catch((e) => setError(String(e)));
  }, []);
  async function mutate(fn: () => Promise<Snapshot>) {
    setError("");
    try {
      setData(await fn());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      const result = (await fn()) as
        { path?: string; cancelled?: boolean } | undefined;
      if (result?.path) setNotice(`已导出到 ${result.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function importMedia() {
    setBusy(true);
    try {
      await mutate(() => window.cutbox!.importMedia());
    } finally {
      setBusy(false);
    }
  }
  function open(id: string, start = 0) {
    setInitialTime(start);
    setMediaId(id);
    setPage("annotate");
  }
  function packageDialog(value: NonNullable<typeof pack>) {
    setPassword("");
    setError("");
    setShowPassword(false);
    setPack(value);
  }
  const media = data.media.filter(
    (m) =>
      (filter === "all" || m.kind === filter) &&
      m.name.toLowerCase().includes(query.toLowerCase()) &&
      matchesMedia(m, data, filters),
  );
  const title = nav.find((x) => x[0] === page)![1];
  return (
    <ErrorContext.Provider value={error}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <Film />
            <span>CutBox</span>
          </div>
          <nav aria-label="工作区">
            {nav.map(([id, label, Icon]) => (
              <button
                key={id}
                title={label}
                className={page === id ? "active" : ""}
                onClick={() => setPage(id)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="local">
            <HardDrive />
            <div>
              本地工作空间<small>所有素材仅保存在此设备</small>
            </div>
          </div>
        </aside>
        <main>
          <header>
            <div>
              <h1>{title}</h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="actions">
              <button
                className="icon"
                aria-label="撤销"
                disabled={!history?.canUndo}
                onClick={() => void mutate(() => window.cutbox!.undo())}
              >
                <Undo2 />
              </button>
              <button
                className="icon"
                aria-label="重做"
                disabled={!history?.canRedo}
                onClick={() => void mutate(() => window.cutbox!.redo())}
              >
                <Redo2 />
              </button>
              <button
                className="primary"
                disabled={!ready || busy}
                onClick={() => void importMedia()}
              >
                <Plus />
                {busy ? "导入中…" : "导入素材"}
              </button>
              <button
                disabled={!ready || busy}
                onClick={() => packageDialog({ mode: "import" })}
              >
                <FolderOpen />
                导入素材包
              </button>
            </div>
          </header>
          {error && (
            <div role="alert" className="banner error">
              <span>{error}</span>
              <button
                aria-label="关闭错误"
                className="icon"
                onClick={() => setError("")}
              >
                <X />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="banner">
              <span>{notice}</span>
              <button
                className="icon"
                aria-label="关闭提示"
                onClick={() => setNotice("")}
              >
                <X />
              </button>
            </div>
          )}
          {!window.cutbox ? (
            <Empty
              title="请在 CutBox 桌面应用中打开"
              description="当前页面未连接 Electron 本地服务，素材导入、存储与导出不可用。"
            />
          ) : !ready ? (
            <Empty
              title={error ? "无法打开本地工作空间" : "正在打开本地工作空间"}
              description={
                error
                  ? "请检查启动日志，解决错误后重新启动。"
                  : "正在读取素材与标注。"
              }
            />
          ) : (
            <div className="workspace">
              {page === "library" && (
                <>
                  <div className="toolbar library-toolbar">
                    <div className="search">
                      <Search />
                      <input
                        aria-label="搜索素材名称"
                        placeholder="搜索素材名称"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <div className="tabs">
                      {[
                        ["all", "全部"],
                        ["video", "视频"],
                        ["audio", "音频"],
                        ["image", "图片"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={filter === id ? "active" : ""}
                          onClick={() => setFilter(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="view-toggle">
                      <button
                        className={view === "grid" ? "active icon" : "icon"}
                        aria-label="网格视图"
                        onClick={() => setView("grid")}
                      >
                        <LayoutGrid />
                      </button>
                      <button
                        className={view === "list" ? "active icon" : "icon"}
                        aria-label="列表视图"
                        onClick={() => setView("list")}
                      >
                        <List />
                      </button>
                    </div>
                  </div>
                  <SearchFilters
                    data={data}
                    value={filters}
                    onChange={setFilters}
                    open={open}
                  />
                  {data.media.length === 0 ? (
                    <div className="onboarding">
                      <div className="import-zone">
                        <Film size={48} strokeWidth={1.3} />
                        <h2>从第一份素材开始</h2>
                        <p>导入视频、音频或图片，建立你的本地素材库。</p>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void importMedia()}
                        >
                          <Plus />
                          选择本地文件
                        </button>
                        <small>原始文件保持不变 · 仅建立本地引用</small>
                      </div>
                      <div className="steps">
                        {[
                          ["导入素材", "导入视频、音频或图片。"],
                          ["标注与关联", "为素材添加标注，建立关联。"],
                          ["整理并导出", "按需整理，导出使用。"],
                        ].map(([label, desc], i) => (
                          <div key={label} className="step">
                            <span>{i + 1}</span>
                            <div>
                              <strong>{label}</strong>
                              <small>{desc}</small>
                            </div>
                            {i < 2 && <ArrowRight />}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : media.length === 0 ? (
                    <Empty
                      title="没有匹配的素材"
                      description="试试其他名称，或切换素材类型。"
                    />
                  ) : (
                    <div
                      className={view === "grid" ? "media-grid" : "media-list"}
                    >
                      {media.map((m) => (
                        <button
                          className="media-card"
                          key={m.id}
                          onClick={() => open(m.id)}
                        >
                          <div className="thumbnail">
                            <Thumb media={m} />
                            {m.kind !== "image" && (
                              <span className="duration">
                                {time(m.duration)}
                              </span>
                            )}
                          </div>
                          <div className="card-body">
                            <strong>{m.name}</strong>
                            <p>
                              {m.kind === "video"
                                ? "视频"
                                : m.kind === "audio"
                                  ? "音频"
                                  : "图片"}{" "}
                              · {(m.size / 1024 / 1024).toFixed(1)} MB
                              {m.width ? ` · ${m.width} × ${m.height}` : ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {page === "assets" && (
                <Assets
                  data={data}
                  mutate={mutate}
                  onOpen={open}
                  onExport={(ids) =>
                    packageDialog({ mode: "export", entityIds: ids })
                  }
                />
              )}{" "}
              {(page === "annotate" || page === "study") && (
                <Editor
                  data={data}
                  mediaId={mediaId}
                  onSelect={setMediaId}
                  mutate={mutate}
                  run={run}
                  capabilities={capabilities}
                  study={page === "study"}
                  initialTime={initialTime}
                />
              )}{" "}
              {page === "collections" && (
                <Collections
                  data={data}
                  mutate={mutate}
                  run={run}
                  open={open}
                  onExport={(id) =>
                    packageDialog({ mode: "export", collectionId: id })
                  }
                />
              )}{" "}
              {page === "templates" && (
                <Templates data={data} mutate={mutate} />
              )}
              {page === "tools" && (
                <ToolsWorkspace
                  data={data}
                  mutate={mutate}
                  run={run}
                  open={open}
                />
              )}
              {page === "story" && (
                <StoryWorkspace
                  data={data}
                  mutate={mutate}
                  run={run}
                  open={open}
                />
              )}
              {page === "jobs" &&
                (jobs.length === 0 ? (
                  <Empty
                    title="当前没有处理任务"
                    description="导入与参考导出任务将在这里显示。"
                  />
                ) : (
                  <div className="job-list">
                    {jobs.map((job) => (
                      <article key={job.id}>
                        <div className="section-heading">
                          <strong>{job.label}</strong>
                          <span>
                            {{
                              running: "处理中",
                              succeeded: "已完成",
                              failed: "失败",
                              cancelled: "已取消",
                            }[job.status] || job.status}
                          </span>
                          {job.cancellable && job.status === "running" && (
                            <button
                              onClick={() =>
                                void run(() => window.cutbox!.cancelJob(job.id))
                              }
                            >
                              取消任务
                            </button>
                          )}
                        </div>
                        <progress
                          max={100}
                          value={
                            job.progress <= 1
                              ? job.progress * 100
                              : job.progress
                          }
                        />
                        {job.error && <p className="warning">{job.error}</p>}
                        {job.path && <p className="fine">{job.path}</p>}
                      </article>
                    ))}
                  </div>
                ))}
            </div>
          )}
          <footer>
            <span>{data.media.length} 份素材</span>
            <span>
              <HardDrive size={16} />
              本地存储
            </span>
          </footer>
        </main>
        {pack && (
          <Modal
            title={pack.mode === "import" ? "导入素材包" : "导出加密素材包"}
            onClose={() => !busy && setPack(null)}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  if (pack.mode === "import") {
                    if (
                      await mutate(() =>
                        window.cutbox!.importPackage({ password }),
                      )
                    )
                      setPack(null);
                  } else {
                    setError("");
                    try {
                      const result = await window.cutbox!.exportPackage({
                        password,
                        profile,
                        entityIds: pack.entityIds,
                        collectionId: pack.collectionId,
                      });
                      if (!result.cancelled) {
                        setNotice(`素材包已导出：${result.path}`);
                        setPack(null);
                      }
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    }
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p>
                本模式仅加密 JSON
                描述，素材文件保持明文。移动素材包时，请同时保留素材目录。
              </p>
              {pack.mode === "export" && (
                <label>
                  素材范围
                  <select
                    value={profile}
                    onChange={(e) =>
                      setProfile(e.target.value as "full" | "trimmed")
                    }
                  >
                    <option value="full">完整源素材</option>
                    <option value="trimmed">按标注区间裁切</option>
                  </select>
                </label>
              )}
              <label>
                素材包口令
                <input
                  required
                  minLength={pack.mode === "export" ? 12 : 1}
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                显示口令
              </label>
              <p className="fine">
                {pack.mode === "export"
                  ? "至少 12 个字符。请妥善保存口令，遗失后无法恢复。"
                  : "请选择 .cbox 文件，程序会验证描述与关联素材后导入。"}
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPack(null)}
                >
                  取消
                </button>
                <button className="primary" disabled={busy}>
                  <Download />
                  {busy
                    ? "处理中…"
                    : pack.mode === "export"
                      ? "选择位置并导出"
                      : "选择素材包并导入"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </ErrorContext.Provider>
  );
}
