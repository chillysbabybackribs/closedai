"""Run image-only Granite Docling inference against retained benchmark images.

No native text, OCR output, or reference answers are passed to the model.
Dependencies belong in an isolated environment, not the application package.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import time

os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

import torch
from PIL import Image
from docling_core.types.doc import DoclingDocument
from docling_core.types.doc.document import DocTagsDocument
from huggingface_hub import HfApi
from transformers import AutoModelForVision2Seq, AutoProcessor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--case", action="append", dest="cases")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--max-seconds", type=int, default=240)
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--specialized-crops", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 3 or not 1 <= args.threads <= 8:
        parser.error("repetitions must be 1-3 and threads must be 1-8")
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(args.threads)
    torch.manual_seed(0)
    model_id = "ibm-granite/granite-docling-258M"
    revision = HfApi(token=False).model_info(model_id, revision=args.revision).sha
    print(json.dumps({"loading": model_id, "revision": revision}), flush=True)
    started = time.perf_counter()
    processor = AutoProcessor.from_pretrained(model_id, revision=revision, token=False)
    model = AutoModelForVision2Seq.from_pretrained(
        model_id, revision=revision, token=False,
        torch_dtype=torch.float32, _attn_implementation="sdpa",
    ).to(args.device).eval()
    loaded = time.perf_counter() - started
    report = {
        "model": model_id, "revision": revision,
        "environment": {
            "python": platform.python_version(), "device": args.device,
            "dtype": "float32", "threads": args.threads,
            "packages": {name: importlib.metadata.version(name) for name in
                         ["torch", "transformers", "docling-core", "pillow"]},
        },
        "loadSecondsIncludingDownloads": loaded,
        "generation": {"do_sample": False, "max_new_tokens": 8192,
                       "max_time": args.max_seconds},
        "method": "Image-only; model reused across cases. Timings exclude PDF rendering, "
                  "initial model loading/download, and document export. No reference text.",
        "cases": [],
    }
    paths = sorted(args.evidence.glob("baseline/*.jpg"))
    paths += sorted(args.evidence.glob("column-followup/*.jpg"))
    if args.cases:
        paths = [path for path in paths if path.stem in args.cases]
        missing = set(args.cases) - {path.stem for path in paths}
        if missing:
            raise ValueError(f"Unknown cases: {missing}")
    for path in paths:
        image = Image.open(path).convert("RGB")
        instruction = "Convert this page to docling."
        if args.specialized_crops and path.stem == "equation-crop":
            instruction = "Convert formula to LaTeX."
        elif args.specialized_crops and path.stem == "table-crop":
            instruction = "Convert table to OTSL."
        messages = [{"role": "user", "content": [
            {"type": "image"}, {"type": "text", "text": instruction},
        ]}]
        prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
        for repetition in range(args.repetitions):
            stem = f"{path.stem}-{repetition + 1}"
            row = {
                "id": path.stem, "repetition": repetition + 1,
                "imageSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "imageDimensions": list(image.size), "instruction": instruction,
            }
            started = time.perf_counter()
            try:
                inputs = processor(text=prompt, images=[image], return_tensors="pt").to(args.device)
                if args.device == "cuda":
                    torch.cuda.synchronize()
                    torch.cuda.reset_peak_memory_stats()
                with torch.inference_mode():
                    generated = model.generate(
                        **inputs, max_new_tokens=8192, max_time=args.max_seconds,
                        do_sample=False, use_cache=True,
                    )
                if args.device == "cuda":
                    torch.cuda.synchronize()
                    row["peakCudaAllocatedBytes"] = torch.cuda.max_memory_allocated()
                row["seconds"] = time.perf_counter() - started
                output_ids = generated[:, inputs.input_ids.shape[1]:]
                row["generatedTokens"] = output_ids.shape[1]
                eos = model.generation_config.eos_token_id
                eos = eos if isinstance(eos, list) else [eos]
                row["endedWithEos"] = int(output_ids[0, -1]) in eos
                row["incomplete"] = not row["endedWithEos"]
                doctags = processor.batch_decode(output_ids, skip_special_tokens=False)[0].lstrip()
                (args.output / f"{stem}.doctags").write_text(doctags)
                # Specialized instructions can return a bare formula or OTSL table.
                if args.specialized_crops and path.stem == "equation-crop":
                    (args.output / f"{stem}.md").write_text(doctags)
                else:
                    wrapped = f"<doctag><otsl>{doctags}</otsl></doctag>" if (
                        args.specialized_crops and path.stem == "table-crop" and "<otsl>" not in doctags
                    ) else doctags
                    doc = DoclingDocument.load_from_doctags(
                        DocTagsDocument.from_doctags_and_image_pairs([wrapped], [image]),
                        document_name=path.stem,
                    )
                    doc.save_as_markdown(args.output / f"{stem}.md")
                    doc.save_as_json(args.output / f"{stem}.json")
                    doc.save_as_html(args.output / f"{stem}.html")
            except Exception as error:
                row["error"] = f"{type(error).__name__}: {error}"
                row["seconds"] = time.perf_counter() - started
            report["cases"].append(row)
            (args.output / "results.json").write_text(json.dumps(report, indent=2))
            print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
