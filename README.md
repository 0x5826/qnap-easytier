# QNAP EasyTier 插件 (带现代 WebUI 管理面板)

<p align="center">
  <img src="icons/easytier.png" width="100" height="100" alt="EasyTier QNAP Logo">
</p>

<p align="center">
  <strong>专为威联通 QNAP NAS 打造的去中心化 Mesh VPN 原生 QPKG 插件与现代卡片式 Web 控制台</strong>
</p>

<p align="center">
  <a href="https://github.com/0x5826/qnap-easytier/releases"><img src="https://img.shields.io/github/v/release/0x5826/qnap-easytier?color=blue&label=QPKG%20Release" alt="Release"></a>
  <img src="https://img.shields.io/badge/Architecture-x86__64%20%7C%20arm__64-brightgreen" alt="Arch">
  <img src="https://img.shields.io/badge/EasyTier%20Core-v2.6.4-orange" alt="Core">
  <img src="https://img.shields.io/badge/QTS-5.0%2B%20%2F%20QuTS%20hero-blueviolet" alt="QTS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-lightgrey" alt="License"></a>
</p>

---

## 📖 项目简介

本插件基于开源项目 [EasyTier](https://github.com/EasyTier/EasyTier) 核心，为威联通 QNAP QTS / QuTS hero 系统深度定制。它不仅实现了开箱即用的高性能、安全去中心化虚拟网状网络 (Mesh VPN)，还内置了极简、流畅、与 QTS 原生视觉深度整合的卡片式 Web 管理面板。

无需公网 IP，即可实现家庭 NAS、公司电脑、移动设备、异地多台 NAS 之间的高速点对点 (P2P) 安全互联，并可将整个内网网段无缝打通。

---

## ✨ 核心特性

- 🕸️ **去中心化网状组网**：各节点地位对等，支持全自动化 UDP P2P 穿透打洞与智能中继兜底。
- 📊 **原生交互式全网拓扑图**：
  - **纯自研矢量 SVG 引擎**：零外部厚重依赖，纯原生 SVG 极速渲染。
  - **360° 逆时针延迟散射**：基于各节点物理时延自适应排布，辅以三色智能健康环标（绿/橙/红）。
  - **Trace Route 链路探针**：点击任意节点即可高亮整条回溯路径，伴随动态脉冲流光效果。
  - **自由画布操控**：支持节点拖拽锁定、鼠标滚轮无限缩放、画布平移拖拽与一键居中复位。
  - **秒级合成拓扑**：内置合成算法，启动即显，彻底告别后台节点中心漫长的异步收敛等待。
- 🖥️ **现代化全能管理面板**：
  - 完美适配 QTS 60px 顶栏视口，支持节点概要、全局 IP、设备名与运行 PID 实时概览。
  - **节点信息表**：精准提取 IPv4、主机名、直连/中继形态、紧凑时延、丢包率、双向实时流量与隧道加密协议。
  - **活动路由表**：直达路径徽标 (`DIRECT`)，下一跳跳数与延迟紧凑堆叠显示。
  - **终端级实时日志**：支持一键刷新、清屏与实时自动滚动。
- 🛡️ **生产级安全性与系统整合**：
  - **QTS 凭据级鉴权**：严格验证系统 `NAS_SID`，杜绝未授权外部访问。
  - **QuFirewall 智能联动**：自动感知 QNAP 官方防火墙状态，动态注入/卸载 `et0` 虚拟接口白名单放行规则，绝不被误杀。
  - **独立启停与防误开机自启**：支持在 WebUI 中独立停用核心服务；服务停止时开机/重启绝不误自启，同时始终保持 WebUI 维护通道可用。
- ⚡ **开箱即用双架构支持**：
  - 默认集成并打包 `x86_64` (Intel/AMD 平台) 与 `arm_64` (aarch64 平台) 静态编译程序，免除依赖困扰。

---

## 📂 项目结构

```text
.
├── qpkg.cfg                     # QDK 描述文件（包名、版本、图标、WebUI 路由、窗口尺寸）
├── package_routines             # QDK 安装/卸载/升级生命周期钩子
├── icons/                       # QTS 桌面与 App Center 图标 (easytier.gif, 80x80, 100x100, gray)
├── x86_64/                      # x86_64 预编译静态二进制 (easytier-core, easytier-cli)
├── arm_64/                      # ARM64 (aarch64) 预编译静态二进制
├── shared/
│   ├── easytier.sh              # QTS 核心服务启停脚本 (start / stop / restart)
│   ├── easytierconfig           # 后台守护进程 (状态同步、配置变更热重启、QuFirewall联动)
│   ├── version                  # 插件版本标识
│   ├── configs/
│   │   ├── easytier.conf        # 前端持久化配置 (JSON)
│   │   ├── easytier.toml        # 供 easytier-core 运行的标准 TOML 配置
│   │   └── state.json           # 运行状态与拓扑缓存
│   └── web/
│       ├── index.php            # Web 管理面板前端页面 (QTS 鉴权)
│       ├── api.php              # REST API (状态查询、配置写入、服务启停)
│       └── static/              # 纯自包含前端资源 (app.css, app.js, favicon.ico)
└── scripts/
    ├── build_qpkg.sh            # QPKG 构建与打包辅助脚本
    ├── download_binaries.sh     # 官方最新 Release 二进制自动拉取脚本
    └── generate_icons.py        # QTS 标准多尺寸图标生成工具
```

---

## 🚀 安装与使用

### 方式一：直接安装官方预编译 QPKG（推荐）

1. 前往本项目的 [Releases 页面](https://github.com/0x5826/qnap-easytier/releases) 下载适合您 NAS 架构的最新安装包：
   - **Intel / AMD 架构 (x86_64)**：`easytier_x.x.x_x86_64.qpkg`
   - **ARM 架构 (arm_64)**：`easytier_x.x.x_arm_64.qpkg`
2. 登录 QNAP QTS / QuTS hero 管理桌面，打开 **App Center (App 中心)**；
3. 点击右上角设置齿轮旁边的 **手动安装图标 (带加号的小方框)**；
4. 点击“浏览”选择下载的 `.qpkg` 文件，确认安装；
5. 安装完成后，QTS 桌面将出现 **EasyTier** 图标，点击即可打开控制面板。

### 方式二：使用 Docker 源码打包

您也可以在本地通过 QDK 容器自行编译构建 QPKG 安装包：

```bash
# 1. 克隆代码仓库
git clone https://github.com/0x5826/qnap-easytier.git
cd qnap-easytier

# 2. 检查或拉取最新 EasyTier 静态二进制
./scripts/download_binaries.sh 2.6.4

# 3. 使用 Docker 构建 QPKG
./scripts/build_qpkg.sh
```
### 方式三：GitHub Actions 自动构建与发布

本项目已配置自动化 CI/CD 工作流 (`.github/workflows/auto-release.yml`)：
- **每周定时检测**：每周一自动检查上游 [EasyTier 官方仓库](https://github.com/EasyTier/EasyTier) 是否发布了新版本。
- **自动编译与发布**：若检测到官方新版本，将自动拉取对应二进制、组装打包双架构 QPKG，并自动发布新的 GitHub Release。
- **手动触发与指定版本**：您也可以在 GitHub 仓库的 **Actions** 选项卡中手动点击 **Run workflow**，支持强制重构或指定特定版本。

---


## ⚙️ WebUI 配置指南

### 1. 基础配置 (Basic Settings)
- **实例名称 (Instance Name)**：在 EasyTier 拓扑中标识本台 NAS 的别名（如 `My-QNAP-NAS`）。
- **IPv4 分配模式**：
  - `DHCP 自动分配`（推荐）：由网内主节点自动协商分配虚拟网段 IP。
  - `静态指定`：手动指定固定虚拟 IP（如 `10.144.144.10/24`）。
- **网络名称 (Network Name) 与 网络密钥 (Network Secret)**：同一 Mesh 网络内的所有节点必须保持一致。
- **对端节点 (Peers)**：填入公共或自建的中继节点地址（如 `tcp://public.easytier.top:11010`）。

### 2. 高级设置 (Advanced Settings)
- **子网代理 (Proxy Networks)**：将 NAS 所在的内网网段（如 `192.168.1.0/24`）宣告到虚拟网中。开启后，远程接入 EasyTier 网络的电脑或手机可直接访问家庭内网的所有打印机、路由器和局域网设备。
- **RPC 监听地址**：默认 `127.0.0.1:15888`，用于本地 CLI 通信。
- **自定义监听端口**：默认同时监听 TCP 与 UDP `11010` 端口。

### 3. 全网拓扑与节点信息
- **全网拓扑 (Topology)**：可视化呈现全网 Mesh 结构，支持高亮路径追踪与节点交互。
- **节点信息 (Peers)**：直观查看对端物理公网 IP、握手延迟、链路类型（`P2P` 绿色 / `Relay` 黄色）。
- **路由表 (Routes)**：查看底层路由流向与直连状态。

---

## ❓ 常见问题 (FAQ)

### Q: 为什么刚启动或网络波动时，节点会短暂显示 500+ms 的高延迟？
> **A**: 这是 EasyTier 正常的**打洞冷启动与探测收敛周期**。在节点刚上线的前 10~30 秒，两端尚未完成 UDP NAT 直连打洞，数据需先经由中继服务器（Relay Server）转发兜底，经历四段公网往返；同时底层正在进行滑动平均滤波计算。一旦 P2P 打洞完成，延迟将立即恢复到正常的直连低延迟（通常为 10~30ms）。

### Q: 服务停止后，重启 NAS 会自动运行吗？
> **A**: 不会。本插件实现了配置持久化守护。当您在 WebUI 中点击“停止服务”后，后台配置将锁定停用状态。即使重启 NAS，也仅会保持 WebUI 维护进程，坚决不会自启后台 EasyTier 核心，杜绝后台不可控行为。

### Q: QTS 防火墙 (QuFirewall) 拦截了虚拟局域网流量怎么办？
> **A**: 无需手动配置。本插件后台进程会自动检测 QuFirewall 的运行状态，并在检测到防火墙激活时，自动将 `et0` 虚拟接口放行规则插入到防火墙规则链的第一行。

---

## 📜 许可证

- 本插件开源代码遵循 [Apache-2.0 License](LICENSE)。
- EasyTier 核心程序版权归 [EasyTier 开源团队](https://github.com/EasyTier/EasyTier) 所有。
