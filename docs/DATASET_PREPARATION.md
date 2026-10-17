# Dataset preparation

CutBox audits annotation quality, assigns deterministic source-disjoint splits, and exports portable training inputs. It does not train a model, measure model performance, infer consent, or guarantee the absence of unrecorded duplicates.

## Audit

`inspectDataset(snapshot, { collectionId?, acceptedOnly=true, minConfidence?, requireObserved=false })` is synchronous and does not mutate the snapshot or access media files. It returns `summary`, `issues`, `samples`, `distribution`, and the effective `filters`.

A selected collection includes its explicitly referenced annotations, annotations of its selected media, and annotations linked to its selected entities. With no collection, all annotations are considered. Eligibility requires usable source metadata, a caption, valid intervals and geometry, and any requested quality filters. Image intervals are `0..0`; audio/video samples need positive duration. Caption preference is `values.caption`, then `text`, then `label`; production notes are not silently treated as captions.

By default, suggested and needs-review annotations are excluded. A confidence threshold excludes both below-threshold and unknown (`null`/missing) confidence; unknown confidence is never interpreted as zero or certainty. `requireObserved` excludes inferred and invented content. Errors exclude the relevant sample. Duplicate or overlapping windows are warnings because distinct annotations can legitimately describe the same moment; those samples remain in the same source group.

The report counts media and entities represented by eligible samples, known source groups, source groups appearing under multiple series names, caption/category/tag distributions, unknown confidence and overlapping windows. Metadata inspection cannot establish whether a local file still exists or is unchanged. Export verifies the actual copied bytes against their recorded SHA-256 and size.

## Splits

`splitDataset(samples, { groupBy='source', seed='cutbox', ratios={train:0.8,validation:0.1,test:0.1} })` returns copied samples with `split` and `splitGroup`, plus counts, options and warnings. Export calls this internally.

- Every mode joins a media hash with its known `sourceAnchor.sha256` ancestors, including same-content copies and imported trims. Known source aliases never cross splits.
- Episode grouping additionally joins samples with the same series/episode pair. An absent episode adds no extra grouping.
- Entity grouping additionally joins every entity linked to a sample's media or annotation, including performer dependencies. A sample referencing two entities connects both groups. This is intentionally conservative and can produce large connected components.

Connected components are hashed with the seed and assigned according to the requested ratios. Assignment is independent of snapshot and sample input order. Ratios are targets, not quotas: small datasets or large connected groups can leave a split empty. The report explicitly records these warnings. Ratios must be finite, nonnegative, contain exactly train/validation/test, and sum to one within floating-point tolerance. A tiny tolerated sum discrepancy is normalized.

Source grouping and temporal coordinates are kept separate. When complete, unambiguous lineage is available, repeated trims resolve to original source coordinates. Identical derived bytes can have multiple possible original locations; in that case temporal anchors retain the nearest unambiguous source and the report warns. Grouping still prevents those known aliases from crossing splits. Unknown duplicates, appearances of an unlinked character, and semantic similarity require separate human review.

## Export

`exportTrainingDataset({ directory, snapshot, collectionId?, acceptedOnly?, minConfidence?, requireObserved?, groupBy?, seed?, ratios?, profile='trimmed', signal?, ffmpegPath?, ffprobePath?, onProgress? })` returns `{ path, directory, sampleCount, splitCounts, report }`.

The output contains:

- `samples.jsonl` and `train.jsonl`, `validation.jsonl`, `test.jsonl`.
- Content-addressed files under `media/` with relative paths.
- `manifest.json`: the selected portable annotation/entity/template/event/relation/story graph.
- `report.json`: audit findings, filters, split settings and assignments.
- `dataset-card.md`: selection, provenance, splitting method and limitations, with rights information for the user to complete.

Production plans and generated-take graphs are deliberately not included. Entity media links are restricted to exported sample media; unrelated covers are dropped to avoid dangling references. Only fully supported event/relation/story dependencies are retained. No source files are modified.

Each JSONL row retains `originalAnnotation`, the portable/rebased `annotation`, relative-path `media`, and `source` coordinates/hash. Original word/keyframe timings survive in `originalAnnotation`; their rebased versions align with the exported clip. Existing source lineage is composed when trimming again instead of being overwritten by the intermediate file's hash.

The `trimmed` profile uses a bounding interval per media file, including retained story intervals. It can contain gaps, unannotated material, and footage outside individual training rows. Consumers must use each row's rebased annotation interval. `full` copies complete source files. The package is entirely plaintext; `.cbox` encryption is a different export workflow.

Exports reject an empty eligible set or existing destination. Work occurs in a sibling staging directory, and publication reserves the destination exclusively before renaming. Cancellation, failed media verification, or encoder errors remove unpublished output. This provides no-overwrite publication, not a backup or a guarantee against hardware failure.

## Verification

`node --test --test-isolation=none tests/dataset-preparation.test.mjs` verifies quality filters, source/episode/entity leakage invariants, transitive aliases, deterministic reordering, 10,000-sample handling, real FFmpeg trimming, original and rebased temporal anchors, relative paths, repeat-trim lineage, no-overwrite behavior, cancellation and changed-file rejection. These checks validate preparation mechanics; they do not establish dataset accuracy or suitability for a particular model.
