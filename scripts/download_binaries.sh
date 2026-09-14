#!/bin/bash
set -e

VERSION="${1:-2.6.4}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TMP_DIR="$(mktemp -d)"

echo "=== 开始拉取 EasyTier v${VERSION} 二进制文件 ==="

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# 1. 下载 x86_64
echo "[1/2] 下载 x86_64 架构二进制..."
X86_URL="https://github.com/EasyTier/EasyTier/releases/download/v${VERSION}/easytier-linux-x86_64-v${VERSION}.zip"
mkdir -p "$ROOT_DIR/x86_64"
curl -sSL "$X86_URL" -o "$TMP_DIR/easytier_x86_64.zip"
unzip -q -o "$TMP_DIR/easytier_x86_64.zip" -d "$TMP_DIR/x86_64"
# 找到 easytier-core 和 easytier-cli
find "$TMP_DIR/x86_64" -type f -name "easytier-core" -exec cp -f {} "$ROOT_DIR/x86_64/" \;
find "$TMP_DIR/x86_64" -type f -name "easytier-cli" -exec cp -f {} "$ROOT_DIR/x86_64/" \;
chmod +x "$ROOT_DIR/x86_64/easytier-core" "$ROOT_DIR/x86_64/easytier-cli"
echo "x86_64 二进制提取成功："
ls -lh "$ROOT_DIR/x86_64"

# 2. 下载 arm_64 (aarch64)
echo "[2/2] 下载 arm_64 (aarch64) 架构二进制..."
ARM_URL="https://github.com/EasyTier/EasyTier/releases/download/v${VERSION}/easytier-linux-aarch64-v${VERSION}.zip"
mkdir -p "$ROOT_DIR/arm_64"
curl -sSL "$ARM_URL" -o "$TMP_DIR/easytier_arm64.zip"
unzip -q -o "$TMP_DIR/easytier_arm64.zip" -d "$TMP_DIR/arm_64"
find "$TMP_DIR/arm_64" -type f -name "easytier-core" -exec cp -f {} "$ROOT_DIR/arm_64/" \;
find "$TMP_DIR/arm_64" -type f -name "easytier-cli" -exec cp -f {} "$ROOT_DIR/arm_64/" \;
chmod +x "$ROOT_DIR/arm_64/easytier-core" "$ROOT_DIR/arm_64/easytier-cli"
echo "arm_64 二进制提取成功："
ls -lh "$ROOT_DIR/arm_64"

echo "=== 所有架构 EasyTier 二进制下载准备完毕！ ==="
