import type { Annotation } from "./types";
import { time } from "./ui";
export function Timeline({
  annotations,
  duration,
  current,
  onSelect,
  onSeek,
}: {
  annotations: Annotation[];
  duration: number;
  current: number;
  onSelect: (a: Annotation) => void;
  onSeek: (seconds: number) => void;
}) {
  const lanes = [...new Set(annotations.map((a) => a.category || "general"))];
  return (
    <section className="timeline">
      <div className="timeline-scale">
        <span>00:00</span>
        <input
          aria-label="时间线定位"
          type="range"
          min="0"
          max={duration || 1}
          step="0.001"
          value={current}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <span>{time(duration)}</span>
      </div>
      {lanes.map((lane) => (
        <div className="timeline-lane" key={lane}>
          <span>{lane}</span>
          <div>
            {annotations
              .filter((a) => (a.category || "general") === lane)
              .map((a, i) => (
                <button
                  title={`${a.label} ${time(a.start)}–${time(a.end)}`}
                  aria-label={`时间线 ${a.label}`}
                  key={a.id}
                  onClick={() => {
                    onSelect(a);
                    onSeek(a.start);
                  }}
                  style={{
                    left: `${(a.start / (duration || 1)) * 100}%`,
                    width: `${Math.max(0.5, ((a.end - a.start) / (duration || 1)) * 100)}%`,
                    top: `${(i % 3) * 24}px`,
                  }}
                >
                  {a.label}
                </button>
              ))}
            <i style={{ left: `${(current / (duration || 1)) * 100}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}
