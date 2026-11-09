"""Extract fine brushed detail without baking the source photograph's reflections."""
import argparse
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("--output", type=Path, default=Path("public/textures/steel-brushed-detail.webp"))
args = parser.parse_args()
with Image.open(args.source) as source:
    height = round(source.height * 1024 / source.width)
    gray = source.convert("L").resize((1024, height), Image.Resampling.LANCZOS)
    # Broad vertical light bands are removed; horizontal micro-grooves remain.
    detail = ImageChops.subtract(gray, gray.filter(ImageFilter.GaussianBlur(10)), scale=1, offset=128)
    detail = detail.point(lambda value: max(88, min(168, 128 + (value - 128) * 2)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    detail.convert("RGB").save(args.output, "WEBP", lossless=True, method=6)
    print(f"{args.output}: 1024x{height}, {args.output.stat().st_size} bytes")
