import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Download,
  ClipboardCheck,
  FileText,
  Tags,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type { Snapshot, DatasetReport, DatasetOptions, Bridge } from "./types";
import { time } from "./ui";
import "./data-workspace.css";
type Props = {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  open: (id: string, start?: number) => void;
};
const issueLabels: Record<string, string> = {
  missing_media: "标注引用的素材不存在。",
  invalid_source_metadata: "源文件描述不完整或无效，请检查摘要、大小和时长。",
  invalid_dimensions: "画面尺寸缺失或无效。",
  invalid_interval: "样本时间范围无效；视频与音频需要非空区间。",
  invalid_lineage: "来源变换记录无效，请修复后导出。",
  not_accepted: "标注尚未人工确认，已按筛选条件排除。",
  not_observed: "此标注不是原片观察，已按筛选条件排除。",
  invalid_confidence: "置信度值无效。",
  unknown_confidence: "未知置信度无法满足数值门槛。",
  low_confidence: "置信度低于所选门槛。",
  missing_caption: "缺少样本描述，请补充名称或 caption 字段。",
  missing_entity: "标注引用的资产不存在。",
  missing_template: "标注引用的模板不存在。",
  invalid_geometry: "空间标注超出画面范围。",
  ambiguous_lineage: "同内容片段存在多个来源位置，保留最近的明确来源。",
  lineage_padding: "样本进入编码补帧区间，请检查原片覆盖范围。",
  duplicate_window: "多个样本引用相同来源区间，将保持在同一划分。",
  overlapping_window: "此样本与同源样本区间重叠，将保持在同一划分。",
  cross_series_source: "相同来源出现在不同系列标签中，不能视为独立来源。",
  empty_dataset: "没有样本满足当前筛选条件。",
  empty_split: "某个划分没有样本；少量来源分组无法保证各集合都有内容。",
};
export function DataWorkspace({ data, mutate, run, open }: Props) {
  const [query, setQuery] = useState(""),
    [review, setReview] = useState(""),
    [entityId, setEntityId] = useState(""),
    [offset, setOffset] = useState(0);
  const [results, setResults] =
      useState<Awaited<ReturnType<Bridge["discoverAnnotations"]>>>(),
    [searching, setSearching] = useState(false),
    [error, setError] = useState("");
  const [collectionId, setCollectionId] = useState(""),
    [acceptedOnly, setAcceptedOnly] = useState(true),
    [observed, setObserved] = useState(false),
    [confidence, setConfidence] = useState("");
  const [groupBy, setGroupBy] = useState<"source" | "episode" | "entity">(
      "source",
    ),
    [seed, setSeed] = useState("cutbox"),
    [train, setTrain] = useState(80),
    [validation, setValidation] = useState(10),
    [profile, setProfile] = useState<"trimmed" | "full">("trimmed");
  const [report, setReport] = useState<DatasetReport>(),
    [busy, setBusy] = useState(false),
    [subtitleMedia, setSubtitleMedia] = useState(""),
    [subtitleOffset, setSubtitleOffset] = useState(0),
    [notice, setNotice] = useState("");
  const mediaMap = useMemo(
    () => new Map(data.media.map((m) => [m.id, m])),
    [data.media],
  );
  const options: DatasetOptions = {
    collectionId: collectionId || undefined,
    acceptedOnly,
    requireObserved: observed,
    ...(confidence !== "" ? { minConfidence: Number(confidence) } : {}),
  };
  useEffect(() => {
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      window
        .cutbox!.discoverAnnotations({
          text: query,
          reviewState: review,
          entityId,
          offset,
          limit: 30,
        })
        .then((value) => {
          if (live) {
            setResults(value);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(String(e.message || e));
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, review, entityId, offset, data]);
  useEffect(
    () => setReport(undefined),
    [collectionId, acceptedOnly, observed, confidence, data],
  );
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      setReport(await window.cutbox!.inspectDataset(options));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function importSubtitles() {
    if (!subtitleMedia) return;
    setBusy(true);
    setNotice("");
    try {
      await mutate(async () => {
        const result = await window.cutbox!.importSubtitles({
          mediaId: subtitleMedia,
          offset: subtitleOffset,
        });
        if (!result.cancelled)
          setNotice(
            `已导入 ${result.count} 条字幕，均待人工审核。${result.warnings.map((w) => w.message).join(" ")}`,
          );
        return result.snapshot;
      });
    } finally {
      setBusy(false);
    }
  }
  async function exportTraining() {
    setBusy(true);
    try {
      await run(() =>
        window.cutbox!.exportTrainingDataset({
          ...options,
          groupBy,
          seed,
          profile,
          ratios: {
            train: train / 100,
            validation: validation / 100,
            test: (100 - train - validation) / 100,
          },
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="data-workspace">
      <section className="data-panel">
        <div className="section-heading">
          <h2>
            <Search size={19} /> 片段检索
          </h2>
          <span className="muted">按标注、对白、资产与属性检索</span>
        </div>
        <div className="data-filters">
          <label>
            检索内容
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder="例如：白外套 实验室；多个词同时匹配"
            />
          </label>
          <label>
            检索审核状态
            <select
              value={review}
              onChange={(e) => {
                setReview(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">全部</option>
              <option value="accepted">已确认</option>
              <option value="needs_review">待审核</option>
              <option value="suggested">模型建议</option>
            </select>
          </label>
          <label>
            检索资产
            <select
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">全部资产</option>
              {data.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="fine" aria-live="polite">
          {searching ? "正在检索…" : `找到 ${results?.total || 0} 条标注`}
        </p>
        <div className="data-results">
          {results?.items.map((a) => (
            <button key={a.id} onClick={() => open(a.mediaId, a.start)}>
              <strong>{a.label || a.notes || "未命名标注"}</strong>
              <span>
                {mediaMap.get(a.mediaId)?.name} · {time(a.start)}–{time(a.end)}
              </span>
              <small>
                {a.category || "未分类"} ·{" "}
                {a.reviewState === "accepted" ? "已确认" : "待审核"}
              </small>
            </button>
          ))}
        </div>
        <div className="data-pagination">
          <button
            disabled={!offset || searching}
            onClick={() => setOffset(Math.max(0, offset - 30))}
          >
            <ArrowLeft size={15} />
            上一页
          </button>
          <span>每页 30 条 · 第 {Math.floor(offset / 30) + 1} 页</span>
          <button
            disabled={!results?.hasMore || searching}
            onClick={() => setOffset(offset + 30)}
          >
            下一页
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="data-preparation-grid">
        <section className="data-panel">
          <h2>
            <FileText size={19} /> 字幕与标注规范
          </h2>
          <p className="muted">
            导入 SRT / WebVTT 后逐条回到原片审核，统一人物、场景和服装的描述。
          </p>
          <label>
            字幕对应素材
            <select
              value={subtitleMedia}
              onChange={(e) => setSubtitleMedia(e.target.value)}
            >
              <option value="">选择视频或音频</option>
              {data.media
                .filter((m) => m.kind !== "image")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            字幕时间偏移（秒）
            <input
              type="number"
              step="any"
              value={subtitleOffset}
              onChange={(e) => setSubtitleOffset(Number(e.target.value))}
            />
          </label>
          <p className="fine">
            正数向后移动。使用 UTF-8，单次最多 10,000
            条；越界字幕会整批拒绝，不会部分写入。
          </p>
          <button
            disabled={
              busy || !subtitleMedia || !Number.isFinite(subtitleOffset)
            }
            onClick={() => void importSubtitles()}
          >
            <FileText size={16} />
            选择并导入字幕
          </button>
          <hr />
          <h3>影视制作模板</h3>
          <p className="fine">
            添加镜头摄影、服化连续性、场景美术、声音表演及来源使用说明五套模板，可继续编辑。已有同名模板会保留。
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void mutate(() => window.cutbox!.installProductionTemplates())
            }
          >
            <Tags size={16} />
            安装影视制作模板
          </button>
        </section>
        <section className="data-panel">
          <h2>
            <ClipboardCheck size={19} /> 训练数据准备
          </h2>
          <p className="muted">
            按审核状态与任务要求筛选，生成样本清单、数据卡和可复现的划分。
          </p>
          <label>
            准备范围
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              <option value="">全库标注</option>
              {data.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={acceptedOnly}
              onChange={(e) => setAcceptedOnly(e.target.checked)}
            />
            仅使用人工确认标注
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={observed}
              onChange={(e) => setObserved(e.target.checked)}
            />
            仅使用原片观察
          </label>
          <label>
            最低置信度
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              placeholder="不限；设置后排除未知置信度"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            />
          </label>
          <button disabled={busy} onClick={() => void inspect()}>
            <ClipboardCheck size={16} />
            检查数据质量
          </button>
          {report && (
            <div className="dataset-report" aria-live="polite">
              <strong>
                可用 {report.summary.eligible} / {report.summary.total} 条 ·
                排除 {report.summary.excluded} 条
              </strong>
              <p>
                {report.summary.media} 份源素材 · {report.summary.entities}{" "}
                个资产
              </p>
              <details>
                <summary>检查结果（{report.issues.length}）</summary>
                <ul>
                  {report.issues.slice(0, 100).map((issue, i) => (
                    <li key={i}>
                      {issueLabels[issue.code] || issue.message}
                      {issue.annotationId && (
                        <button
                          onClick={() => {
                            const a = data.annotations.find(
                              (a) => a.id === issue.annotationId,
                            );
                            if (a) open(a.mediaId, a.start);
                          }}
                        >
                          查看标注
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {report.issues.length > 100 && (
                  <p>更多结果见导出的质量报告。</p>
                )}
              </details>
              <details>
                <summary>样本预览（前 20 条）</summary>
                {report.samples.slice(0, 20).map((s) => (
                  <p key={s.id}>{s.caption}</p>
                ))}
              </details>
            </div>
          )}
          <div className="data-filters">
            <label>
              划分分组
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              >
                <option value="source">按同源媒体</option>
                <option value="episode">按系列集数</option>
                <option value="entity">按关联资产</option>
              </select>
            </label>
            <label>
              划分种子
              <input value={seed} onChange={(e) => setSeed(e.target.value)} />
            </label>
          </div>
          <div className="data-filters">
            <label>
              训练集 %
              <input
                type="number"
                min="0"
                max="100"
                value={train}
                onChange={(e) => setTrain(Number(e.target.value))}
              />
            </label>
            <label>
              验证集 %
              <input
                type="number"
                min="0"
                max="100"
                value={validation}
                onChange={(e) => setValidation(Number(e.target.value))}
              />
            </label>
            <label>
              测试集 %<input readOnly value={100 - train - validation} />
            </label>
          </div>
          <p className="fine">
            同源媒体及已知派生片段保持同组，避免泄漏。分组较少时某些集合可能为空，实际比例未必等于目标比例。
          </p>
          <label>
            素材保存方式
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as typeof profile)}
            >
              <option value="trimmed">裁剪至所选证据覆盖范围</option>
              <option value="full">完整源素材</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              !report?.summary.eligible ||
              train + validation > 100 ||
              train < 0 ||
              validation < 0 ||
              !seed.trim()
            }
            onClick={() => void exportTraining()}
          >
            <Download size={16} />
            导出训练准备包
          </button>
          <p className="fine">
            明文
            JSONL、媒体、质量报告与数据卡。导出不运行模型训练；任务特定的数据格式与使用范围需自行确认。
          </p>
        </section>
      </div>
    </div>
  );
}
