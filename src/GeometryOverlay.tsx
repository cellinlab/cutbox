import { useEffect, useRef, useState } from "react";
import type { Point, Region } from "./types";
export function GeometryOverlay({
  sourceWidth,
  sourceHeight,
  tool,
  region,
  polygon,
  keypoints,
  onRegion,
  onPolygon,
}: {
  sourceWidth: number;
  sourceHeight: number;
  tool: "view" | "box" | "polygon";
  region?: Region;
  polygon?: Point[];
  keypoints?: { index: number; x: number; y: number; visibility?: number }[];
  onRegion: (r: Region) => void;
  onPolygon: (p: Point[]) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [bounds, setBounds] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [origin, setOrigin] = useState<Point>();
  const [preview, setPreview] = useState<Region>();
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const resize = () => {
      const width = parent.clientWidth,
        height = parent.clientHeight;
      const scale = Math.min(width / sourceWidth, height / sourceHeight);
      setBounds({
        left: (width - sourceWidth * scale) / 2,
        top: (height - sourceHeight * scale) / 2,
        width: sourceWidth * scale,
        height: sourceHeight * scale,
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    return () => observer.disconnect();
  }, [sourceWidth, sourceHeight]);
  function point(e: React.PointerEvent) {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  }
  const box = preview || region;
  return (
    <svg
      ref={ref}
      className={`geometry-overlay ${tool !== "view" ? "drawing" : ""}`}
      style={bounds}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label="画面标注层"
      onPointerDown={(e) => {
        if (tool === "view") return;
        e.preventDefault();
        const p = point(e);
        if (tool === "polygon") {
          onPolygon([...(polygon || []), p]);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        setOrigin(p);
        setPreview(undefined);
      }}
      onPointerMove={(e) => {
        if (!origin || tool !== "box") return;
        const p = point(e);
        setPreview({
          x: Math.min(origin.x, p.x),
          y: Math.min(origin.y, p.y),
          width: Math.abs(p.x - origin.x),
          height: Math.abs(p.y - origin.y),
        });
      }}
      onPointerUp={(e) => {
        if (origin && tool === "box") {
          const p = point(e);
          const r = {
            x: Math.min(origin.x, p.x),
            y: Math.min(origin.y, p.y),
            width: Math.abs(p.x - origin.x),
            height: Math.abs(p.y - origin.y),
          };
          if (r.width > 0.002 && r.height > 0.002) onRegion(r);
          setOrigin(undefined);
          setPreview(undefined);
        }
      }}
      onPointerCancel={() => {
        setOrigin(undefined);
        setPreview(undefined);
      }}
    >
      {keypoints
        ?.filter((p) => (p.visibility ?? 1) >= 0.3)
        .map((p) => (
          <ellipse
            key={`pose-${p.index}`}
            cx={p.x}
            cy={p.y}
            rx={4 / (bounds.width || 1)}
            ry={4 / (bounds.height || 1)}
          />
        ))}
      {box && (
        <rect x={box.x} y={box.y} width={box.width} height={box.height} />
      )}{" "}
      {polygon && polygon.length > 0 && (
        <>
          <polygon points={polygon.map((p) => `${p.x},${p.y}`).join(" ")} />
          {polygon.map((p, i) => (
            <ellipse
              key={i}
              cx={p.x}
              cy={p.y}
              rx={4 / (bounds.width || 1)}
              ry={4 / (bounds.height || 1)}
            />
          ))}
        </>
      )}
    </svg>
  );
}
