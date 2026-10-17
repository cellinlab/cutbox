import { useRef, useState } from "react";
import type { Snapshot, Collection } from "./types";
import { time } from "./ui";
export function Playlist({
  collection,
  data,
  open,
}: {
  collection: Collection;
  data: Snapshot;
  open: (id: string, start?: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [continuePlaying, setContinuePlaying] = useState(false);
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const annotations = collection.annotationIds.flatMap((id) => {
    const a = data.annotations.find((x) => x.id === id);
    return a ? [a] : [];
  });
  const ids = [
    ...new Set([
      ...collection.mediaIds,
      ...collection.entityIds.flatMap(
        (id) => data.entities.find((e) => e.id === id)?.mediaIds || [],
      ),
    ]),
  ];
  const clips = annotations.length
    ? annotations.map((a) => ({
        media: data.media.find((m) => m.id === a.mediaId),
        start: a.start,
        end: a.end,
        label: a.label,
      }))
    : ids.map((id) => {
        const media = data.media.find((m) => m.id === id);
        return {
          media,
          start: 0,
          end: media?.duration || 0,
          label: media?.name || "",
        };
      });
  const item = clips[index];
  function next() {
    setIndex((n) => Math.min(n + 1, clips.length - 1));
  }
  if (!item?.media) return <p className="muted">集合没有可播放的成员。</p>;
  return (
    <div className="playlist">
      <div className="actions">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
          上一段
        </button>
        <span>
          {index + 1} / {clips.length} · {item.label} · {time(item.start)}–
          {time(item.end)}
        </span>
        <button disabled={index === clips.length - 1} onClick={next}>
          下一段
        </button>
        <button onClick={() => open(item.media!.id, item.start)}>
          回源标注
        </button>
      </div>
      {item.media.kind === "image" ? (
        <img
          className="playlist-image"
          src={window.cutbox!.mediaUrl(item.media.id)}
          alt={item.label}
        />
      ) : item.media.kind === "video" ? (
        <video
          key={`${item.media.id}-${index}`}
          ref={player}
          controls
          src={window.cutbox!.mediaUrl(item.media.id)}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = item.start;
            if (continuePlaying) void e.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= item.end) {
              setContinuePlaying(!e.currentTarget.paused);
              e.currentTarget.pause();
              next();
            }
          }}
          onEnded={next}
        />
      ) : (
        <audio
          key={`${item.media.id}-${index}`}
          ref={player}
          controls
          src={window.cutbox!.mediaUrl(item.media.id)}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = item.start;
            if (continuePlaying) void e.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= item.end) {
              setContinuePlaying(!e.currentTarget.paused);
              e.currentTarget.pause();
              next();
            }
          }}
          onEnded={next}
        />
      )}
    </div>
  );
}
