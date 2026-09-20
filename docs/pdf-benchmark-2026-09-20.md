# PDF extraction and OCR benchmark — 2026-09-20

## Decision

Prioritize **column-aware region selection and reading order**. Keep native extraction first,
inspect the page, and OCR selected regions where native text is missing or suspect. The existing
crop tool already addresses part of the observed problem. These findings do not justify replacing
the OCR engine yet. Structured table extraction is the next separate capability to evaluate;
equations still require image inspection or a dedicated math recognizer.

This is a small diagnostic benchmark: eight cases across four public PDFs and one synthetic
mixed-content PDF. It is not an estimate of accuracy across arbitrary documents. No application
behavior, tool contract, or model instructions changed during this benchmark.

## Results

Times below are medians of three executions, in seconds. Page render uses 144 DPI; OCR uses
216 DPI subject to the existing 2400-pixel edge cap. Native text in a page result always covers
the whole page, including when the image or OCR is cropped.

| Case | Native extraction / manual observation | OCR observation | Render | OCR |
|---|---|---|---:|---:|
| Illustrated historical book, page 1 | No native text | All 3 short probes found, but illustration becomes substantial garbage text | 0.582 | 4.456 |
| Same book, bottom paragraph crop | No native text | 2 word substitutions in 138 reference words: 1.45% normalized WER | 0.428 | 2.067 |
| Skewed brochure, page 1 | No native text | 4/5 probes; second title line omitted; columns interleaved despite confidence 92 | 0.597 | 7.475 |
| Same brochure, left column crop | No native text | Left-column sentence sequence recovered; minor recognition errors and edge artifacts remain | 0.626 | 2.482 |
| Mixed native/scanned fixture, page 1 | Native label present; 3 scanned words absent; `pagesWithoutText=0` | All 5 words recovered in order, normalized WER 0% | 0.275 | 1.162 |
| Two-column ACL paper, page 2 | All 5 body anchors in expected column order | Anchors present but wrong order; figure/caption and both columns interleaved | 0.473 | 7.431 |
| Attention paper, Table 2 on page 8 | All 17 BLEU values present; empty cells and merged column scope not encoded in text | 15/17 values found; decimal and exponent corruption; no faithful table structure | 0.365 | 1.794 |
| Attention paper, equation 1 on page 4 | Symbols present as flat text; fraction/superscript/subscript relations not encoded | Square root/denominator corrupted; no reliable mathematical expression | 0.511 | 1.046 |

### What the visual checks established

All eight PDF.js page/crop images were inspected. Poppler images provided an independent reference
for the historical scan, brochure, and attention-paper pages 4 and 8. The native and OCR outputs
were compared with those images, not treated as their own reference answers.

- **Historical scan:** paragraph OCR confused the first capital I with digit 1 and the word
  `box` with `hox`. Quote punctuation is excluded from normalized WER. The full-page OCR also
  tries to interpret the illustration as characters. The crop reduces irrelevant content; it
  does not eliminate the two word errors.
- **Brochure:** OCR omits the second title line and reads horizontally across the two text
  columns. The single-column crop removes that interleaving and takes about one-third as long,
  because it processes less of the page. It still has isolated character errors and a few
  right-edge artifacts; this is not a perfect transcription.
- **Mixed content:** successful native extraction does not establish page completeness. The
  fixture deliberately includes both a native label and a raster phrase. OCR retrieves both.
- **Table:** OCR turns 23.75 into 23775 and 24.6 into 26. Scientific-notation exponents are
  also damaged. Native text preserves those BLEU values, but flattened rows do not encode
  which blanks belong to which column or which cost cells span both language columns.
- **Equation:** the rendered equation is legible. Native text contains the symbols but loses
  explicit mathematical relationships. OCR loses important symbols. Neither text path supplies
  a validated equation representation.
- **Two-column paper:** the native body anchors preserve the sampled left-then-right order.
  OCR mixes figure labels and right-column text into the left column. Five anchor checks do
  not establish complete page reading order.

The brochure's capacity number was initially transcribed incorrectly into the benchmark.
A higher-resolution Poppler crop confirmed **110,000**, which OCR had correctly recognized.
The reference and scores were corrected; that apparent numeric error is not an OCR failure.
Reference-anchor and quote-normalization corrections were applied by rescoring retained outputs,
without changing the measured worker timings.

## Measurement and reproducibility

Measured on Linux x64, AMD Ryzen 5 3550H, Electron 44.1.1 / Node 24.19.0; PDF.js 6.3.289,
Tesseract.js 7.0.0 with bundled English data, engine version 5.1.0-288-g2a9c1. Baseline began
2026-09-20 at 22:51:26 UTC. Each execution uses a fresh disposable worker, with the application's
256 MiB V8 limit and a 60-second deadline. The workers are bundled from current source by the
benchmark; the running application does not need rebuilding or restarting.

Times include worker startup, local parsing/rendering, and OCR initialization where applicable.
They exclude source download, bundling, app queues, tool serialization, model inspection, and
cache hits. OS filesystem caches may be warm. This is not an end-to-end latency or memory test.
All repeated page/OCR payloads were identical within their case. Confidence values are the OCR
engine's scores, not measured correctness probabilities. All renders reported
`renderIncomplete=false`; the OCR and structure errors above still occurred.

Whole-document native extraction medians were 0.178 s for the book (1 page), 0.173 s for the
brochure (1 page), 0.653 s for the attention paper (15 pages), 0.568 s for the ACL paper (17 pages),
and 0.243 s for the mixed fixture (1 page). These are a different unit of work from page OCR.

The baseline contains seven cases; the single-column follow-up adds the eighth. The reusable
runner now includes all eight by default:

```sh
node scripts/pdf-benchmark/run.mjs /tmp/closedai-pdf-benchmark-results 3
node scripts/pdf-benchmark/run.mjs /tmp/closedai-pdf-column 3 --case=skew-left-column
node scripts/pdf-benchmark/run.mjs /tmp/closedai-pdf-benchmark-results 3 --rescore
```

The runner validates downloaded bytes against pinned SHA-256 values before measurement. A changed
remote document fails rather than silently using old ground truth. Existing local source files are
reused only after hash validation. PDFs and extracted text are kept in the specified output directory;
temporary worker bundles are removed. Source links, hashes, raw timings, effective DPI, repeated-output
checks, and scores are recorded in `results.json`; per-case files contain native items and OCR word boxes.

Ground truth and region coordinates are in [cases.mjs](../scripts/pdf-benchmark/cases.mjs).
Word scoring normalizes case, Unicode compatibility forms, quote glyphs, whitespace, and punctuation;
apostrophes inside words remain. WER is word-level edit distance divided by reference word count.
Only the book paragraph and synthetic mixed page have complete region transcriptions. Probes are
exact normalized phrase-presence checks, not full-document accuracy. Table numeric probes assess
value presence, not row/column association. Structure judgments are manual.

Local evidence saved for this run (ignored by Git):

- [Baseline results](../.read/pdf-benchmark-2026-09-20/baseline/results.json)
- [Column follow-up results](../.read/pdf-benchmark-2026-09-20/column-followup/results.json)

The harness is [run.mjs](../scripts/pdf-benchmark/run.mjs). It completed all eight cases with
three repetitions per operation. No new application unit tests were needed; the changed executable
is the benchmark itself. Typecheck, hygiene, and generated-index checks are the repository checks.

## Sources and limits

- [OCRmyPDF corpus description](https://github.com/ocrmypdf/OCRmyPDF/blob/64d999aea85a672b51d83747f0b567907d7b38bd/tests/resources/README.rst):
  `c03-29.pdf` is a Project Gutenberg scan of Huckleberry Finn page 29;
  `skew.pdf` is a brochure scan with simulated skew. These are different source documents, but
  two cases within either document are not independent samples. Corpus resources have individual
  licensing; see [REUSE.toml](https://github.com/ocrmypdf/OCRmyPDF/blob/64d999aea85a672b51d83747f0b567907d7b38bd/REUSE.toml).
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9.pdf), page 2, for column order and figure placement.
- [Attention Is All You Need](https://arxiv.org/pdf/1706.03762), pages 4 and 8, for equation and table structure.
- Mixed-content PDF uses the repository's existing synthetic fixture generator. It proves that
  specific native-plus-raster case, not performance on real mixed-content documents.

No multilingual OCR, handwriting, camera photos, large-document memory, cancellation stress,
or engine/model comparison was measured. Recognition accuracy and latency on this small set
must not be generalized to a production workload. No document-wide fidelity claim follows.

## Recommended next implementation scope

1. Evaluate retaining OCR block/paragraph/line grouping and exposing explicit reading-order
   information. The worker currently flattens those structures to words. Compare that approach
   with column-region OCR on this corpus before choosing an implementation; grouping alone
   may preserve an already incorrect segmentation.
2. Keep native PDF geometry and build a separate table evaluation around row/column assignment,
   empty cells, merged cells, and superscripts. Native text was more reliable than OCR for the
   sampled table values, but neither output is a structured table.
3. Keep equation images available and report math extraction as unresolved. Test a dedicated
   math path only when mathematical transcription becomes a required task.

These are recommendations from measured cases, not authorization or instructions embedded in
source material, and not claims that those future features are implemented.
