#!/usr/bin/env python3
"""生成 Chrome 扩展图标：渐变背景 + 白色"译"字。"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SIZES = [16, 48, 128]

def font(size: int) -> ImageFont.FreeTypeFont:
    # 尝试加载系统中文字体
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=int(size * 0.62))
    return ImageFont.load_default()

def make_icon(size: int) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # 圆角矩形背景（线性渐变用两层绘制近似）
    for y in range(size):
        ratio = y / max(size - 1, 1)
        r = int(37 + (124 - 37) * ratio)
        g = int(99 + (58 - 99) * ratio)
        b = int(235 + (237 - 235) * ratio)
        for x in range(size):
            img.putpixel((x, y), (r, g, b, 255))
    # 圆角：用 mask 切掉四角
    radius = max(2, size // 6)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rounded.paste(img, (0, 0), mask)
    img = rounded

    draw = ImageDraw.Draw(img)
    text = "译"
    f = font(size)
    # 计算居中位置
    bbox = draw.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1] - max(0, size // 32)
    draw.text((x, y), text, font=f, fill=(255, 255, 255, 255))

    out = OUT / f"icon{size}.png"
    img.save(out, "PNG")
    print(f"  -> {out}")

def main() -> None:
    print(f"生成图标到: {OUT}")
    for s in SIZES:
        make_icon(s)
    print("Done")

if __name__ == "__main__":
    main()