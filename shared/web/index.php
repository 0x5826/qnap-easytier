<?php
session_start();

function checkQnapSession() {
    if (getenv('EASYTIER_DEV_MODE') === 'true') {
        return true;
    }

    // 1. 获取候选 SID (支持 Cookie, GET, POST, Header)
    $sid = $_COOKIE['NAS_SID'] ?? $_GET['sid'] ?? $_POST['sid'] ?? '';
    if (empty($sid)) {
        foreach ($_COOKIE as $k => $v) {
            if (stripos($k, 'sid') !== false && !empty($v)) {
                $sid = $v;
                break;
            }
        }
    }

    if (empty($sid)) {
        return false;
    }

    // 2. 请求 QTS 本地内部 CGI 校验 (58080 与 5000 端口)
    $cleanSid = urlencode(trim($sid));
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 2,
            'ignore_errors' => true
        ]
    ]);

    foreach (['http://127.0.0.1:58080', 'http://127.0.0.1:5000'] as $host) {
        $url = "$host/cgi-bin/authLogin.cgi?sid=$cleanSid";
        $resp = @file_get_contents($url, false, $ctx);
        if ($resp && (strpos($resp, '<authPassed><![CDATA[1]]></authPassed>') !== false || strpos($resp, '<authPassed>1</authPassed>') !== false)) {
            // 将有效 SID 写入 Session，加速后续验证
            $_SESSION['qnap_sid'] = $sid;
            $_SESSION['qnap_auth_time'] = time();
            return true;
        }
    }

    // 3. 兼容老旧 QTS 4.x /sbin/qweb 工具
    if (file_exists('/sbin/qweb')) {
        $cmd = "/sbin/qweb sid_check " . escapeshellarg($sid) . " 2>/dev/null";
        $result = @shell_exec($cmd);
        if ($result !== null && strpos($result, 'OK') !== false) {
            $_SESSION['qnap_sid'] = $sid;
            $_SESSION['qnap_auth_time'] = time();
            return true;
        }
    }

    return false;
}

$isQnapAuth = checkQnapSession();

if (!$isQnapAuth):
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>身份验证 - EasyTier QNAP</title>
    <link rel="shortcut icon" href="static/favicon.ico" type="image/x-icon">
    <script>
        // 尝试自动从 QTS 桌面顶层窗口或本域提取并继承会话
        (function() {
            try {
                let foundSid = '';
                // 1. 检查本域 Cookie
                const m = document.cookie.match(/(?:^|;\s*)NAS_SID=([^;]+)/);
                if (m) foundSid = m[1];

                // 2. 若无，尝试跨 frame 读取父级 QTS 桌面
                if (!foundSid && window.parent && window.parent !== window) {
                    try {
                        const pm = window.parent.document.cookie.match(/(?:^|;\s*)NAS_SID=([^;]+)/);
                        if (pm) foundSid = pm[1];
                    } catch(e) {}
                }

                // 3. 若检测到 SID 且当前 URL 未携带，立即无感重定向继承
                if (foundSid && !window.location.search.includes('sid=')) {
                    const sep = window.location.search ? '&' : '?';
                    window.location.replace(window.location.href + sep + 'sid=' + encodeURIComponent(foundSid));
                }
            } catch(e) {}
        })();
    </script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #f8fafc;
        }
        .auth-container {
            background: rgba(30, 41, 59, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1);
            padding: 40px; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: center;
            max-width: 440px; width: 90%;
        }
        .lock-icon { font-size: 56px; margin-bottom: 20px; }
        h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; color: #fff; }
        .message {
            background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.3);
            color: #fef08a; padding: 14px; border-radius: 8px; margin: 20px 0; font-size: 14px; line-height: 1.6;
        }
        .btn-login {
            display: inline-block; background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 8px;
            text-decoration: none; font-size: 15px; font-weight: 600; transition: all 0.2s ease;
            box-shadow: 0 4px 14px rgba(14, 165, 233, 0.35);
        }
        .btn-login:hover { background: #38bdf8; transform: translateY(-1px); }
        .footer-info { margin-top: 24px; font-size: 13px; color: #94a3b8; }
        .countdown { color: #38bdf8; font-weight: bold; }
    </style>
</head>
<body>
    <div class="auth-container">
        <img src="static/logo.png" alt="EasyTier" style="width: 64px; height: 64px; margin-bottom: 16px; border-radius: 12px; filter: drop-shadow(0 4px 12px rgba(14, 165, 233, 0.3));">
        <h1>QNAP 身份鉴权</h1>
        <div class="message">
            ⚠️ 访问 EasyTier 控制面板需要先登录 QTS 系统。<br>检测到当前未处于有效的 QTS 登录会话中。
        </div>
        <a href="/" class="btn-login" id="loginBtn">前往 QNAP 登录</a>
        <div class="footer-info">
            <span class="countdown" id="countdown">10</span> 秒后自动跳转至登录页
        </div>
    </div>
    <script>
        let seconds = 10;
        const countdownEl = document.getElementById('countdown');
        const timer = setInterval(() => {
            seconds--;
            countdownEl.textContent = seconds;
            if (seconds <= 0) {
                clearInterval(timer);
                window.top.location.href = '/';
            }
        }, 1000);
    </script>
</body>
</html>
<?php
exit;
endif;
$assetVer = file_exists(__DIR__ . '/static/logo.png') ? filemtime(__DIR__ . '/static/logo.png') : time();
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EasyTier Mesh VPN - QNAP 管理面板</title>
    <link rel="shortcut icon" href="static/favicon.ico?v=<?= $assetVer ?>" type="image/x-icon">
    <link rel="stylesheet" href="static/app.css?v=<?= $assetVer ?>">
</head>
<body>
    <div class="app-wrapper">
        <!-- 头部导航 -->
        <header class="app-header">
            <div class="header-left">
                <img src="static/logo.png?v=<?= $assetVer ?>" alt="EasyTier" class="official-logo" width="38" height="38">
                <div class="title-meta">
                    <h1>EasyTier <span class="badge-qnap">QNAP</span> <span class="badge-version" id="headerVersion">v2.6.4</span></h1>
                    <span class="app-subtitle">去中心化网状 VPN 控制台</span>
                </div>
            </div>
            
            <div class="header-right">
                <div class="status-indicator-box">
                    <span class="pulse-dot status-dot-stopped" id="headerStatusDot"></span>
                    <span class="status-text" id="headerStatusText">检测中...</span>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-outline" id="btnRefresh" title="刷新状态">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                        <span>刷新</span>
                    </button>
                    <button class="btn btn-primary" id="btnServiceSwitch">启动服务</button>
                </div>
            </div>
        </header>

        <!-- 概览状态卡片 -->
        <section class="stat-grid">
            <div class="stat-card">
                <div class="stat-icon bg-blue">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                        <line x1="6" y1="6" x2="6.01" y2="6"></line>
                        <line x1="6" y1="18" x2="6.01" y2="18"></line>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">虚拟 IPv4 地址</div>
                    <div class="stat-val text-mono" id="statIpv4">--</div>
                </div>
            </div>

            <div class="stat-card" title="当前 Mesh 网络中包含本节点与路由可达的所有在线节点数">
                <div class="stat-icon bg-emerald">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">全网在线节点</div>
                    <div class="stat-val" id="statPeersCount">0 台</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon bg-indigo">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">虚拟网卡</div>
                    <div class="stat-val text-mono" id="statDevName">et0</div>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon bg-amber">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                </div>
                <div class="stat-content">
                    <div class="stat-label">运行进程 PID</div>
                    <div class="stat-val text-mono" id="statPid">未运行</div>
                </div>
            </div>
        </section>

        <!-- 主体选项卡 -->
        <main class="main-card">
            <div class="tab-nav">
                <button class="tab-btn active" data-tab="status">节点信息</button>
                <button class="tab-btn" data-tab="topology">全网拓扑</button>
                <button class="tab-btn" data-tab="config">基础网络配置</button>
                <button class="tab-btn" data-tab="advanced">高级与子网代理</button>
                <button class="tab-btn" data-tab="logs">运行日志</button>
                <button class="tab-btn" data-tab="about">关于</button>
            </div>

            <div class="tab-content-area">
                <!-- Tab 1: 节点信息 (原全网拓扑信息) -->
                <div class="tab-pane active" id="pane-status">
                    <div class="pane-header">
                        <h2>对端节点列表 (Peers)</h2>
                        <span class="subtext">显示当前网络中已发现并直连/中继的所有节点</span>
                    </div>

                    <div class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>虚拟 IPv4</th>
                                    <th>主机名</th>
                                    <th>开销</th>
                                    <th>延迟</th>
                                    <th>丢包率</th>
                                    <th>收发流量</th>
                                    <th>链路协议</th>
                                </tr>
                            </thead>
                            <tbody id="peerTableBody">
                                <tr>
                                    <td colspan="7" class="text-center text-muted">正在查询对端节点...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="pane-header" style="margin-top: 30px;">
                        <h2>活动路由表 (Routes)</h2>
                        <span class="subtext">EasyTier 自动计算生成的最优转发路径</span>
                    </div>

                    <div class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>目的地址</th>
                                    <th>目的主机名</th>
                                    <th>子网代理</th>
                                    <th>下一跳 IP</th>
                                    <th>下一跳主机名</th>
                                    <th>开销</th>
                                </tr>
                            </thead>
                            <tbody id="routeTableBody">
                                <tr>
                                    <td colspan="6" class="text-center text-muted">暂无路由信息</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Tab 2: 全网拓扑 (Network Topology) -->
                <div class="tab-pane" id="pane-topology">
                    <div class="pane-header flex-between" style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h2>全网拓扑星轨视图</h2>
                            <span class="subtext">动态呈现全网 Mesh 互联星轨拓扑、链路质量与最优路由跳数</span>
                        </div>
                        <div class="header-actions">
                            <button type="button" class="btn btn-outline" id="btnRefreshTopo">刷新拓扑</button>
                        </div>
                    </div>

                    <div id="easytier_topology_display" class="topo-container-box">
                        <div class="topo-empty-tip">正在构建全网拓扑星轨视图...</div>
                    </div>

                    <div class="topo-legend-bar">
                        <span class="legend-item"><span class="legend-color-dot" style="background: #10b981;"></span>&lt; 50ms (极佳)</span>
                        <span class="legend-item"><span class="legend-color-dot" style="background: #3b82f6;"></span>50 ~ 150ms (良好)</span>
                        <span class="legend-item"><span class="legend-color-dot" style="background: #f59e0b;"></span>&gt; 150ms (尚可)</span>
                        <span class="legend-item"><span class="legend-color-line" style="background: #f59e0b;"></span>中继链路</span>
                        <span class="legend-item"><span class="legend-cidr-badge">CIDR</span>代理子网</span>
                    </div>
                </div>

                <!-- Tab 3: 基础配置 -->
                <div class="tab-pane" id="pane-config">
                    <form id="basicForm">
                        <div class="form-section">
                            <div class="form-row">
                                <label class="form-label" for="instance_name">节点名称 (--instance-name)</label>
                                <input type="text" id="instance_name" class="form-control" placeholder="qnap-easytier" required>
                                <div class="form-hint">在 EasyTier 拓扑中标识此节点的唯一名称，默认自动读取 NAS 系统主机名。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label">IPv4 分配模式</label>
                                <div class="radio-group">
                                    <label class="radio-label">
                                        <input type="radio" name="ip_mode" value="dhcp" id="ipModeDhcp" checked>
                                        <span>DHCP 自动分配 (推荐)</span>
                                    </label>
                                    <label class="radio-label">
                                        <input type="radio" name="ip_mode" value="static" id="ipModeStatic">
                                        <span>静态指定 IP</span>
                                    </label>
                                </div>
                            </div>

                            <div class="form-row" id="staticIpRow" style="display: none;">
                                <label class="form-label" for="ipv4">虚拟 IPv4 地址 (--ipv4)</label>
                                <input type="text" id="ipv4" class="form-control font-mono" placeholder="留空或例如 10.144.144.10/24">
                                <div class="form-hint">仅静态模式生效，格式如 10.144.144.10/24。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="network_name">网络名称 (--network-name)</label>
                                <input type="text" id="network_name" class="form-control" placeholder="easytier" required>
                                <div class="form-hint">加入同一虚拟网的所有节点必须具备完全一致的网络名称。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="network_secret">网络密钥 (--network-secret)</label>
                                <input type="password" id="network_secret" class="form-control" placeholder="留空为无密钥">
                                <div class="form-hint">虚拟网节点通信认证握手密钥，留空表示公开无密。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="peers">对端节点 (--peers)</label>
                                <textarea id="peers" class="form-control font-mono" rows="3" placeholder="tcp://public.easytier.top:11010"></textarea>
                                <div class="form-hint">用于引导入网和辅助 NAT 穿透的中继节点，每行一个 URI（支持 tcp://、udp://、wg:// 等）。</div>
                            </div>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary" id="btnSaveBasic">保存并应用</button>
                            <button type="button" class="btn btn-outline" id="btnResetBasic">重置表单</button>
                        </div>
                    </form>
                </div>

                <!-- Tab 3: 高级配置 -->
                <div class="tab-pane" id="pane-advanced">
                    <form id="advForm">
                        <div class="form-section">
                            <div class="form-row">
                                <label class="form-label" for="proxy_networks">子网代理网段 (--proxy-networks)</label>
                                <input type="text" id="proxy_networks" class="form-control font-mono" placeholder="例如: 192.168.1.0/24">
                                <div class="form-hint">将 NAS 所在局域网广播给虚拟网其它节点，多个网段用逗号分隔（如 192.168.1.0/24, 192.168.2.0/24）。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="listeners">本地监听地址 (--listeners)</label>
                                <textarea id="listeners" class="form-control font-mono" rows="2" placeholder="tcp://0.0.0.0:11010&#10;udp://0.0.0.0:11010"></textarea>
                                <div class="form-hint">每行一个监听配置。默认监听 TCP 和 UDP 11010 端口。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="dev_name">虚拟网卡设备名 (--dev-name)</label>
                                <input type="text" id="dev_name" class="form-control font-mono" value="et0" placeholder="et0">
                                <div class="form-hint">虚拟 TUN 设备名，默认 et0。该接口将受 QuFirewall 策略自动化联动防护。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="rpc_portal">RPC 门户监听地址 (--rpc-portal)</label>
                                <input type="text" id="rpc_portal" class="form-control font-mono" value="127.0.0.1:15888">
                                <div class="form-hint">供本地 CLI 与 WebUI 查询拓扑状态，建议保持 127.0.0.1:15888。</div>
                            </div>

                            <div class="form-row">
                                <label class="form-label" for="custom_flags">自定义启动参数 (--flags)</label>
                                <input type="text" id="custom_flags" class="form-control font-mono" placeholder="例如: --multi-thread --relay-network-whitelist 10.0.0.0/8">
                                <div class="form-hint">用户自行输入的额外启动参数，将直接透传给底层 easytier-core，多个参数以空格分隔。</div>
                            </div>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary" id="btnSaveAdv">保存高级配置并重启</button>
                        </div>
                    </form>
                </div>

                <!-- Tab 4: 运行日志 -->
                <div class="tab-pane" id="pane-logs">
                    <div class="pane-header">
                        <h2>实时运行日志</h2>
                        <div class="log-controls">
                            <label class="checkbox-label" style="margin-right: 12px;">
                                <input type="checkbox" id="logAutoScroll" checked> 自动滚屏
                            </label>
                            <button class="btn btn-sm btn-outline" id="btnRefreshLogs">刷新日志</button>
                            <button class="btn btn-sm btn-danger" id="btnClearLogs">清空</button>
                        </div>
                    </div>
                    <div class="terminal-box" id="terminalLog">正在拉取日志数据...</div>
                </div>

                <!-- Tab 5: 关于 -->
                <div class="tab-pane" id="pane-about">
                    <div class="about-card">
                        <h3>关于 EasyTier for QNAP</h3>
                        <p>EasyTier 是一款采用 Rust 语言与 Tokio 异步框架打造的简单、安全、去中心化虚拟网状网络（Mesh VPN）。</p>
                        <br>
                        <h4>核心特性：</h4>
                        <ul class="feature-list">
                            <li>✨ <strong>完全去中心化</strong>：节点地位均等独立，去中心化自动组网。</li>
                            <li>⚡️ <strong>高性能 NAT 穿透</strong>：支持针对复杂 Symmetric NAT 的 P2P 穿透打洞及高效中继。</li>
                            <li>🛡️ <strong>QNAP QuFirewall 深度适配</strong>：内核 tun 驱动自检、防火墙规则自注入与清理。</li>
                            <li>🌐 <strong>子网广播代理</strong>：打通 NAS 内网与出差移动端互联。</li>
                        </ul>
                        <br>
                        <h4>相关链接：</h4>
                        <p>
                            <a href="https://github.com/EasyTier/EasyTier" target="_blank" class="link-btn">EasyTier GitHub 仓库</a>
                            <a href="https://easytier.cn/" target="_blank" class="link-btn">EasyTier 官方文档</a>
                        </p>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <!-- 通知 Toast 浮层 -->
    <div id="toast" class="toast"></div>

    <script>
        window.QNAP_SID = <?= json_encode($_SESSION['qnap_sid'] ?? '') ?>;
    </script>
    <script src="static/app.js?v=<?= $assetVer ?>"></script>
</body>
</html>
