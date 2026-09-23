# Harness variants

Data-only prompt and tool-description overrides for A/B simulation runs. Variants do not fork
the repository.

## Format (`<id>.json`)

```json
{
  "id": "page-preamble-v1",
  "base": "main",
  "overrides": {
    "tools": {
      "embedded_browser.page": { "description": "…" }
    },
    "instructions": { "append": "When reading PDFs, always pass pdf_page." }
  }
}
```

## Run

```sh
npm run harness:model -- --adapter=codex --variant=page-preamble-v1 --task=read_pdf_page_2
npm run harness:compare -- --adapter=golden --variant=main --variant=page-preamble-v1
```

`main` means no variant file (production descriptions).
