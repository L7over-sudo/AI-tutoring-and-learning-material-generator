from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "screenshots"
OUT = ROOT / "figures"
OUT.mkdir(parents=True, exist_ok=True)

FONT_PATH = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD_PATH = Path(r"C:\Windows\Fonts\msyhbd.ttc")

STEPS = {
    "00-activation-client.png": ["粘贴激活码", "点击立即激活", "查看剩余时间"],
    "01-main.png": ["选择功能入口", "设置参数", "开始处理", "预览并导出"],
    "02-import-images.png": ["选择图片或文件夹", "核对素材", "上传"],
    "03-text-image.png": ["填写主题", "上传参考图", "生成任务"],
    "04-doc-images.png": ["上传文档", "选择输出规格", "开始转换"],
    "05-doc-ppt.png": ["上传文档", "设置版式", "生成并导出 PPT"],
    "06-convert.png": ["选择文件", "选择转换方式", "下载结果"],
    "07-word-split.png": ["上传 Word", "设置分段长度", "拆分并下载"],
    "08-pdf-sort.png": ["上传 PDF", "设置顺序", "生成新 PDF"],
    "09-pdf-watermark.png": ["上传 PDF", "设置水印", "预览并下载"],
    "10-image-watermark.png": ["选择图片", "设置水印样式", "批量下载"],
    "11-markdown.png": ["导入或输入", "编辑与预览", "导出文件"],
    "12-html.png": ["编辑代码", "实时预览", "导出 HTML"],
    "13-storyboard.png": ["输入文案", "拆分分镜", "生成画面"],
    "14-stitch.png": ["选择图片", "排列与设置", "拼接下载"],
    "15-xhs-parse.png": ["粘贴公开链接", "开始解析", "保存素材"],
    "16-api-settings.png": ["选择平台", "填写密钥", "测试并保存"],
    "17-prompt-templates.png": ["新建模板", "编辑内容", "保存并应用"],
}

CROPS = {
    "00-activation-client.png": (0, 0, 850, 540),
    # These two tools use a full-page overlay; crop the unused right/bottom area
    # so the controls remain legible in the printed manual.
    "13-storyboard.png": (0, 0, 860, 520),
    "15-xhs-parse.png": (0, 0, 860, 500),
}

EXTERNAL = {
    "18-license-admin.png": (
        Path(r"C:\Users\Jay\AppData\Local\Temp\codex-clipboard-f9619ab9-08ec-4297-be05-61bc115d866a.png"),
        ["选择卡型", "一键生成", "复制给客户"],
    ),
    "19-activation-records.png": (
        Path(r"C:\Users\Jay\AppData\Local\Temp\codex-clipboard-7c4faaf0-90a6-40a0-b748-6dc626e29774.png"),
        ["搜索筛选", "查看有效期", "复制或删除记录"],
    ),
}


def font(size: int, bold: bool = False):
    path = FONT_BOLD_PATH if bold and FONT_BOLD_PATH.exists() else FONT_PATH
    return ImageFont.truetype(str(path), size=size)


def fit_canvas(img: Image.Image, width: int = 1280, height: int = 720) -> Image.Image:
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "white")
    x = (width - img.width) // 2
    y = (height - img.height) // 2
    canvas.paste(img, (x, y))
    return canvas


def annotated(img: Image.Image, labels: list[str]) -> Image.Image:
    canvas = fit_canvas(img)
    band_h = 72
    out = Image.new("RGB", (canvas.width, canvas.height + band_h), "white")
    out.paste(canvas, (0, 0))
    draw = ImageDraw.Draw(out)
    draw.rectangle((0, canvas.height, canvas.width, out.height), fill="#F2F8F6")
    draw.line((0, canvas.height, canvas.width, canvas.height), fill="#C7DDD6", width=2)

    gap = 22
    badge = 34
    label_font = font(20, bold=True)
    number_font = font(19, bold=True)
    widths = []
    for text in labels:
        box = draw.textbbox((0, 0), text, font=label_font)
        widths.append(badge + 10 + box[2] - box[0])
    total = sum(widths) + gap * (len(labels) - 1)
    x = max(20, (canvas.width - total) // 2)
    cy = canvas.height + band_h // 2
    for i, (text, item_w) in enumerate(zip(labels, widths), 1):
        draw.ellipse((x, cy - badge // 2, x + badge, cy + badge // 2), fill="#E84B4B")
        nb = draw.textbbox((0, 0), str(i), font=number_font)
        draw.text((x + (badge - (nb[2]-nb[0]))/2, cy - (nb[3]-nb[1])/2 - 2), str(i), fill="white", font=number_font)
        draw.text((x + badge + 10, cy - 15), text, fill="#163A33", font=label_font)
        x += item_w + gap
    return out


for name, labels in STEPS.items():
    image = Image.open(SRC / name)
    if name in CROPS:
        image = image.crop(CROPS[name])
    if name == "00-activation-client.png":
        # Browser preview lacks Electron's local bridge. Replace that preview-only
        # error line with the real action hint shown in the packaged client.
        image = image.convert("RGB")
        d = ImageDraw.Draw(image)
        d.rounded_rectangle((255, 75, 625, 108), radius=6, fill="white")
        d.text((263, 80), "输入激活码后点击“立即激活”", fill="#63706D", font=font(18))
    annotated(image, labels).save(OUT / name, quality=94)

for name, (source, labels) in EXTERNAL.items():
    image = Image.open(source)
    annotated(image, labels).save(OUT / name, quality=94)


# A compact contact sheet for visual QA.
thumb_w, thumb_h = 420, 270
files = sorted(OUT.glob("*.png"))
rows = (len(files) + 2) // 3
sheet = Image.new("RGB", (thumb_w * 3, thumb_h * rows), "#E9F1EF")
for idx, path in enumerate(files):
    im = Image.open(path).convert("RGB")
    im.thumbnail((thumb_w - 16, thumb_h - 34), Image.Resampling.LANCZOS)
    x = (idx % 3) * thumb_w + (thumb_w - im.width) // 2
    y = (idx // 3) * thumb_h + 28
    sheet.paste(im, (x, y))
    ImageDraw.Draw(sheet).text(((idx % 3) * thumb_w + 8, (idx // 3) * thumb_h + 3), path.name, fill="#173A34", font=font(16, bold=True))
sheet.save(OUT / "_contact-sheet.png", quality=90)

print(f"Prepared {len(files)} annotated screenshots in {OUT}")
