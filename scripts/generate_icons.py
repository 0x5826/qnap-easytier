#!/usr/bin/env python3
"""
Generate high quality icons for QNAP QPKG and WebUI.
Produces:
- icons/easytier.gif (64x64)
- icons/easytier_80.gif (80x80)
- icons/easytier_gray.gif (80x80)
- shared/web/static/favicon.ico (32x32)
"""

import os
from PIL import Image, ImageDraw

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS_DIR = os.path.join(ROOT_DIR, "icons")
STATIC_DIR = os.path.join(ROOT_DIR, "shared", "web", "static")

os.makedirs(ICONS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

def draw_easytier_icon(size, is_gray=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 基础圆角底板
    pad = int(size * 0.06)
    radius = int(size * 0.22)
    
    if is_gray:
        bg_color = (100, 116, 139, 255)
        accent_light = (203, 213, 225, 255)
        line_color = (148, 163, 184, 255)
        node_color = (241, 245, 249, 255)
    else:
        bg_color = (14, 165, 233, 255)
        accent_light = (56, 189, 248, 255)
        line_color = (255, 255, 255, 220)
        node_color = (255, 255, 255, 255)

    # 绘制带圆角的容器背景
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        fill=bg_color
    )

    # 绘制 Mesh 拓扑网络图形
    center_x = size / 2.0
    center_y = size / 2.0
    r = size * 0.28

    import math
    # 6 个顶点的正六边形拓扑
    points = []
    for i in range(6):
        angle = math.radians(60 * i - 30)
        px = center_x + r * math.cos(angle)
        py = center_y + r * math.sin(angle)
        points.append((px, py))

    # 连接拓扑线
    line_w = max(2, int(size * 0.035))
    for i in range(6):
        draw.line([points[i], points[(i + 1) % 6]], fill=line_color, width=line_w)
        # 对角连接
        draw.line([points[i], (center_x, center_y)], fill=line_color, width=max(1, line_w - 1))

    # 绘制中心和顶点节点圆点
    node_r = max(2, int(size * 0.05))
    draw.ellipse(
        [center_x - node_r - 1, center_y - node_r - 1, center_x + node_r + 1, center_y + node_r + 1],
        fill=accent_light
    )
    for px, py in points:
        draw.ellipse(
            [px - node_r, py - node_r, px + node_r, py + node_r],
            fill=node_color
        )

    return img

def main():
    print("Generating icons...")
    # 1. 80x80
    img_80 = draw_easytier_icon(80, is_gray=False)
    img_80.convert("RGB").save(os.path.join(ICONS_DIR, "easytier_80.gif"), "GIF")
    
    # 2. 64x64
    img_64 = draw_easytier_icon(64, is_gray=False)
    img_64.convert("RGB").save(os.path.join(ICONS_DIR, "easytier.gif"), "GIF")

    # 3. 80x80 Gray
    img_gray = draw_easytier_icon(80, is_gray=True)
    img_gray.convert("RGB").save(os.path.join(ICONS_DIR, "easytier_gray.gif"), "GIF")

    # 4. Favicon (32x32 ico)
    img_32 = draw_easytier_icon(32, is_gray=False)
    img_32.save(os.path.join(STATIC_DIR, "favicon.ico"), format="ICO", sizes=[(32, 32)])

    print("Icons generated successfully in icons/ and shared/web/static/favicon.ico")

if __name__ == "__main__":
    main()
