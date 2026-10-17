import { useState, useEffect } from "react";
import { time } from "./ui";
import type {
  Snapshot,
  AnalysisKind,
  AnalysisResult,
  ModelStatus,
  Bridge,
} from "./types";
export function ToolsWorkspace({
  data,
  mutate,
  run,
  open,
}: {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  open: (id: string, start?: number) => void;
}) {
  const [selected, setSelected] = useState(data.media[0]?.id || "");
  const [kind, setKind] = useState<AnalysisKind>("scenes");
  const [result, setResult] = useState<AnalysisResult>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    Awaited<ReturnType<Bridge["checkMedia"]>>
  >([]);
  const [history, setHistory] =
    useState<Awaited<ReturnType<Bridge["history"]>>>();
  const [models, setModels] = useState<ModelStatus>();
  const [similar, setSimilar] =
    useState<Awaited<ReturnType<Bridge["findSimilar"]>>>();
  const [selection, setSelection] = useState<number[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(10, data.media[0]?.duration || 10));
  const [language, setLanguage] = useState("auto");
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [device, setDevice] = useState("cpu");
  const [error, setError] = useState("");
  const [trackAnnotation, setTrackAnnotation] = useState("");
  const media = data.media.find((m) => m.id === selected);
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void window
      .cutbox!.history()
      .then(setHistory)
      .catch((e) => setError(String(e)));
  }, [data]);
  return (
    <div className="tools-workspace">
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <section>
        <h2>本地分析</h2>
        <div className="toolbar">
          <select
            aria-label="分析素材"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setEnd(
                Math.min(
                  10,
                  data.media.find((m) => m.id === e.target.value)?.duration ||
                    10,
                ),
              );
              setTrackAnnotation("");
              setResult(undefined);
              setSimilar(undefined);
            }}
          >
            {data.media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            aria-label="分析类型"
            value={kind}
            onChange={(e) => setKind(e.target.value as AnalysisKind)}
          >
            {Object.entries({
              scenes: "镜头切分",
              waveform: "音频波形",
              frames: "源帧时间索引",
              transcribe: "对白转录",
              ocr: "文字识别",
              detect: "人体检测",
              track: "对象跟踪",
              pose: "人体姿态",
            }).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !media || (kind === "track" && !trackAnnotation)}
            className="primary"
            onClick={() =>
              void action(async () => {
                const r = await window.cutbox!.analyzeMedia({
                  mediaId: selected,
                  kind,
                  options: {
                    start:
                      kind === "track"
                        ? data.annotations.find((a) => a.id === trackAnnotation)
                            ?.start
                        : start,
                    end:
                      kind === "track"
                        ? data.annotations.find((a) => a.id === trackAnnotation)
                            ?.end
                        : Math.min(end, media!.duration),
                    language,
                    ...(kind === "track"
                      ? {
                          region: data.annotations.find(
                            (a) => a.id === trackAnnotation,
                          )?.region,
                        }
                      : {}),
                  },
                });
                setResult(r);
                setSelection([]);
              })
            }
          >
            开始分析
          </button>
        </div>
        {kind === "track" && (
          <label>
            跟踪起始框
            <select
              value={trackAnnotation}
              onChange={(e) => setTrackAnnotation(e.target.value)}
            >
              <option value="">请选择已有区域标注</option>
              {data.annotations
                .filter((a) => a.mediaId === selected && a.region)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {time(a.start)}–{time(a.end)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="field-pair">
          <label>
            模型分析入点（秒）
            <input
              type="number"
              min="0"
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            模型分析出点（秒）
            <input
              type="number"
              min={start}
              max={media?.duration || undefined}
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="fine">
          仅本地运行。模型不可用时会说明原因；建议须人工审核后保存，不覆盖现有标注。
        </p>
        {result?.peaks && (
          <div className="waveform" aria-label="音频波形">
            {result.peaks.map((peak, i) => (
              <button
                key={i}
                style={{ height: `${Math.max(3, Math.abs(peak) * 100)}%` }}
                title={time(
                  (i / (result.peaks?.length || 1)) * (result.duration || 0),
                )}
                onClick={() =>
                  open(
                    selected,
                    (i / (result.peaks?.length || 1)) * (result.duration || 0),
                  )
                }
              />
            ))}
          </div>
        )}
        {result?.frames && (
          <details>
            <summary>{result.frames.length} 个源帧时间记录</summary>
            <div className="checks">
              {result.frames.map((f) => (
                <button key={f.index} onClick={() => open(selected, f.time)}>
                  帧 {f.index} · {time(f.time)}
                </button>
              ))}
            </div>
          </details>
        )}
        {result?.suggestions && (
          <>
            <div className="toolbar">
              <span>{result.suggestions.length} 条建议</span>
              <button
                onClick={() =>
                  setSelection(result.suggestions!.map((_, i) => i))
                }
              >
                全选
              </button>
              <button
                disabled={!selection.length || busy}
                onClick={() =>
                  void action(async () => {
                    const accepted = result
                      .suggestions!.filter((_, i) => selection.includes(i))
                      .map((a) => ({ ...a, reviewState: "accepted" as const }));
                    if (
                      await mutate(() =>
                        window.cutbox!.saveAnnotations({
                          annotations: accepted,
                        }),
                      )
                    ) {
                      setResult({
                        ...result,
                        suggestions: result.suggestions!.filter(
                          (_, i) => !selection.includes(i),
                        ),
                      });
                      setSelection([]);
                    }
                  })
                }
              >
                接受所选建议
              </button>
            </div>
            {result.suggestions.map((a, i) => (
              <div className="suggestion-row" key={i}>
                <input
                  type="checkbox"
                  aria-label={`选择建议 ${i + 1}`}
                  checked={selection.includes(i)}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? [...selection, i]
                        : selection.filter((n) => n !== i),
                    )
                  }
                />
                <button onClick={() => open(a.mediaId, a.start)}>
                  {a.label} · {time(a.start)}–{time(a.end)}
                </button>
                <small>置信度：{a.confidence==null?'未提供':a.confidence.toFixed(3)} · {a.notes}</small>
              </div>
            ))}
          </>
        )}
      </section>
      <section>
        <h2>相似参考候选</h2>
        <p className="fine">
          比较首帧色彩与构图，只提供候选，不判断角色身份或剧情含义。
        </p>
        <button
          disabled={busy || !media}
          onClick={() =>
            void action(async () =>
              setSimilar(
                await window.cutbox!.findSimilar({
                  mediaId: selected,
                  limit: 12,
                }),
              ),
            )
          }
        >
          查找相似参考
        </button>
        {similar && (
          <>
            <p className="fine">方法：{similar.method}</p>
            {similar.candidates.length === 0 ? (
              <p className="muted">没有可用候选。</p>
            ) : (
              similar.candidates.map((c) => (
                <button
                  className="source-row"
                  key={c.mediaId}
                  onClick={() => open(c.mediaId)}
                >
                  {data.media.find((m) => m.id === c.mediaId)?.name} ·{" "}
                  {(c.score * 100).toFixed(1)}%<small>{c.reason}</small>
                </button>
              ))
            )}
          </>
        )}
      </section>
      <section>
        <h2>源文件与代理</h2>
        <div className="actions">
          <button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setStatus(await window.cutbox!.checkMedia()),
              )
            }
          >
            检查源文件完整性
          </button>
          <button
            disabled={busy || !media || media.kind !== "video"}
            onClick={() =>
              void action(async () => {
                await mutate(() => window.cutbox!.createProxy(selected));
              })
            }
          >
            为所选视频生成代理
          </button>
        </div>
        {status.map((s) => (
          <div className="source-row" key={s.mediaId}>
            <span className="grow">
              {data.media.find((m) => m.id === s.mediaId)?.name}
            </span>
            <span>
              {
                { ok: "已验证", missing: "文件丢失", changed: "内容已改变" }[
                  s.status
                ]
              }
            </span>
            {s.message && <small>{s.message}</small>}
            <button
              onClick={() =>
                void action(async () => {
                  if (await mutate(() => window.cutbox!.relinkMedia(s.mediaId)))
                    setStatus(await window.cutbox!.checkMedia());
                })
              }
            >
              重新定位
            </button>
          </div>
        ))}
      </section>
      <section>
        <h2>本地模型配置</h2>
        <button
          disabled={busy}
          onClick={() =>
            void action(async () =>
              setModels(await window.cutbox!.modelStatus()),
            )
          }
        >
          检测可用模型
        </button>
        {models && (
          <div className="model-list">
            {Object.entries(models).map(([key, s]) => (
              <div key={key}>
                <strong>{key}</strong>
                <span>{s.available ? "可用" : "未就绪"}</span>
                <p>{s.reason || s.model || ""}</p>
                {s.license && <small>{s.license}</small>}
              </div>
            ))}
          </div>
        )}
        <div className="actions">
          {(
            [
              ["pythonPath", "Python 解释器"],
              ["depthModelPath", "深度模型"],
              ["poseModelPath", "姿态模型"],
              ["maskModelPath", "蒙版模型"],
              ["whisperModelPath", "转录模型"],
              ["tesseractPath", "OCR 程序"],
            ] as const
          ).map(([key, label]) => (
            <button
              disabled={busy}
              key={key}
              onClick={() =>
                void action(async () =>
                  setModels(await window.cutbox!.modelConfigure({ key })),
                )
              }
            >
              选择{label}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <label>
            推理设备
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              <option value="cpu">CPU</option>
              <option value="mps">Apple MPS</option>
              <option value="cuda">CUDA</option>
            </select>
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setModels(
                  await window.cutbox!.modelConfigure({
                    key: "device",
                    value: device,
                  }),
                ),
              )
            }
          >
            应用设备
          </button>
          <label>
            OCR 语言
            <input
              value={ocrLanguage}
              onChange={(e) => setOcrLanguage(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setModels(
                  await window.cutbox!.modelConfigure({
                    key: "ocrLanguage",
                    value: ocrLanguage,
                  }),
                ),
              )
            }
          >
            应用 OCR 语言
          </button>
          <label>
            转录语言
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setModels(
                  await window.cutbox!.modelConfigure({
                    key: "language",
                    value: language,
                  }),
                ),
              )
            }
          >
            应用语言
          </button>
        </div>
      </section>
      <section>
        <h2>修订与可靠备份</h2>
        <div className="actions">
          <button
            disabled={!history?.canUndo || busy}
            onClick={() => void mutate(() => window.cutbox!.undo())}
          >
            撤销上次修改
          </button>
          <button
            disabled={!history?.canRedo || busy}
            onClick={() => void mutate(() => window.cutbox!.redo())}
          >
            重做修改
          </button>
          <button
            onClick={() => void run(() => window.cutbox!.backupProject())}
          >
            创建项目备份
          </button>
          <button
            onClick={() => void mutate(() => window.cutbox!.restoreProject())}
          >
            从备份恢复
          </button>
        </div>
        <div className="history-list">
          {history?.entries
            .slice()
            .reverse()
            .map((h) => (
              <div key={h.id}>
                <span>{h.operation}</span>
                <time>{new Date(h.createdAt).toLocaleString()}</time>
                <small>{h.applied ? "已应用" : "已撤销"}</small>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
