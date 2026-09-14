#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build"
OUTPUT_DIR="$ROOT_DIR/output"

echo "=== EasyTier QPKG 构建打包工具 ==="

mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

if which qbuild >/dev/null 2>&1; then
    echo "检测到系统已安装 qbuild，直接执行打包..."
    cd "$ROOT_DIR"
    qbuild --root . --build-dir "$BUILD_DIR" --output-dir "$OUTPUT_DIR"
    echo "打包完成！产物位于: $OUTPUT_DIR"
    exit 0
fi

if which docker >/dev/null 2>&1; then
    echo "使用本地 Docker qdk-builder 镜像打包..."
    docker run --rm -v "$ROOT_DIR":/project -w /project qdk-builder qbuild
    [ -d "$ROOT_DIR/build" ] && cp -f "$ROOT_DIR/build/"*.qpkg* "$OUTPUT_DIR/" 2>/dev/null || true
    echo "打包完成！产物位于: $OUTPUT_DIR"
    exit 0
fi

echo "错误：未检测到 qbuild 或 docker 工具，无法完成打包。"
exit 1
