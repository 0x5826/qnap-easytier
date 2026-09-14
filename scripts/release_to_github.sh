#!/usr/bin/env bash
set -euo pipefail

# 本地一键推送 QPKG 到 GitHub Releases 辅助脚本
# 用法: GITHUB_TOKEN=xxx ./scripts/release_to_github.sh [tag_name]

REPO="0x5826/qnap-easytier"
TAG="${1:-v2.6.4}"
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/release"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "错误: 未检测到 GITHUB_TOKEN 环境变量。"
  echo "请使用以下方式运行："
  echo "  export GITHUB_TOKEN=\"ghp_xxxxxxxxxxxx\""
  echo "  ./scripts/release_to_github.sh $TAG"
  exit 1
fi

if [ ! -d "$RELEASE_DIR" ]; then
  echo "错误: 未找到 release 目录 ($RELEASE_DIR)"
  exit 1
fi

echo "=== 正在检查或创建 GitHub Release: $TAG ($REPO) ==="

# 1. 检查 Release 是否已存在
HTTP_CODE=$(curl -s -o /tmp/gh_rel_info.json -w "%{http_code}" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO/releases/tags/$TAG" || true)

UPLOAD_URL=""
if [ "$HTTP_CODE" = "200" ]; then
  echo "Release $TAG 已存在，准备上传/更新附件..."
  UPLOAD_URL=$(grep -o '"upload_url": "[^"]*' /tmp/gh_rel_info.json | cut -d'"' -f4 | sed 's/{?name,label}//')
else
  echo "Release $TAG 不存在，正在创建新 Release..."
  CREATE_PAYLOAD=$(cat <<EOF
{
  "tag_name": "$TAG",
  "name": "EasyTier QPKG $TAG",
  "body": "QNAP EasyTier 原生 QPKG 插件与现代化 WebUI 控制台 ($TAG)\n\n### 📦 包含制品\n- \`easytier_2.6.4_x86_64.qpkg\` (Intel / AMD 平台)\n- \`easytier_2.6.4_arm_64.qpkg\` (ARM 平台)",
  "draft": false,
  "prerelease": false
}
EOF
)
  curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    -d "$CREATE_PAYLOAD" \
    "https://api.github.com/repos/$REPO/releases" > /tmp/gh_rel_info.json
  
  UPLOAD_URL=$(grep -o '"upload_url": "[^"]*' /tmp/gh_rel_info.json | cut -d'"' -f4 | sed 's/{?name,label}//')
fi

if [ -z "$UPLOAD_URL" ]; then
  echo "错误: 无法获取 Release 上传地址，响应内容："
  cat /tmp/gh_rel_info.json
  exit 1
fi

echo "上传入口地址: $UPLOAD_URL"

# 2. 上传 release 目录下的所有 .qpkg 和 .md5
cd "$RELEASE_DIR"
for file in *.qpkg *.md5; do
  if [ -f "$file" ]; then
    echo "--> 正在上传附件: $file ..."
    MIME_TYPE="application/octet-stream"
    if [[ "$file" == *.md5 ]]; then
      MIME_TYPE="text/plain"
    fi

    # 如果同名 asset 已经存在，则提示或覆盖
    curl -s -X POST \
      -H "Authorization: token $GITHUB_TOKEN" \
      -H "Content-Type: $MIME_TYPE" \
      --data-binary @"$file" \
      "$UPLOAD_URL?name=$file" > /dev/null
    echo "    $file 上传成功！"
  fi
done

echo "=== 所有 QPKG 制品已成功发布到 GitHub Release: https://github.com/$REPO/releases/tag/$TAG ==="
