"""Render the extension icons (extension/icons/icon{16,32,48,128}.png)."""
from pathlib import Path
from PIL import Image, ImageDraw

RED = (255, 0, 51, 255)
WHITE = (255, 255, 255, 255)
S = 1024  # draw large, downsample for crisp edges
OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"


def render(lines=True):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((64, 64, 960, 960), radius=210, fill=RED)
    # back sheet (outline)
    d.rounded_rectangle((392, 236, 752, 636), radius=56, outline=WHITE, width=60)
    # front sheet: red gap ring, then solid white page
    d.rounded_rectangle((232, 336, 652, 816), radius=86, fill=RED)
    d.rounded_rectangle((272, 376, 612, 776), radius=48, fill=WHITE)
    if lines:  # transcript text lines
        for y, x2 in ((476, 532), (566, 532), (656, 452)):
            d.rounded_rectangle((352, y - 22, x2, y + 22), radius=22, fill=RED)
    return im


OUT.mkdir(exist_ok=True)
big, plain = render(), render(lines=False)
for size in (16, 32, 48, 128):
    src = big if size >= 32 else plain  # text lines turn to mush at 16px
    src.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
