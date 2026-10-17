# CutBox 0.2 expansion contract

This is an implementation contract, not proof of delivery. Each capability needs a real operation, failure handling and validation evidence. Existing 0.1 projects must migrate without data loss. No shell evaluation, user-script evaluation or placeholder model outputs.

## Shared domain

Snapshot keeps `media`, `entities`, `annotations`, `collections` and adds arrays `templates`, `events`, `relations`, `stories`. Missing new arrays in old imports mean empty. UUID semantic IDs remap on import; all references validate transactionally. `revisions` is a separate query, not embedded in export snapshots.

- Media adds optional `series`, `episode`, `proxyPath`; updateMedia({id,series?,episode?,path?,proxyPath?}) is backend-only for paths. Relink requires original SHA256/size; proxy never changes source identity.
- Entity adds `attributes: Record<string,string|number|boolean>` and optional `actorEntityId` (character); actor entity kind allowed. Keep existing four kinds and optional actor support. Relationships otherwise use relations.
- Template: {id,name,description,fields:[{key,label,type:'text'|'number'|'boolean'|'select',required?,options?:string[],unit?}],createdAt,updatedAt}. Keys bounded safe identifiers; no prototype keys; validate typed values. Do not silently invalidate existing annotations on template edit.
- Annotation adds category:string(default 'general'), epistemic:'observed'|'interpreted'|'invented'(default observed), confidence:number 0..1, tags:string[], templateId?, values:Record<string,scalar>, trackId?:string, polygon?:[{x,y}], keyframes?:[{time,region:{x,y,width,height}}]. Existing region stays. Time anchors within media, geometry normalized. Keyframes ordered unique, within annotation range. Human observations distinct from model suggestions.
- Event: {id,name,description,entityIds:string[],annotationIds:string[],sceneId?,storyTime?:number,epistemic,confidence,changes:[{entityId,key,before?:scalar,after:scalar}],createdAt,updatedAt}. storyTime is ordering within story, not source seconds.
- Relation: {id,fromEntityId,toEntityId,type,description,evidenceAnnotationIds:string[],epistemic,confidence,createdAt,updatedAt}. Examples: knows, owns, ally, located_in, causes (entity links only); event causes are represented via story graph for now.
- Story schema owned by desktop/story.mjs + src/StoryWorkspace.tsx, see below. Domain calls exported validateStory(story,snapshot) before saving. New story records managed by saveStory/deleteStory. Domain import remaps story media/event IDs.

Domain methods: existing CRUD plus saveTemplate/deleteTemplate,saveEvent/deleteEvent,saveRelation/deleteRelation,saveStory/deleteStory,updateMedia,undo,redo,history,replaceSnapshot. CRUD and undo/redo return records at domain layer, bridge always returns Snapshot. replaceSnapshot restores validated full IDs (backup use); importSnapshot merges with new IDs. Persist bounded undo/redo/revision history across restart. Delete rejects dependencies or explicitly cleans them consistently; no dangling refs.

## Story contract

{id,name,description,variables:[{id,name,type:'boolean'|'number'|'string',initial:scalar}],startNodeId,nodes:[{id,title,body,kind:'scene'|'clue'|'ending',epistemic?:'observed'|'interpreted'|'invented',mediaId?,start?,end?,eventIds?:string[],choices:[{id,label,targetId,conditions:[{variable,operator:'eq'|'ne'|'gt'|'gte'|'lt'|'lte',value:scalar}],effects:[{variable,op:'set'|'add',value:scalar}]}]}],createdAt?,updatedAt?}.

Use pure engine; no eval. Node entry does not mutate state implicitly. Choices apply all effects atomically then navigate; detect unreachable nodes, dangling targets, non-ending dead ends and potential cycles; cycles are permitted and preview step limit prevents runaway. Simulations are disposable and never overwrite canonical observations.

## Main integration

Root owns desktop/main.mjs, backend-worker.mjs, preload.cjs. Other agents expose pure/service APIs and send signatures. Frontend owns src/types.ts and all existing renderer files. Story agent owns only new StoryWorkspace.tsx, story.css and story engine/tests. Package agent owns packages.mjs and portable exports module/tests. Models agent owns models.mjs + Python worker/requirements/docs/tests. Media agent owns media.mjs + media-tools.mjs/tests. Domain agent owns domain.mjs/tests.

Root exposes IPC: all domain CRUD, undo/redo/history; relinkMedia(id), checkMedia(), createProxy(id), backupProject(), restoreProject(), analyzeMedia({mediaId,kind,options?}), exportReference({mediaId,start,end,mode,options?}), exportDataset({format,collectionId?,options?}), modelStatus(), modelConfigure(...), story exports. Native dialogs choose paths; renderer never supplies filesystem output paths. Long work cancellable and reported as jobs. Signal/timeout propagates to subprocesses; failed jobs never publish partial output.

## Full capability acceptance map

1. Templates + typed attributes; observed/inferred/invented and confidence; revisions + undo.
2. Entities across episodes, relationships, events and state changes with evidence.
3. Direct box/polygon drawing, keyframe tracks, multi-lane timeline, loop, keyboard controls.
4. Source relink, proxies, verified backups/restore, missing-source detection.
5. Real shot cuts, waveform, transcription/OCR/detection/tracking suggestions through available local tools/models.
6. Reference clip/edges/crop/frame/audio/depth/pose/mask outputs, settings and batch tasks. Machine-learning output only if real model installed; missing dependencies must remain explicit, never simulated.
7. Structured conjunctive search and similar-reference candidates with human review; playlists/collections.
8. Full/trimmed export profiles and portable annotation/task formats; encrypted graph roundtrip.
9. Story events/relationships view; typed branching editor, playable preview, validation and external engine exchange.
