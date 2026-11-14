# Extracted content contract (schemaVersion 3)

The scraper preserves raw Persian content. It is independent of the current
Dentora database and has no Prisma/Supabase credentials or write operations.

## Hierarchy and stable identity

`catalog.json`: specialty key/name → chapter IDs/positions/titles → lesson
IDs/positions/titles and their actually rendered usable URLs. Chapters remain in
DOM order; lesson IDs are never guessed or generated for locked paths.

`lesson.json`: specialty/chapter/lesson metadata, sourceUrl, timestamps, runId,
status, `steps`, `visits`, optional expected counts, completion and validation.

Each step has its contiguous `position`, `kind`, source question/step identity,
source progress, prompt, ordered content, ordered options and answer evidence.
The first encounter defines the question position. Repeated questions append a
visit without duplicating the question. Changed prompts/options for one question
ID cause an incomplete result. Repeated theory with no distinguishable source
position is treated as ambiguous rather than silently dropped.

The ordered content tree uses `{tag, text?, attributes?, children?, src?, alt?,
assetPath?, assetError?}`. Do not sort children or image nodes. Inline emphasis,
lists, tables, rows/cells, captions and images keep their original nesting. Only
an allowlist of attributes is copied; JS, forms and app state are excluded.
`assetPath` is relative to `specialty-HASH`, e.g. `assets/SHA256.webp`.

Options have source key, visible position, text and a content tree. A source key
is not necessarily the same as a stored index. `answer.correctOptionKeys` refers
to the keys in `answer.options` for that observed feedback, **not** necessarily
the keys in the question's original first encounter. When importing use
`correctOptionHashes` to match option content, and verify against the text/tree.
Never join answers to options by array index. Hashing excludes download paths.

`answer` keeps `observed-single-key` / `unverified` / `conflict`, observed correct
keys/content hashes/texts, explanation, ordered feedback content and timestamp.
An option that is unmarked is unknown unless the single-choice key is verified.
The raw correctMarked/wrongMarked/selected flags are evidence, not a clinical
claim. Single-choice completeness does not imply scientific correctness.

## Transfer to Dentora later

1. Use lesson ID and source URL as provenance; translate Persian text separately.
2. Convert theory steps to LessonBlock records in source order.
3. Convert questions/options to the appropriate Question/AnswerOption type only
   once the source type and correct-key evidence are verified.
4. Retain source step order explicitly. The current Dentora player puts all
   blocks before questions; mixed/interleaved source lessons need a reviewed
   player/schema adaptation before import. This export does not silently reorder
   interleaved steps to fit that limitation.
5. Import into DRAFT for scientific review. No source answer is auto-corrected.
6. Compare source counts and inspect preview.html before release.

A real screenshot-faithful UI clone is outside extraction. This package preserves
content structure and ordering; preview.html is a content inspection view.

## Credentials and diagnostics

The persistent `.session` directory is private. No snapshots, CSRF values,
request/response bodies or whole-page HTML are exported. diagnostic.json is only
the sanitized lesson content frame. No screenshots are captured automatically.
Asset source URLs are retained as provenance and may be session-bound; keep raw
exports private if the source uses signed URLs, and use local images for transfer.

## Known bounds

Automatic traversal is verified by DOM fixtures, not across all live lessons.
Unknown question types stop automatic mode; manual mode may continue with
unverified evidence and needs-review status. Hints requiring payment/points,
chapter-guide dialogs, CSS backgrounds, video, canvas and arbitrary widgets are
not captured by this adapter. Image requests have a declared length check and
post-download byte limit; the request library buffers response bytes.


## Version 3.4 additive letter-order fields

SchemaVersion remains 3 for checkpoint compatibility. New questionType `letter-order` includes `jumble` with indexed tiles, slotCount and observed slot state. A source-verified letter answer has status `observed-text`, `correctText` and `textEvidence`. Choice key arrays are empty for this type. Consumers must support both verified statuses and must not treat provisional AI text as verified.
