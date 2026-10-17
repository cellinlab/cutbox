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
  series?: string;
  episode?: string;
  proxyPath?: string;
  createdAt: string;
}
export interface Entity {
  id: string;
  type: "character" | "scene" | "prop" | "sound" | "actor";
  name: string;
  description: string;
  tags: string[];
  mediaIds: string[];
  coverMediaId?: string;
  attributes?: Record<string, Scalar>;
  actorEntityId?: string;
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
  region?: Region;
  category?: string;
  epistemic?: Epistemic;
  confidence?: number | null;
  tags?: string[];
  templateId?: string;
  values?: Record<string, Scalar>;
  trackId?: string;
  polygon?: Point[];
  words?: { start: number; end: number; text: string; confidence?: number }[];
  keypoints?: {
    index: number;
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  }[];
  keyframes?: { time: number; region: Region }[];
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
  templates: Template[];
  events: StoryEvent[];
  relations: Relation[];
  stories: Story[];
  productions: Production[];
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
  saveProduction(input: Input<Production>): Promise<Snapshot>;
  deleteProduction(id: string): Promise<Snapshot>;
  productionAudit(id: string): Promise<ProductionAudit>;
  draftShotPrompt(input: { productionId: string; shotId: string }): Promise<{prompt: string; negativePrompt: string}>;
  exportProduction(input: { productionId: string; includeClips: boolean; cropRegions?: boolean }): Promise<{path?: string; directory?: string; cancelled?: boolean}>;
  installProductionTemplates(): Promise<Snapshot>;
  importSubtitles(input: {mediaId: string; offset: number}): Promise<{snapshot: Snapshot; count: number; warnings: {code: string; cue?: number; message: string}[]; cancelled?: boolean}>;
  inspectDataset(input: DatasetOptions): Promise<DatasetReport>;
  exportTrainingDataset(input: DatasetOptions & {groupBy: 'source'|'episode'|'entity'; seed: string; ratios: {train: number; validation: number; test: number}; profile: 'full'|'trimmed'}): Promise<{path?: string; directory?: string; sampleCount?: number; cancelled?: boolean}>;
  discoverAnnotations(input: {text?: string; tags?: string[]; mediaId?: string; entityId?: string; category?: string; reviewState?: string; epistemic?: string; series?: string; episode?: string; limit?: number; offset?: number}): Promise<{items: Annotation[]; total: number; limit: number; offset: number; hasMore: boolean; method: string}>;
  cancelJob(id: string): Promise<boolean>;
  jobs(): Promise<Job[]>;
  modelStatus(): Promise<ModelStatus>;
  modelConfigure(input: {
    key:
      | "pythonPath"
      | "depthModelPath"
      | "poseModelPath"
      | "maskModelPath"
      | "whisperModelPath"
      | "tesseractPath"
      | "device"
      | "language"
      | "ocrLanguage";
    value?: string;
  }): Promise<ModelStatus>;
  findSimilar(input: { mediaId: string; limit?: number }): Promise<{
    candidates: { mediaId: string; score: number; reason: string }[];
    unavailable: unknown[];
    method: string;
  }>;
  snapshot(): Promise<Snapshot>;
  saveTemplate(input: Input<Template>): Promise<Snapshot>;
  deleteTemplate(id: string): Promise<Snapshot>;
  saveEvent(input: Input<StoryEvent>): Promise<Snapshot>;
  deleteEvent(id: string): Promise<Snapshot>;
  saveRelation(input: Input<Relation>): Promise<Snapshot>;
  deleteRelation(id: string): Promise<Snapshot>;
  saveStory(input: Input<Story>): Promise<Snapshot>;
  deleteStory(id: string): Promise<Snapshot>;
  updateMedia(input: {
    id: string;
    series?: string;
    episode?: string;
  }): Promise<Snapshot>;
  undo(): Promise<Snapshot>;
  redo(): Promise<Snapshot>;
  history(): Promise<{
    canUndo: boolean;
    canRedo: boolean;
    entries: {
      id: string;
      operation: string;
      createdAt: string;
      applied: boolean;
    }[];
  }>;
  checkMedia(): Promise<
    {
      mediaId: string;
      status: "ok" | "missing" | "changed";
      message?: string;
    }[]
  >;
  relinkMedia(id: string): Promise<Snapshot>;
  createProxy(id: string): Promise<Snapshot>;
  backupProject(): Promise<{ path?: string; cancelled?: boolean }>;
  restoreProject(): Promise<Snapshot>;
  analyzeMedia(input: {
    mediaId: string;
    kind: AnalysisKind;
    options?: Record<string, unknown>;
  }): Promise<AnalysisResult>;
  saveAnnotations(input: { annotations: AnnotationInput[] }): Promise<Snapshot>;
  exportDataset(input: {
    format: "jsonl" | "coco" | "srt";
    collectionId?: string;
    profile: "full" | "trimmed";
  }): Promise<{ path?: string; cancelled?: boolean }>;
  exportStory(input: {
    storyId: string;
    format: "json" | "renpy" | "godot";
  }): Promise<{ path?: string; cancelled?: boolean }>;
  importMedia(): Promise<Snapshot>;
  saveEntity(input: EntityInput): Promise<Snapshot>;
  deleteEntity(id: string): Promise<Snapshot>;
  saveAnnotation(input: AnnotationInput): Promise<Snapshot>;
  deleteAnnotation(id: string): Promise<Snapshot>;
  saveCollection(input: CollectionInput): Promise<Snapshot>;
  capabilities(): Promise<Capabilities>;
  exportReferences(input: {
    annotationIds: string[];
    mode: ReferenceMode;
  }): Promise<{ path?: string; count?: number; cancelled?: boolean }>;
  exportReference(input: {
    mediaId: string;
    start: number;
    end: number;
    mode: ReferenceMode;
    options?: {
      track?: { time: number; region: Region }[];
      crop?: Region;
      width?: number;
      fps?: number;
      edgeLow?: number;
      edgeHigh?: number;
    };
  }): Promise<{ path?: string; cancelled?: boolean }>;
  exportPackage(input: {
    entityIds?: string[];
    profile?: "full" | "trimmed";
    collectionId?: string;
    password: string;
  }): Promise<{ path?: string; cancelled?: boolean }>;
  importPackage(input: { password: string }): Promise<Snapshot>;
  mediaUrl(
    id: string,
    kind?: "source" | "thumbnail" | "proxy" | "original",
  ): string;
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
  actor: "演员",
};

export type Scalar = string | number | boolean;
export interface ProductionTake {
  id: string;
  mediaId: string;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  seed?: string;
  externalTaskId?: string;
  notes: string;
  createdAt: string;
}
export interface ProductionShot {
  id: string;
  name: string;
  description: string;
  duration: number;
  status: 'planned'|'generated'|'selected';
  entityIds: string[];
  annotationIds: string[];
  prompt: string;
  negativePrompt: string;
  continuity: string;
  outputMediaId?: string;
  takes?: ProductionTake[];
}
export interface Production {
  id: string;
  name: string;
  description: string;
  status: 'draft'|'review'|'ready';
  target: 'generic'|'seedance'|'libtv'|'tapnow';
  aspectRatio: '16:9'|'9:16'|'1:1'|'4:3';
  entityIds: string[];
  annotationIds: string[];
  notes: string;
  shots: ProductionShot[];
  createdAt?: string;
  updatedAt?: string;
}
export interface ProductionAudit {
  productionId: string;
  status: 'blocked'|'needs_review'|'ready';
  summary: {shots: number; referenceAnnotations: number; entities: number; readyShots: number; linkedOutputs: number};
  issues: {severity: 'error'|'warning'|'info'; code: string; message: string; shotId?: string; annotationId?: string; entityId?: string}[];
  coverage: {entityId: string; name: string; type: string; referenceCount: number; acceptedCount: number; categories: string[]}[];
}
export interface DatasetOptions {collectionId?: string; acceptedOnly?: boolean; minConfidence?: number; requireObserved?: boolean}
export interface DatasetReport {
  summary: {total: number; eligible: number; excluded: number; media: number; entities: number};
  issues: {code: string; severity: string; annotationId?: string; mediaId?: string; message: string}[];
  samples: {id: string; annotationId: string; mediaId: string; sourceGroup: string; start: number; end: number; caption: string; tags: string[]; entityIds: string[]}[];
  distribution: Record<string, unknown>;
}
export type Epistemic = "observed" | "interpreted" | "invented";
export interface Point {
  x: number;
  y: number;
}
export interface Region extends Point {
  width: number;
  height: number;
}
export type Input<T> = Omit<T, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};
export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  required?: boolean;
  options?: string[];
  unit?: string;
}
export interface Template {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
  createdAt?: string;
  updatedAt?: string;
}
export interface StoryEvent {
  id: string;
  name: string;
  description: string;
  entityIds: string[];
  annotationIds: string[];
  sceneId?: string;
  storyTime?: number;
  epistemic: Epistemic;
  confidence: number | null;
  changes: { entityId: string; key: string; before?: Scalar; after: Scalar }[];
  createdAt?: string;
  updatedAt?: string;
}
export interface Relation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  description: string;
  evidenceAnnotationIds: string[];
  epistemic: Epistemic;
  confidence: number | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface StoryVariable {
  id: string;
  name: string;
  type: "boolean" | "number" | "string";
  initial: Scalar;
}
export interface StoryCondition {
  variable: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
  value: Scalar;
}
export interface StoryEffect {
  variable: string;
  op: "set" | "add";
  value: Scalar;
}
export interface StoryChoice {
  id: string;
  label: string;
  targetId: string;
  conditions: StoryCondition[];
  effects: StoryEffect[];
}
export interface StoryNode {
  id: string;
  title: string;
  body: string;
  kind: "scene" | "clue" | "ending";
  epistemic?: Epistemic;
  mediaId?: string;
  start?: number;
  end?: number;
  eventIds?: string[];
  choices: StoryChoice[];
}
export interface Story {
  id: string;
  name: string;
  description: string;
  variables: StoryVariable[];
  startNodeId: string;
  nodes: StoryNode[];
  createdAt?: string;
  updatedAt?: string;
}

export type ReferenceMode =
  "clip" | "edges" | "crop" | "frame" | "audio" | "depth" | "pose" | "mask";
export type AnalysisKind =
  | "scenes"
  | "waveform"
  | "frames"
  | "transcribe"
  | "ocr"
  | "detect"
  | "track"
  | "pose";
export interface AnalysisResult {
  snapshot?: Snapshot;
  suggestions?: AnnotationInput[];
  cuts?: { time: number; score: number }[];
  peaks?: number[];
  duration?: number;
  sampleRate?: number;
  frames?: { index: number; time: number; duration: number }[];
  [key: string]: unknown;
}

export type ModelStatus = Record<
  | "python"
  | "depth"
  | "pose"
  | "mask"
  | "transcription"
  | "ocr"
  | "tracking"
  | "detection",
  { available: boolean; reason?: string; model?: string; license?: string }
>;
