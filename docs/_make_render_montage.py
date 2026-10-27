from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src = Path(__file__).resolve().parent / "rendered-illustrated-v2"
files = sorted(src.glob("page-*.png"))
font = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 20)
cell_w, cell_h, cols = 300, 440, 5
rows = (len(files) + cols - 1) // cols
out = Image.new("RGB", (cell_w * cols, cell_h * rows), "#DCE9E5")
draw = ImageDraw.Draw(out)
for i, path in enumerate(files):
    im = Image.open(path).convert("RGB")
    im.thumbnail((cell_w - 20, cell_h - 42), Image.Resampling.LANCZOS)
    x0 = (i % cols) * cell_w
    y0 = (i // cols) * cell_h
    x = x0 + (cell_w - im.width) // 2
    y = y0 + 32
    out.paste(im, (x, y))
    draw.text((x0 + 8, y0 + 5), f"第 {i+1} 页", fill="#173B34", font=font)
out.save(src / "_montage.png", quality=92)
print(src / "_montage.png")
