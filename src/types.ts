export interface Media {
  id: string;
  name: string;
  kind: "video" | "audio" | "image";
  path: string;
  sha256: string;
  size: number;
  duration: number;
  width?: number;
  height?: number;
  thumbnailPath?: string;
  createdAt: string;
}
export interface Entity {
  id: string;
  type: "character" | "scene" | "prop" | "sound";
  name: string;
  description: string;
  tags: string[];
  mediaIds: string[];
  coverMediaId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Annotation {
  id: string;
  mediaId: string;
  entityId?: string;
  start: number;
  end: number;
  label: string;
  notes: string;
  reviewState: "suggested" | "accepted" | "needs_review";
  region?: { x: number; y: number; width: number; height: number };
}
export interface Collection {
  id: string;
  name: string;
  description: string;
  mediaIds: string[];
  entityIds: string[];
  annotationIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Snapshot {
  media: Media[];
  entities: Entity[];
  annotations: Annotation[];
  collections: Collection[];
}
export interface Job {
  id: string;
  status: string;
  progress: number;
  label: string;
  error?: string;
  path?: string;
  cancellable?: boolean;
}
export interface Capabilities {
  ffmpeg: boolean;
  ffprobe: boolean;
  clip: boolean;
  edges: boolean;
  depth: { available: boolean; reason: string };
  pose: { available: boolean; reason: string };
  mask: { available: boolean; reason: string };
}
export type EntityInput = Omit<Entity, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};
export type CollectionInput = Omit<
  Collection,
  "id" | "createdAt" | "updatedAt"
> & { id?: string };
export type AnnotationInput = Omit<Annotation, "id"> & { id?: string };
export interface Bridge {
  cancelJob(id: string): Promise<boolean>;
  snapshot(): Promise<Snapshot>;
  importMedia(): Promise<Snapshot>;
  saveEntity(input: EntityInput): Promise<Snapshot>;
  deleteEntity(id: string): Promise<Snapshot>;
  saveAnnotation(input: AnnotationInput): Promise<Snapshot>;
  deleteAnnotation(id: string): Promise<Snapshot>;
  saveCollection(input: CollectionInput): Promise<Snapshot>;
  capabilities(): Promise<Capabilities>;
  exportReference(input: {
    mediaId: string;
    start: number;
    end: number;
    mode: "clip" | "edges";
  }): Promise<{ path?: string; cancelled?: boolean }>;
  exportPackage(input: {
    entityIds?: string[];
    collectionId?: string;
    password: string;
  }): Promise<{ path?: string; cancelled?: boolean }>;
  importPackage(input: { password: string }): Promise<Snapshot>;
  mediaUrl(id: string, kind?: "source" | "thumbnail"): string;
  onJob(callback: (job: Job) => void): () => void;
}
declare global {
  interface Window {
    cutbox?: Bridge;
  }
}
export const entityNames = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  sound: "声音",
};
