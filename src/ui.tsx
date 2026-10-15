import {
  useEffect,
  useRef,
  useContext,
  createContext,
  type ReactNode,
} from "react";
import { Film, Music, Image as ImageIcon, X } from "lucide-react";
import type { Media } from "./types";
export const ErrorContext = createContext("");
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useContext(ErrorContext);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => prior?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
      </div>
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Film size={44} strokeWidth={1.3} />
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Thumb({ media }: { media?: Media }) {
  if (media && (media.thumbnailPath || media.kind === "image"))
    return (
      <img
        loading="lazy"
        src={window.cutbox!.mediaUrl(
          media.id,
          media.kind === "image" ? "source" : "thumbnail",
        )}
        alt={media.name}
      />
    );
  const Icon =
    media?.kind === "audio"
      ? Music
      : media?.kind === "image"
        ? ImageIcon
        : Film;
  return (
    <div className="thumb-placeholder">
      <Icon size={32} strokeWidth={1.2} />
    </div>
  );
}
export function MediaChecks({
  media,
  selected,
  onChange,
}: {
  media: Media[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="checks">
      {media.length === 0 ? (
        <p className="muted">暂无素材，可先创建草稿，再导入参考。</p>
      ) : (
        media.map((m) => (
          <label className="check" key={m.id}>
            <input
              type="checkbox"
              checked={selected.includes(m.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, m.id]
                    : selected.filter((id) => id !== m.id),
                )
              }
            />
            <span>{m.name}</span>
            <small>{m.kind}</small>
          </label>
        ))
      )}
    </div>
  );
}
export const time = (seconds: number) => {
  const n = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(2).padStart(5, "0")}`;
};
