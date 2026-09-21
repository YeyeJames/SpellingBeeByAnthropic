#!/usr/bin/env python3
"""
把生成的敵人圖去背。

為什麼需要這支：圖片生成模型幾乎不會給真正的透明背景，回來的是
「深色背景 + 紅藍輝光」。直接貼進遊戲會在敵人周圍留一塊深色方塊，
而戰場的地面帶比它亮，方塊會很明顯。

做法不是「把暗的挖掉」——蟲的身體本身就是近黑色，那樣會把身體一起挖掉。
改成：
  1. 先抓出「明顯是蟲」的亮部（紅色描邊、黃色條紋、藍色翅膀、琥珀色眼睛）
  2. 從畫面邊緣往內做泛洪填滿，淹得到的暗部才是背景
  3. 淹不到的暗部就是「被描邊包起來的身體」，補回來
這樣身體留得住，輝光去得掉。

用法：python3 tools/cutout.py 來源.png 輸出.png [--value 明度門檻]
"""
import sys
from collections import deque
import numpy as np
from PIL import Image, ImageFilter


def cutout(src_path, out_path, value_thresh=0.42, feather=1.2, margin=8):
    im = Image.open(src_path).convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255.0
    h, w, _ = a.shape

    # 明度：亮部才可能是描邊／條紋／翅膀，輝光是暗的
    v = a.max(axis=2)
    bright = v >= value_thresh

    # 從四個邊往內淹，淹得到的「非亮部」就是背景
    reach = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not bright[y, x] and not reach[y, x]:
                reach[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not bright[y, x] and not reach[y, x]:
                reach[y, x] = True
                dq.append((y, x))

    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not reach[ny, nx] and not bright[ny, nx]:
                reach[ny, nx] = True
                dq.append((ny, nx))

    # 蟲 = 亮部 + 被亮部包起來的暗部（也就是身體）
    creature = bright | (~reach)

    alpha = Image.fromarray((creature * 255).astype(np.uint8), 'L')
    # 稍微羽化，縮小之後邊緣才不會有鋸齒
    alpha = alpha.filter(ImageFilter.GaussianBlur(feather))

    out = im.convert('RGBA')
    out.putalpha(alpha)

    # 裁到實際內容，四周留一點邊
    bbox = alpha.point(lambda p: 255 if p > 8 else 0).getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - margin); y0 = max(0, y0 - margin)
        x1 = min(w, x1 + margin); y1 = min(h, y1 + margin)
        out = out.crop((x0, y0, x1, y1))

    out.save(out_path)
    kept = creature.mean() * 100
    print(f'{out_path}  {out.width}x{out.height}  保留 {kept:.1f}% 的像素')
    return out


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    thresh = 0.42
    if '--value' in sys.argv:
        thresh = float(sys.argv[sys.argv.index('--value') + 1])
    cutout(src, dst, value_thresh=thresh)
