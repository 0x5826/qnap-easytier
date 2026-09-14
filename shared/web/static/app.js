// EasyTier QNAP WebUI Frontend Logic
document.addEventListener('DOMContentLoaded', () => {
    let isServiceRunning = false;
    let pollTimer = null;
    let logPollTimer = null;
    let latestStatusData = null;

    // 元素引用
    const headerStatusDot = document.getElementById('headerStatusDot');
    const headerStatusText = document.getElementById('headerStatusText');
    const btnServiceSwitch = document.getElementById('btnServiceSwitch');
    const btnRefresh = document.getElementById('btnRefresh');

    const statIpv4 = document.getElementById('statIpv4');
    const statPeersCount = document.getElementById('statPeersCount');
    const statDevName = document.getElementById('statDevName');
    const statPid = document.getElementById('statPid');

    const peerTableBody = document.getElementById('peerTableBody');
    const routeTableBody = document.getElementById('routeTableBody');
    const terminalLog = document.getElementById('terminalLog');
    const logAutoScroll = document.getElementById('logAutoScroll');

    const basicForm = document.getElementById('basicForm');
    const advForm = document.getElementById('advForm');
    const ipModeStatic = document.getElementById('ipModeStatic');
    const ipModeDhcp = document.getElementById('ipModeDhcp');
    const staticIpRow = document.getElementById('staticIpRow');

    // Toast 提示
    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.style.borderColor = isError ? '#ef4444' : '#10b981';
        toast.style.color = isError ? '#f87171' : '#34d399';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // 会话凭据与统一请求封装
    function getActiveSid() {
        if (window.QNAP_SID) return window.QNAP_SID;
        const match = location.search.match(/[?&]sid=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
        const cookieMatch = document.cookie.match(/(?:^|;\s*)NAS_SID=([^;]+)/);
        if (cookieMatch) return cookieMatch[1];
        return '';
    }

    function apiFetch(url, options = {}) {
        const sid = getActiveSid();
        if (sid && !url.includes('sid=')) {
            const sep = url.includes('?') ? '&' : '?';
            url = `${url}${sep}sid=${encodeURIComponent(sid)}`;
        }
        return fetch(url, options);
    }

    // 选项卡切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetId = `pane-${btn.getAttribute('data-tab')}`;
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');

            if (btn.getAttribute('data-tab') === 'logs') {
                fetchLogs();
            } else if (btn.getAttribute('data-tab') === 'topology') {
                renderCurrentTopology();
                fetchStatus();
            }
        });
    });

    // IP 模式切换
    function updateIpModeUI() {
        if (ipModeDhcp.checked) {
            staticIpRow.style.display = 'none';
        } else {
            staticIpRow.style.display = 'block';
        }
    }
    ipModeStatic.addEventListener('change', updateIpModeUI);
    ipModeDhcp.addEventListener('change', updateIpModeUI);

    // 获取并更新状态
    async function fetchStatus() {
        try {
            const res = await apiFetch('api.php?action=get_status');
            const json = await res.json();
            if (!json.success) return;

            const d = json.data;
            isServiceRunning = !!d.running;

            // 更新顶栏状态
            if (isServiceRunning) {
                headerStatusDot.className = 'pulse-dot status-dot-running';
                headerStatusText.textContent = '运行中';
                btnServiceSwitch.textContent = '停止服务';
                btnServiceSwitch.className = 'btn btn-danger';
                statPid.textContent = d.pid || '--';
            } else {
                headerStatusDot.className = 'pulse-dot status-dot-stopped';
                headerStatusText.textContent = '已停止';
                btnServiceSwitch.textContent = '启动服务';
                btnServiceSwitch.className = 'btn btn-primary';
                statPid.textContent = '未运行';
            }

            // 动态更新顶栏版本号
            if (d.version) {
                const match = String(d.version).match(/(\d+\.\d+(?:\.\d+)?)/);
                const cleanVer = match ? match[1] : '2.6.4';
                const verEl = document.getElementById('headerVersion');
                if (verEl) {
                    verEl.textContent = `v${cleanVer}`;
                }
            }

            statIpv4.textContent = d.ipv4 || '--';
            statDevName.textContent = d.dev_name || 'et0';

            // 全网在线节点数 = 路由表中可达目标节点集合 + 本机自身 (服务运行中)
            let totalNodes = 0;
            if (isServiceRunning) {
                const destSet = new Set();
                (d.routes || []).forEach(r => {
                    if (r.destination && r.destination !== '--') {
                        destSet.add(r.destination);
                    }
                });
                totalNodes = destSet.size + 1;
                statPeersCount.innerHTML = `${totalNodes} <span style="font-size:12px;font-weight:normal;color:var(--text-muted);">台</span>`;
            } else {
                statPeersCount.innerHTML = '<span class="text-muted">--</span>';
            }

            const peers = d.peers || [];

            // 渲染 Peers 表格 (7 列严格对齐)
            if (peers.length === 0) {
                peerTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">${isServiceRunning ? '暂未连接到任何对端节点' : '服务未运行'}</td></tr>`;
            } else {
                peerTableBody.innerHTML = peers.map(p => {
                    const costLower = (p.cost || '').toLowerCase();
                    const isLocal = costLower.includes('local');
                    const isRelay = costLower.includes('relay') || (p.tunnel || '').toLowerCase().includes('relay');
                    let badgeClass = 'badge-p2p';
                    if (isLocal) badgeClass = 'badge-local';
                    else if (isRelay) badgeClass = 'badge-relay';

                    let trafficHtml = '<span class="text-muted">--</span>';
                    const hasRx = p.rx && p.rx !== '--';
                    const hasTx = p.tx && p.tx !== '--';
                    if (hasRx || hasTx) {
                        const rxVal = escapeHtml(p.rx || '0 B');
                        const txVal = escapeHtml(p.tx || '0 B');
                        trafficHtml = `
                        <div class="traffic-stack">
                            <span class="traffic-line traffic-rx" title="接收 (Rx)"><span class="traffic-arrow">↓</span>${rxVal}</span>
                            <span class="traffic-line traffic-tx" title="发送 (Tx)"><span class="traffic-arrow">↑</span>${txVal}</span>
                        </div>`;
                    }

                    const proto = p.tunnel || p.nat || '--';
                    return `
                    <tr>
                        <td class="font-mono text-bold">${escapeHtml(p.ipv4 || '--')}</td>
                        <td>${escapeHtml(p.hostname || '--')}</td>
                        <td><span class="badge-tag ${badgeClass}">${escapeHtml(p.cost || '--')}</span></td>
                        <td class="font-mono">${escapeHtml(formatLatency(p.latency))}</td>
                        <td>${escapeHtml(p.loss || '0.0%')}</td>
                        <td>${trafficHtml}</td>
                        <td><span class="badge-tag badge-protocol">${escapeHtml(proto)}</span></td>
                    </tr>`;
                }).join('');
            }

            // 渲染 Routes 表格 (6 列严格对齐)
            const routes = d.routes || [];
            if (routes.length === 0) {
                routeTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">暂无活动转发路由</td></tr>`;
            } else {
                routeTableBody.innerHTML = routes.map(r => {
                    const isDirect = (r.next_hop_ipv4 || '').toUpperCase() === 'DIRECT' || (r.next_hop_hostname || '').toUpperCase() === 'DIRECT';
                    const hopIpDisplay = isDirect 
                        ? `<span class="badge-tag badge-p2p">DIRECT</span>` 
                        : `<span class="font-mono text-bold">${escapeHtml(r.next_hop_ipv4 || '--')}</span>`;
                    const hopHostDisplay = isDirect 
                        ? `<span class="text-muted">直达</span>` 
                        : escapeHtml(r.next_hop_hostname || '--');

                    let proxyCidrsHtml = '<span class="text-muted">--</span>';
                    if (r.proxy_cidrs && r.proxy_cidrs !== '--') {
                        const list = r.proxy_cidrs.split(',').map(s => s.trim()).filter(Boolean);
                        if (list.length > 1) {
                            proxyCidrsHtml = `<div class="cidr-stack">${list.map(c => `<span class="cidr-line font-mono">${escapeHtml(c)}</span>`).join('')}</div>`;
                        } else if (list.length === 1) {
                            proxyCidrsHtml = `<span class="font-mono">${escapeHtml(list[0])}</span>`;
                        }
                    }

                    let costHtml = '<span class="text-muted">--</span>';
                    if (r.cost_hops !== undefined && r.cost_hops !== null) {
                        const hopsStr = `${r.cost_hops} 跳`;
                        const latStr = (r.cost_lat !== undefined && r.cost_lat !== null) ? formatLatency(r.cost_lat) : '';
                        costHtml = `
                        <div class="cost-stack font-mono">
                            <span class="cost-hops text-bold">${escapeHtml(hopsStr)}</span>
                            ${latStr && latStr !== '--' ? `<span class="cost-lat text-muted">${escapeHtml(latStr)}</span>` : ''}
                        </div>`;
                    } else if (r.cost && r.cost !== '--') {
                        costHtml = `<span class="font-mono">${escapeHtml(r.cost)}</span>`;
                    }

                    return `
                    <tr>
                        <td class="font-mono text-bold">${escapeHtml(r.destination || '--')}</td>
                        <td>${escapeHtml(r.hostname || '--')}</td>
                        <td>${proxyCidrsHtml}</td>
                        <td>${hopIpDisplay}</td>
                        <td>${hopHostDisplay}</td>
                        <td>${costHtml}</td>
                    </tr>`;
                }).join('');
            }
            latestStatusData = d;
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.getAttribute('data-tab') === 'topology') {
                renderCurrentTopology();
            }
        } catch (e) {
            console.error('Fetch status error:', e);
        }
    }

    // 获取配置并回显
    async function fetchConfig() {
        try {
            const res = await apiFetch('api.php?action=get_config');
            const json = await res.json();
            if (!json.success) return;

            const c = json.data;
            document.getElementById('instance_name').value = c.instance_name || '';
            document.getElementById('ipv4').value = c.ipv4 || '';
            if (c.dhcp) {
                ipModeDhcp.checked = true;
            } else {
                ipModeStatic.checked = true;
            }
            updateIpModeUI();

            document.getElementById('network_name').value = c.network_name || '';
            document.getElementById('network_secret').value = c.network_secret || '';
            document.getElementById('peers').value = (c.peers || []).join('\n');

            // 高级配置
            document.getElementById('proxy_networks').value = (c.proxy_networks || []).join(', ');
            document.getElementById('listeners').value = (c.listeners || []).join('\n');
            document.getElementById('dev_name').value = c.dev_name || 'et0';
            document.getElementById('rpc_portal').value = c.rpc_portal || '127.0.0.1:15888';
            document.getElementById('custom_flags').value = c.custom_flags || '';
        } catch (e) {
            console.error('Fetch config error:', e);
        }
    }

    // 保存配置
    async function saveConfigData(applyNow = false) {
        const peersVal = document.getElementById('peers').value
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);

        const listenersVal = document.getElementById('listeners').value
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);

        const proxyVal = document.getElementById('proxy_networks').value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        const payload = {
            enabled: 1,
            instance_name: document.getElementById('instance_name').value.trim(),
            dhcp: ipModeDhcp.checked,
            ipv4: document.getElementById('ipv4').value.trim(),
            network_name: document.getElementById('network_name').value.trim(),
            network_secret: document.getElementById('network_secret').value.trim(),
            peers: peersVal,
            listeners: listenersVal.length > 0 ? listenersVal : ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'],
            dev_name: document.getElementById('dev_name').value.trim() || 'et0',
            rpc_portal: document.getElementById('rpc_portal').value.trim() || '127.0.0.1:15888',
            custom_flags: document.getElementById('custom_flags').value.trim(),
            proxy_networks: proxyVal,
            apply_now: applyNow
        };

        try {
            const res = await apiFetch('api.php?action=save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.success) {
                showToast(json.message || '配置已成功保存！');
                setTimeout(fetchStatus, 2000);
            } else {
                showToast(json.message || '保存失败', true);
            }
        } catch (e) {
            showToast('请求失败：' + e.message, true);
        }
    }

    // 表单提交事件
    basicForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveConfigData(true);
    });

    advForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveConfigData(true);
    });

    document.getElementById('btnResetBasic').addEventListener('click', () => {
        fetchConfig();
        showToast('已重置回当前生效配置');
    });

    // 服务控制
    async function controlService(cmd) {
        try {
            const formData = new FormData();
            formData.append('cmd', cmd);
            const res = await apiFetch('api.php?action=service_control', {
                method: 'POST',
                body: formData
            });
            const json = await res.json();
            if (json.success) {
                showToast(json.message);
                setTimeout(fetchStatus, 2500);
            } else {
                showToast(json.message, true);
            }
        } catch (e) {
            showToast('操作失败：' + e.message, true);
        }
    }

    btnServiceSwitch.addEventListener('click', () => {
        controlService(isServiceRunning ? 'stop' : 'start');
    });

    btnRefresh.addEventListener('click', () => {
        fetchStatus();
        showToast('状态已刷新');
    });

    // 日志处理
    async function fetchLogs() {
        try {
            const res = await apiFetch('api.php?action=get_logs&lines=150');
            const json = await res.json();
            if (json.success && json.data) {
                terminalLog.textContent = json.data.logs || '(暂无日志输出)';
                if (logAutoScroll.checked) {
                    terminalLog.scrollTop = terminalLog.scrollHeight;
                }
            }
        } catch (e) {
            console.error('Fetch logs error:', e);
        }
    }

    document.getElementById('btnRefreshLogs').addEventListener('click', fetchLogs);

    document.getElementById('btnClearLogs').addEventListener('click', async () => {
        try {
            const res = await apiFetch('api.php?action=clear_logs');
            const json = await res.json();
            if (json.success) {
                terminalLog.textContent = '';
                showToast('日志已清空');
            }
        } catch (e) {
            showToast('清空失败', true);
        }
    });

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // 格式化延迟：>=1ms 显示四舍五入整数(如 5ms)，<1ms 保留两位小数(如 0.43ms)，紧凑无空格省空间
    function formatLatency(lat) {
        if (lat === undefined || lat === null || lat === '' || lat === '--' || lat === '-') {
            return '--';
        }
        const str = String(lat).trim();
        const num = parseFloat(str.replace(/[^0-9.]/g, ''));
        if (isNaN(num)) return str;
        if (num <= 0) return '0ms';
        if (num >= 1) {
            return `${Math.round(num)}ms`;
        } else {
            return `${Number(num.toFixed(2))}ms`;
        }
    }

    // 拓扑图纯原生 SVG 渲染引擎
    const topologyViewState = {
        scale: 1.0,
        panX: 0,
        panY: 0,
        nodePositions: {},
        showAllLinks: false
    };

    function createSvg(tag, attrs, children) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v !== undefined && v !== null) el.setAttribute(k, v);
            }
        }
        if (children) {
            if (Array.isArray(children)) {
                children.forEach(c => {
                    if (c instanceof Node) el.appendChild(c);
                    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(c));
                });
            } else if (children instanceof Node) {
                el.appendChild(children);
            } else if (typeof children === 'string' || typeof children === 'number') {
                el.appendChild(document.createTextNode(children));
            }
        }
        return el;
    }

    function getCircleEdgePoint(cx, cy, targetX, targetY, radius) {
        const dx = targetX - cx;
        const dy = targetY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return { x: cx, y: cy };
        const r = radius + 2;
        return {
            x: Math.round(cx + (dx / dist) * r),
            y: Math.round(cy + (dy / dist) * r)
        };
    }

    function buildSyntheticTopology(statusData) {
        if (!statusData) return [];
        const peers = statusData.peers || [];
        const routes = statusData.routes || [];
        const localIp = statusData.ipv4 || (statusData.local_node ? statusData.local_node.ipv4 : '10.144.144.1');
        const localHost = (statusData.local_node ? statusData.local_node.hostname : '') || 'Local';

        const nodesMap = {};
        const localId = '1';
        nodesMap[localId] = {
            node_id: localId,
            hostname: localHost,
            ipv4: localIp,
            proxy_cidrs: '',
            direct_peers: []
        };

        let autoId = 2;
        peers.forEach(p => {
            const pId = String(autoId++);
            const pLat = parseFloat(p.latency);
            const latVal = (!isNaN(pLat) && pLat > 0) ? pLat : null;

            nodesMap[localId].direct_peers.push({
                node_id: pId,
                hostname: p.hostname,
                latency_ms: latVal
            });

            nodesMap[pId] = {
                node_id: pId,
                hostname: p.hostname,
                ipv4: p.ipv4,
                proxy_cidrs: '',
                direct_peers: [
                    {
                        node_id: localId,
                        hostname: localHost,
                        latency_ms: latVal
                    }
                ]
            };
        });

        routes.forEach(r => {
            const destIp = (r.destination || '').split('/')[0];
            const destHost = r.hostname || '';
            const proxy = (r.proxy_cidrs && r.proxy_cidrs !== '--') ? r.proxy_cidrs : '';

            let matched = false;
            for (const nid in nodesMap) {
                const n = nodesMap[nid];
                if ((n.ipv4 && n.ipv4.startsWith(destIp)) || (n.hostname && n.hostname === destHost)) {
                    if (proxy) n.proxy_cidrs = proxy;
                    matched = true;
                    break;
                }
            }

            if (!matched && destIp && destIp !== '--' && destIp !== localIp.split('/')[0]) {
                const rId = String(autoId++);
                nodesMap[rId] = {
                    node_id: rId,
                    hostname: destHost || 'Remote',
                    ipv4: r.destination,
                    proxy_cidrs: proxy,
                    direct_peers: []
                };
            }
        });

        return Object.values(nodesMap);
    }

    function renderCurrentTopology() {
        const display = document.getElementById('easytier_topology_display');
        if (!display) return;
        if (!isServiceRunning) {
            display.innerHTML = '<div class="topo-empty-tip">EasyTier 服务尚未运行，启动后将自动呈现全网拓扑</div>';
            return;
        }

        let topoData = (latestStatusData && latestStatusData.topology) ? latestStatusData.topology : [];
        const peerData = (latestStatusData && latestStatusData.peers) ? latestStatusData.peers : [];
        const routeData = (latestStatusData && latestStatusData.routes) ? latestStatusData.routes : [];

        // 智能即时合成：若全网 peer-center 尚未同步完成，直接基于活动对端与路由表 0 延迟秒开呈现！
        if (topoData.length === 0 && (peerData.length > 0 || routeData.length > 0)) {
            topoData = buildSyntheticTopology(latestStatusData);
        }

        if (topoData.length === 0) {
            display.innerHTML = '<div class="topo-empty-tip"><span class="loading-spinner"></span>全网拓扑节点同步中，正在探测星轨链路...</div>';
            return;
        }

        const svgEl = renderTopologySvg(topoData, peerData, routeData);
        display.innerHTML = '';
        display.appendChild(svgEl);
    }

    function renderTopologySvg(topoData, peerData, routeData) {
        let rawNodes = [];
        if (Array.isArray(topoData)) rawNodes = topoData;
        else if (topoData && Array.isArray(topoData.nodes)) rawNodes = topoData.nodes;

        // 过滤幽灵节点与空 IP 节点
        rawNodes = (rawNodes || []).filter(n => {
            if (!n) return false;
            const host = n.hostname ? String(n.hostname).trim().toLowerCase() : '';
            const ip = n.ipv4 ? String(n.ipv4).trim() : '';
            if (!host || host === 'unknown') return false;
            if (!ip || ip === '-' || ip === 'null') return false;
            return true;
        });

        if (rawNodes.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'topo-empty-tip';
            emptyEl.textContent = '暂无可用拓扑数据 (等待节点接入网络)';
            return emptyEl;
        }

        const validNodeIdMap = {};
        rawNodes.forEach(n => {
            if (n.node_id) validNodeIdMap[String(n.node_id)] = true;
        });

        let localIpv4 = '';
        const peers = Array.isArray(peerData) ? peerData : [];
        if (latestStatusData && latestStatusData.ipv4) {
            localIpv4 = String(latestStatusData.ipv4).trim().split('/')[0];
        }
        for (let i = 0; i < peers.length; i++) {
            if (peers[i].cost && String(peers[i].cost).trim().toLowerCase() === 'local') {
                if (peers[i].ipv4) localIpv4 = String(peers[i].ipv4).trim().split('/')[0];
                break;
            }
        }

        let nodes = [];
        let localNode = null;
        for (let i = 0; i < rawNodes.length; i++) {
            const n = rawNodes[i];
            const nIp = n.ipv4 ? String(n.ipv4).trim().split('/')[0] : '';
            if (localIpv4 && nIp === localIpv4) {
                localNode = n;
            } else {
                nodes.push(n);
            }
        }
        if (localNode) {
            nodes.unshift(localNode);
        }

        const localPeerLatencyMap = {};
        peers.forEach(p => {
            if (!p.cost || String(p.cost).trim().toLowerCase() === 'local') return;
            const latVal = parseFloat(p.latency);
            if (!isNaN(latVal) && latVal > 0) {
                const pIp = p.ipv4 ? String(p.ipv4).trim().split('/')[0] : '';
                const pHost = p.hostname ? String(p.hostname).trim() : '';
                if (pIp) localPeerLatencyMap[pIp] = Math.round(latVal);
                if (pHost) localPeerLatencyMap[pHost] = Math.round(latVal);
            }
        });

        const peerRouteInfoMap = {};
        const routes = Array.isArray(routeData) ? routeData : [];
        routes.forEach(r => {
            const rIp = r.destination ? String(r.destination).trim().split('/')[0] : '';
            const rHost = r.hostname ? String(r.hostname).trim() : '';
            const nextHopHost = r.next_hop_hostname ? String(r.next_hop_hostname).trim() : '';
            const nextHopIp = r.next_hop_ipv4 ? String(r.next_hop_ipv4).trim().split('/')[0] : '';
            const isDirect = (nextHopIp.toUpperCase() === 'DIRECT' || nextHopHost.toUpperCase() === 'DIRECT');
            const isRelay = !isDirect && (nextHopIp !== '--' && nextHopIp !== '');
            const entry = {
                isRelay: isRelay,
                cost: r.cost || '-',
                nextHopHost: nextHopHost,
                nextHopIp: nextHopIp,
                pathLatency: r.cost_lat,
                latency: r.cost_lat
            };
            if (rIp) peerRouteInfoMap[rIp] = entry;
            if (rHost) peerRouteInfoMap[rHost] = entry;
        });

        const nodeCount = nodes.length;
        const linkMap = {};
        const showAllLinks = !!topologyViewState.showAllLinks;

        // 生成链路：基于各节点的 direct_peers
        for (let i = 0; i < nodeCount; i++) {
            const src = nodes[i];
            const dPeers = src.direct_peers || [];
            for (let j = 0; j < dPeers.length; j++) {
                const dst = dPeers[j];
                if (!dst.node_id || !validNodeIdMap[String(dst.node_id)]) continue;
                const dstHost = dst.hostname ? String(dst.hostname).trim().toLowerCase() : '';
                if (dstHost === 'unknown') continue;

                const isLocalLink = localNode && (String(src.node_id) === String(localNode.node_id) || String(dst.node_id) === String(localNode.node_id));
                const pairKey = [src.node_id, dst.node_id].sort().join('---');

                if (!linkMap[pairKey]) {
                    linkMap[pairKey] = {
                        srcId: src.node_id,
                        dstId: dst.node_id,
                        isLocalLink: isLocalLink,
                        latencies: []
                    };
                }
                if (dst.latency_ms !== undefined && dst.latency_ms !== null && !isNaN(dst.latency_ms)) {
                    linkMap[pairKey].latencies.push(Number(dst.latency_ms));
                }
            }
        }

        // 智能仲裁链路真实延迟：优先本地实测 RTT
        const linkKeys = Object.keys(linkMap);
        for (let k = 0; k < linkKeys.length; k++) {
            const link = linkMap[linkKeys[k]];
            const isLocal = (localNode && (String(link.srcId) === String(localNode.node_id) || String(link.dstId) === String(localNode.node_id)));
            const otherNodeId = (localNode && String(link.srcId) === String(localNode.node_id)) ? link.dstId : link.srcId;
            const otherNode = nodes.find(n => String(n.node_id) === String(otherNodeId));

            let resolvedLat = null;
            if (isLocal && otherNode) {
                const otherIp = otherNode.ipv4 ? String(otherNode.ipv4).trim().split('/')[0] : '';
                const otherHost = otherNode.hostname ? String(otherNode.hostname).trim() : '';
                if (otherIp && localPeerLatencyMap[otherIp] !== undefined) {
                    resolvedLat = localPeerLatencyMap[otherIp];
                } else if (otherHost && localPeerLatencyMap[otherHost] !== undefined) {
                    resolvedLat = localPeerLatencyMap[otherHost];
                }
            }

            if (resolvedLat === null && link.latencies && link.latencies.length > 0) {
                const validLats = link.latencies.filter(v => v > 0);
                if (validLats.length === 1) {
                    resolvedLat = validLats[0];
                } else if (validLats.length > 1) {
                    const realLats = validLats.filter(v => v > 2);
                    resolvedLat = Math.round((realLats.length > 0 ? realLats : validLats).reduce((a, b) => a + b, 0) / (realLats.length > 0 ? realLats.length : validLats.length));
                }
            }
            link.latency = resolvedLat;
        }

        // 标记中继节点与中间跳的连线为树状生成连通链路 (isRelayTreeLink)
        for (let i = 0; i < nodeCount; i++) {
            const n = nodes[i];
            const nIp = n.ipv4 ? String(n.ipv4).trim().split('/')[0] : '';
            const nHost = n.hostname ? String(n.hostname).trim() : '';
            const rInfo = peerRouteInfoMap[nIp] || peerRouteInfoMap[nHost];

            if (rInfo && rInfo.isRelay && rInfo.nextHopHost) {
                const midNode = nodes.find(m => {
                    const mH = m.hostname ? String(m.hostname).trim() : '';
                    const mIp = m.ipv4 ? String(m.ipv4).trim().split('/')[0] : '';
                    return (mH && mH.toLowerCase() === rInfo.nextHopHost.toLowerCase()) ||
                        (rInfo.nextHopIp && mIp === rInfo.nextHopIp.split('/')[0]);
                });

                if (midNode) {
                    const relayPairKey = [midNode.node_id, n.node_id].sort().join('---');
                    if (linkMap[relayPairKey]) {
                        linkMap[relayPairKey].isRelayTreeLink = true;
                    }
                }
            }
        }

        // 正方形雷达画布 (720 × 720)
        const width = 720;
        const height = 720;
        const cx = Math.round(width / 2);
        const cy = Math.round(height / 2);

        // 360° 逆时针延迟比例散射引擎
        const nodeMap = {};
        const simNodes = [];
        let peerNodes = [];
        let localSimNode = null;

        for (let i = 0; i < nodeCount; i++) {
            const n = nodes[i];
            const isLocal = (localNode && String(n.node_id) === String(localNode.node_id));

            let directLat = 999;
            if (!isLocal && localNode) {
                const pairKey = [n.node_id, localNode.node_id].sort().join('---');
                if (linkMap[pairKey] && linkMap[pairKey].latency !== null && linkMap[pairKey].latency !== undefined) {
                    directLat = Number(linkMap[pairKey].latency);
                }
            }

            let posX = null;
            let posY = null;
            if (topologyViewState.nodePositions && topologyViewState.nodePositions[n.node_id]) {
                posX = topologyViewState.nodePositions[n.node_id].x;
                posY = topologyViewState.nodePositions[n.node_id].y;
            }

            const sn = {
                id: String(n.node_id),
                node: n,
                x: posX !== null ? posX : cx,
                y: posY !== null ? posY : cy,
                radius: isLocal ? 28 : 24,
                isLocal: isLocal,
                directLat: directLat
            };

            nodeMap[sn.id] = sn;
            simNodes.push(sn);

            if (isLocal) localSimNode = sn;
            else peerNodes.push(sn);
        }

        // 自动排布：以本节点为中心，按延迟从小到大逆时针 360° 依次等比例散射展开
        const needLayout = simNodes.some(sn => !topologyViewState.nodePositions || !topologyViewState.nodePositions[sn.id]);

        if (needLayout) {
            if (localSimNode) {
                localSimNode.x = cx;
                localSimNode.y = cy;
            }

            peerNodes.sort((a, b) => a.directLat - b.directLat);

            const pCount = peerNodes.length;
            if (pCount > 0) {
                const startAngle = -Math.PI / 2; // 12 点钟方向
                const stepAngle = (2 * Math.PI) / pCount;

                for (let i = 0; i < pCount; i++) {
                    const sn = peerNodes[i];
                    const angle = startAngle - i * stepAngle; // 逆时针

                    let distR = 285;
                    if (sn.directLat < 900) {
                        if (sn.directLat <= 10) distR = 235;
                        else if (sn.directLat <= 60) distR = 250;
                        else if (sn.directLat <= 150) distR = 268;
                        else distR = 285;
                    }

                    sn.x = Math.round(cx + distR * Math.cos(angle));
                    sn.y = Math.round(cy + distR * Math.sin(angle));
                }
            }

            if (!topologyViewState.nodePositions) topologyViewState.nodePositions = {};
            for (let i = 0; i < nodeCount; i++) {
                const sn = simNodes[i];
                topologyViewState.nodePositions[sn.id] = { x: Math.round(sn.x), y: Math.round(sn.y) };
            }
        }

        const posMap = {};
        for (let i = 0; i < nodeCount; i++) {
            const sn = simNodes[i];
            posMap[sn.id] = {
                x: Math.round(topologyViewState.nodePositions && topologyViewState.nodePositions[sn.id] ? topologyViewState.nodePositions[sn.id].x : sn.x),
                y: Math.round(topologyViewState.nodePositions && topologyViewState.nodePositions[sn.id] ? topologyViewState.nodePositions[sn.id].y : sn.y)
            };
        }

        function getLatencyColor(lat) {
            if (lat === undefined || lat === null || isNaN(Number(lat))) {
                return { line: '#64748b', text: '#94a3b8', dash: '5,5', width: '1.5', opacity: '0.6' };
            }
            const val = Number(lat);
            if (val > 150) {
                return { line: '#f59e0b', text: '#fbbf24', dash: '5,5', width: '1.5', opacity: '0.85' };
            } else if (val >= 50) {
                return { line: '#38bdf8', text: '#7dd3fc', dash: '5,5', width: '1.5', opacity: '0.85' };
            } else {
                return { line: '#10b981', text: '#34d399', dash: '5,5', width: '1.5', opacity: '0.9' };
            }
        }

        function setLineVisual(el, strokeColor, strokeWidth, dashArray, opacityVal) {
            if (!el) return;
            el.setAttribute('stroke', strokeColor);
            el.style.setProperty('stroke', strokeColor, 'important');
            if (strokeWidth !== undefined && strokeWidth !== null) {
                el.setAttribute('stroke-width', strokeWidth);
                el.style.setProperty('stroke-width', strokeWidth + 'px', 'important');
            }
            if (dashArray !== undefined && dashArray !== null) {
                el.setAttribute('stroke-dasharray', dashArray);
                el.style.setProperty('stroke-dasharray', dashArray, 'important');
            }
            if (opacityVal !== undefined && opacityVal !== null) {
                el.setAttribute('opacity', opacityVal);
                el.style.setProperty('opacity', opacityVal, 'important');
            }
        }

        const lineElementsMap = {};
        const badgeElementsMap = {};
        const nodeElementsMap = {};

        // SVG Defs：高质感阴影
        const defsNode = createSvg('defs', {}, [
            createSvg('filter', {
                'id': 'node-shadow',
                'x': '-30%', 'y': '-30%', 'width': '160%', 'height': '160%'
            }, [
                createSvg('feDropShadow', {
                    'dx': '0', 'dy': '3', 'stdDeviation': '4',
                    'flood-color': '#000000', 'flood-opacity': '0.4'
                })
            ]),
            createSvg('filter', {
                'id': 'node-shadow-active',
                'x': '-50%', 'y': '-50%', 'width': '200%', 'height': '200%'
            }, [
                createSvg('feDropShadow', {
                    'dx': '0', 'dy': '5', 'stdDeviation': '8',
                    'flood-color': '#38bdf8', 'flood-opacity': '0.5'
                })
            ])
        ]);

        const linesLayer = [];
        const nodesLayer = [];
        const badgesLayer = [];

        let hoveredLinkId = null;
        let hoveredNodeId = null;
        let selectedNodeId = null;

        // 路径指示横幅
        const pathBanner = document.createElement('div');
        pathBanner.style.cssText = 'position: absolute; top: 14px; left: 14px; display: none; align-items: center; gap: 8px; padding: 7px 14px; background: rgba(15, 23, 42, 0.9); color: #f8fafc; font-size: 12px; font-weight: 600; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); z-index: 10; backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.1);';

        function traceRouteToNode(targetNodeId) {
            const res = { activePathLinks: {}, traceNodes: [], pathInfoText: '' };
            if (!targetNodeId) return res;

            const targetNode = nodes.find(n => String(n.node_id) === String(targetNodeId));
            if (!targetNode) return res;

            const isSelf = localNode && (String(targetNode.node_id) === String(localNode.node_id));
            const selIp = targetNode.ipv4 ? String(targetNode.ipv4).trim().split('/')[0] : '';
            const selHost = targetNode.hostname ? String(targetNode.hostname).trim() : '';
            const rInfo = peerRouteInfoMap[selIp] || peerRouteInfoMap[selHost] || {};

            if (isSelf) {
                res.pathInfoText = `本端节点: ${selHost || selIp}`;
                res.traceNodes = [targetNode];
                return res;
            }

            res.traceNodes = [targetNode];
            let curr = targetNode;
            const visited = {};
            visited[String(curr.node_id)] = true;

            while (curr && localNode && String(curr.node_id) !== String(localNode.node_id)) {
                const cIp = curr.ipv4 ? String(curr.ipv4).trim().split('/')[0] : '';
                const cHost = curr.hostname ? String(curr.hostname).trim() : '';
                const cInfo = peerRouteInfoMap[cIp] || peerRouteInfoMap[cHost];

                let nextNode = null;
                if (cInfo && cInfo.isRelay && cInfo.nextHopHost) {
                    nextNode = nodes.find(m => {
                        const mH = m.hostname ? String(m.hostname).trim() : '';
                        const mIp = m.ipv4 ? String(m.ipv4).trim().split('/')[0] : '';
                        return (mH && mH.toLowerCase() === cInfo.nextHopHost.toLowerCase()) ||
                            (cInfo.nextHopIp && mIp === cInfo.nextHopIp.split('/')[0]);
                    });
                } else {
                    nextNode = localNode;
                }

                if (!nextNode || visited[String(nextNode.node_id)]) {
                    if (curr !== localNode && localNode) {
                        const fallbackKey = [localNode.node_id, curr.node_id].sort().join('---');
                        res.activePathLinks[fallbackKey] = {
                            upstreamId: localNode.node_id,
                            downstreamId: curr.node_id
                        };
                        if (!visited[String(localNode.node_id)]) res.traceNodes.unshift(localNode);
                    }
                    break;
                }

                visited[String(nextNode.node_id)] = true;
                const pKey = [curr.node_id, nextNode.node_id].sort().join('---');
                res.activePathLinks[pKey] = {
                    upstreamId: nextNode.node_id,
                    downstreamId: curr.node_id
                };

                res.traceNodes.unshift(nextNode);
                curr = nextNode;
            }

            const nodeNames = res.traceNodes.map(n => {
                const isNLocal = (localNode && String(n.node_id) === String(localNode.node_id));
                const h = n.hostname ? String(n.hostname).trim() : (n.ipv4 ? String(n.ipv4).trim().split('/')[0] : 'Node');
                return isNLocal ? `${h} (本端)` : h;
            });

            const rawLat = rInfo.pathLatency || rInfo.latency;
            const latStr = formatLatency(rawLat);
            const hopCount = res.traceNodes.length - 1;
            const hopLabel = (hopCount > 1) ? ` (${hopCount} 跳 · ${latStr})` : (latStr !== '--' ? ` (${latStr})` : '');
            res.pathInfoText = nodeNames.join(' ➔ ') + hopLabel;
            return res;
        }

        function refreshLinkVisuals() {
            const activeTargetId = selectedNodeId || hoveredNodeId;
            const isFocusSelf = localNode && activeTargetId && (String(activeTargetId) === String(localNode.node_id));
            const routeDataRes = (!isFocusSelf && activeTargetId) ? traceRouteToNode(activeTargetId) : { activePathLinks: {}, traceNodes: [], pathInfoText: '' };
            const activePathLinks = routeDataRes.activePathLinks;
            let pathInfoText = routeDataRes.pathInfoText;
            if (isFocusSelf) {
                const selfHost = localNode.hostname ? String(localNode.hostname).trim() : (localNode.ipv4 || '本端');
                pathInfoText = `本端节点: ${selfHost}`;
            }

            if (pathInfoText && activeTargetId) {
                pathBanner.style.display = 'flex';
                pathBanner.innerHTML = `<span style="color: #94a3b8; margin-right: 4px;">路径:</span><span style="color: #f8fafc;">${escapeHtml(pathInfoText)}</span>`;
                if (selectedNodeId) {
                    const closeBtn = document.createElement('button');
                    closeBtn.type = 'button';
                    closeBtn.title = '清除选择';
                    closeBtn.style.cssText = 'margin-left: 8px; padding: 0 4px; background: transparent; border: none; color: #94a3b8; font-size: 14px; cursor: pointer;';
                    closeBtn.textContent = '×';
                    closeBtn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        selectedNodeId = null;
                        refreshLinkVisuals();
                    });
                    pathBanner.appendChild(closeBtn);
                }
            } else {
                pathBanner.style.display = 'none';
            }

            const hasActivePath = Object.keys(activePathLinks).length > 0;

            for (let k = 0; k < linkKeys.length; k++) {
                const lk = linkKeys[k];
                const link = linkMap[lk];
                const lineEl = lineElementsMap[lk];
                const badgeEl = badgeElementsMap[lk];
                if (!lineEl) continue;

                const isTreeLink = link.isLocalLink || link.isRelayTreeLink;
                const isRelayTree = link.isRelayTreeLink;
                const colorCfg = getLatencyColor(link.latency);
                const pathLinkInfo = activePathLinks[lk];

                if (hasActivePath) {
                    if (pathLinkInfo) {
                        lineEl.style.display = '';
                        setLineVisual(lineEl, '#f59e0b', '3.2', '8,4', '1.0');
                        lineEl.setAttribute('stroke-linecap', 'round');

                        const snUp = nodeMap[String(pathLinkInfo.upstreamId)];
                        const snDown = nodeMap[String(pathLinkInfo.downstreamId)];
                        const pUp = posMap[String(pathLinkInfo.upstreamId)];
                        const pDown = posMap[String(pathLinkInfo.downstreamId)];
                        if (snUp && snDown && pUp && pDown) {
                            const startPt = getCircleEdgePoint(pUp.x, pUp.y, pDown.x, pDown.y, snUp.radius);
                            const endPt = getCircleEdgePoint(pDown.x, pDown.y, pUp.x, pUp.y, snDown.radius);
                            lineEl.setAttribute('x1', startPt.x);
                            lineEl.setAttribute('y1', startPt.y);
                            lineEl.setAttribute('x2', endPt.x);
                            lineEl.setAttribute('y2', endPt.y);
                        }

                        lineEl.classList.add('et-path-flowing');
                        if (badgeEl) {
                            badgeEl.style.display = '';
                            badgeEl.style.opacity = '1.0';
                        }
                    } else {
                        lineEl.classList.remove('et-path-flowing');
                        lineEl.setAttribute('x1', lineEl._origX1);
                        lineEl.setAttribute('y1', lineEl._origY1);
                        lineEl.setAttribute('x2', lineEl._origX2);
                        lineEl.setAttribute('y2', lineEl._origY2);

                        if (!showAllLinks && !isTreeLink) {
                            lineEl.style.display = 'none';
                            if (badgeEl) badgeEl.style.display = 'none';
                        } else {
                            lineEl.style.display = '';
                            setLineVisual(lineEl, colorCfg.line, '1.0', colorCfg.dash, '0.08');
                            if (badgeEl) {
                                badgeEl.style.display = '';
                                badgeEl.style.opacity = '0.08';
                            }
                        }
                    }
                } else {
                    lineEl.classList.remove('et-path-flowing');
                    lineEl.setAttribute('x1', lineEl._origX1);
                    lineEl.setAttribute('y1', lineEl._origY1);
                    lineEl.setAttribute('x2', lineEl._origX2);
                    lineEl.setAttribute('y2', lineEl._origY2);

                    const isHoverFocused = (hoveredLinkId === lk) ||
                        (hoveredNodeId && (String(link.srcId) === String(hoveredNodeId) || String(link.dstId) === String(hoveredNodeId)));

                    if (!showAllLinks && !isTreeLink) {
                        lineEl.style.display = 'none';
                        if (badgeEl) badgeEl.style.display = 'none';
                    } else {
                        lineEl.style.display = '';
                        if (badgeEl) badgeEl.style.display = '';

                        if (isHoverFocused) {
                            setLineVisual(lineEl, isRelayTree ? '#f59e0b' : colorCfg.line, '2.8', isRelayTree ? '6,4' : 'none', '1.0');
                            if (badgeEl) badgeEl.style.opacity = '1.0';
                        } else if (hoveredLinkId !== null || hoveredNodeId !== null) {
                            setLineVisual(lineEl, isRelayTree ? '#f59e0b' : colorCfg.line, '1.2', colorCfg.dash, '0.12');
                            if (badgeEl) badgeEl.style.opacity = '0.12';
                        } else {
                            setLineVisual(lineEl, isRelayTree ? '#f59e0b' : colorCfg.line, isRelayTree ? '1.8' : colorCfg.width, isRelayTree ? '5,4' : colorCfg.dash, isRelayTree ? '0.9' : colorCfg.opacity);
                            if (badgeEl) badgeEl.style.opacity = '0.9';
                        }
                    }
                }
            }

            // 更新节点透明度
            for (let i = 0; i < nodeCount; i++) {
                const n = nodes[i];
                const cardG = nodeElementsMap[String(n.node_id)];
                if (!cardG) continue;

                if (hasActivePath) {
                    const isTarget = (String(n.node_id) === String(activeTargetId));
                    const isPathNode = isTarget ||
                        (localNode && String(n.node_id) === String(localNode.node_id)) ||
                        (Object.keys(activePathLinks).some(pk => {
                            const pl = linkMap[pk];
                            return pl && (String(pl.srcId) === String(n.node_id) || String(pl.dstId) === String(n.node_id));
                        }));

                    if (isPathNode) {
                        cardG.style.opacity = '1.0';
                        cardG.firstElementChild.setAttribute('filter', isTarget ? 'url(#node-shadow-active)' : 'url(#node-shadow)');
                    } else {
                        cardG.style.opacity = '0.35';
                        cardG.firstElementChild.setAttribute('filter', 'url(#node-shadow)');
                    }
                } else {
                    cardG.style.opacity = '1.0';
                    cardG.firstElementChild.setAttribute('filter', 'url(#node-shadow)');
                }
            }
        }

        // 1. 绘制链路连线
        for (let k = 0; k < linkKeys.length; k++) {
            const linkKey = linkKeys[k];
            const link = linkMap[linkKey];
            const p1 = posMap[String(link.srcId)];
            const p2 = posMap[String(link.dstId)];
            const sn1 = nodeMap[String(link.srcId)];
            const sn2 = nodeMap[String(link.dstId)];
            if (!p1 || !p2 || !sn1 || !sn2) continue;

            const startPt = getCircleEdgePoint(p1.x, p1.y, p2.x, p2.y, sn1.radius);
            const endPt = getCircleEdgePoint(p2.x, p2.y, p1.x, p1.y, sn2.radius);
            const colorCfg = getLatencyColor(link.latency);
            const isTreeLink = link.isLocalLink || link.isRelayTreeLink;
            const isRelayTree = link.isRelayTreeLink;
            const initDisplay = (!showAllLinks && !isTreeLink) ? 'none' : '';

            const lineInitStroke = isRelayTree ? '#f59e0b' : colorCfg.line;
            const lineInitWidth = isRelayTree ? '1.8' : colorCfg.width;
            const lineInitDash = isRelayTree ? '5,4' : colorCfg.dash;
            const lineInitOpacity = isRelayTree ? '0.9' : colorCfg.opacity;

            const lineSvg = createSvg('line', {
                'x1': startPt.x, 'y1': startPt.y,
                'x2': endPt.x, 'y2': endPt.y,
                'stroke': lineInitStroke,
                'stroke-width': lineInitWidth,
                'stroke-dasharray': lineInitDash,
                'stroke-linecap': 'round',
                'opacity': lineInitOpacity,
                'class': 'et-topo-link',
                'style': 'transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; display: ' + initDisplay + ';'
            });
            setLineVisual(lineSvg, lineInitStroke, lineInitWidth, lineInitDash, lineInitOpacity);
            lineSvg._origX1 = startPt.x;
            lineSvg._origY1 = startPt.y;
            lineSvg._origX2 = endPt.x;
            lineSvg._origY2 = endPt.y;

            (function(lk) {
                lineSvg.addEventListener('mouseenter', () => {
                    hoveredLinkId = lk;
                    refreshLinkVisuals();
                });
                lineSvg.addEventListener('mouseleave', () => {
                    if (hoveredLinkId === lk) {
                        hoveredLinkId = null;
                        refreshLinkVisuals();
                    }
                });
            })(linkKey);

            lineElementsMap[linkKey] = lineSvg;
            linesLayer.push(lineSvg);
        }

        // 2. 绘制节点
        let activeDraggingNodeId = null;
        let mouseStartX = 0;
        let mouseStartY = 0;

        for (let i = 0; i < nodeCount; i++) {
            const n = nodes[i];
            const sn = nodeMap[String(n.node_id)];
            const pos = posMap[String(n.node_id)];
            if (!pos || !sn) continue;

            const proxyList = (n.proxy_cidrs && String(n.proxy_cidrs).trim() !== '') ?
                String(n.proxy_cidrs).split(',').map(s => s.trim()).filter(Boolean) : [];
            const proxyCount = proxyList.length;

            const isSelf = sn.isLocal;
            const hostname = n.hostname ? String(n.hostname).trim() : 'Unknown';
            const ipv4 = n.ipv4 ? String(n.ipv4).trim() : '-';
            const titleStr = isSelf ? `${hostname} (本端)` : hostname;

            const nodeR = sn.radius;
            const circleColor = isSelf ? '#2563eb' : '#1e293b';
            const circleBorder = isSelf ? '#60a5fa' : '#475569';
            const borderWidth = isSelf ? '2.5' : '2';

            const gChildren = [];

            // 本端脉冲外光环
            if (isSelf) {
                gChildren.push(createSvg('circle', {
                    'r': '35',
                    'fill': 'none',
                    'stroke': '#38bdf8',
                    'stroke-width': '1.5',
                    'stroke-dasharray': '4,3',
                    'opacity': '0.85'
                }));
            }

            // 核心圆形徽标
            gChildren.push(createSvg('circle', {
                'r': nodeR,
                'fill': circleColor,
                'stroke': circleBorder,
                'stroke-width': borderWidth,
                'filter': 'url(#node-shadow)',
                'class': 'et-node-circle' + (isSelf ? ' is-local' : '')
            }));

            // 精美矢量图标
            if (isSelf) {
                gChildren.push(
                    createSvg('path', {
                        'd': 'M -9 -2 L 9 -2 L 7 7 L -7 7 Z',
                        'fill': 'none',
                        'stroke': '#ffffff',
                        'stroke-width': '1.8',
                        'stroke-linejoin': 'round'
                    }),
                    createSvg('circle', { 'cx': '-4', 'cy': '2.5', 'r': '1', 'fill': '#ffffff' }),
                    createSvg('circle', { 'cx': '0', 'cy': '2.5', 'r': '1', 'fill': '#ffffff' }),
                    createSvg('circle', { 'cx': '4', 'cy': '2.5', 'r': '1', 'fill': '#ffffff' }),
                    createSvg('line', { 'x1': '-5', 'y1': '-2', 'x2': '-8', 'y2': '-8', 'stroke': '#ffffff', 'stroke-width': '1.8', 'stroke-linecap': 'round' }),
                    createSvg('line', { 'x1': '5', 'y1': '-2', 'x2': '8', 'y2': '-8', 'stroke': '#ffffff', 'stroke-width': '1.8', 'stroke-linecap': 'round' })
                );
            } else {
                gChildren.push(
                    createSvg('rect', { 'x': '-9', 'y': '-8', 'width': '18', 'height': '6.5', 'rx': '1.5', 'fill': '#0f172a', 'stroke': '#64748b', 'stroke-width': '1.5' }),
                    createSvg('rect', { 'x': '-9', 'y': '1.5', 'width': '18', 'height': '6.5', 'rx': '1.5', 'fill': '#0f172a', 'stroke': '#64748b', 'stroke-width': '1.5' }),
                    createSvg('circle', { 'cx': '5', 'cy': '-4.7', 'r': '1', 'fill': '#10b981' }),
                    createSvg('circle', { 'cx': '5', 'cy': '4.8', 'r': '1', 'fill': '#10b981' }),
                    createSvg('circle', { 'cx': '16', 'cy': '-16', 'r': '4', 'fill': '#10b981', 'stroke': '#0f172a', 'stroke-width': '1.5' })
                );
            }

            // 文字标签（主机名 + 虚拟 IP）
            const titleColor = isSelf ? '#93c5fd' : '#f8fafc';
            const ipColor = isSelf ? '#60a5fa' : '#94a3b8';

            gChildren.push(
                createSvg('text', {
                    'x': 0, 'y': nodeR + 15,
                    'text-anchor': 'middle',
                    'font-family': 'sans-serif',
                    'font-size': '11.5',
                    'font-weight': isSelf ? 'bold' : '600',
                    'fill': titleColor
                }, titleStr),
                createSvg('text', {
                    'x': 0, 'y': nodeR + 29,
                    'text-anchor': 'middle',
                    'font-family': 'var(--font-mono)',
                    'font-size': '10',
                    'font-weight': isSelf ? 'bold' : 'normal',
                    'fill': ipColor
                }, ipv4)
            );

            // 代理子网标签
            if (proxyCount > 0) {
                for (let pIdx = 0; pIdx < proxyCount; pIdx++) {
                    const badgeY = nodeR + 35 + pIdx * 16;
                    const labelText = proxyList[pIdx];
                    const bw = Math.max(90, labelText.length * 6.5 + 12);
                    gChildren.push(
                        createSvg('rect', {
                            'x': -bw / 2, 'y': badgeY,
                            'width': bw, 'height': '14', 'rx': '3',
                            'fill': '#ecfdf5', 'stroke': '#a7f3d0', 'stroke-width': '1'
                        }),
                        createSvg('text', {
                            'x': 0, 'y': badgeY + 10,
                            'text-anchor': 'middle',
                            'font-family': 'var(--font-mono)',
                            'font-size': '9', 'font-weight': '600',
                            'fill': '#047857'
                        }, labelText)
                    );
                }
            }

            const cardG = createSvg('g', {
                'transform': `translate(${pos.x},${pos.y})`,
                'style': 'cursor: pointer; user-select: none; transition: filter 0.15s;'
            }, gChildren);

            // 节点交互
            (function(nodeId, gEl) {
                let isDragMoved = false;
                gEl.addEventListener('mouseenter', () => {
                    if (!activeDraggingNodeId) {
                        hoveredNodeId = nodeId;
                        refreshLinkVisuals();
                    }
                });
                gEl.addEventListener('mouseleave', () => {
                    if (!activeDraggingNodeId && hoveredNodeId === nodeId) {
                        hoveredNodeId = null;
                        refreshLinkVisuals();
                    }
                });
                gEl.addEventListener('mousedown', (ev) => {
                    if (ev.button !== 0) return;
                    ev.stopPropagation();
                    activeDraggingNodeId = nodeId;
                    isDragMoved = false;
                    mouseStartX = ev.clientX;
                    mouseStartY = ev.clientY;
                    gEl.style.cursor = 'grabbing';
                    gEl.firstElementChild.setAttribute('filter', 'url(#node-shadow-active)');
                });
                gEl.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (isDragMoved) return;
                    selectedNodeId = (selectedNodeId === nodeId) ? null : nodeId;
                    refreshLinkVisuals();
                });
            })(n.node_id, cardG);

            nodeElementsMap[String(n.node_id)] = cardG;
            nodesLayer.push(cardG);
        }

        // 3. 绘制延迟胶囊标签
        for (let k = 0; k < linkKeys.length; k++) {
            const linkKey = linkKeys[k];
            const link = linkMap[linkKey];
            const p1 = posMap[String(link.srcId)];
            const p2 = posMap[String(link.dstId)];
            const sn1 = nodeMap[String(link.srcId)];
            const sn2 = nodeMap[String(link.dstId)];
            if (!p1 || !p2 || !sn1 || !sn2) continue;

            const lat = link.latency;
            if (lat !== undefined && lat !== null) {
                const startPt = getCircleEdgePoint(p1.x, p1.y, p2.x, p2.y, sn1.radius);
                const endPt = getCircleEdgePoint(p2.x, p2.y, p1.x, p1.y, sn2.radius);
                const mx = Math.round((startPt.x + endPt.x) / 2);
                const my = Math.round((startPt.y + endPt.y) / 2);

                const colorCfg = getLatencyColor(lat);
                const labelStr = formatLatency(lat);

                const textSvg = createSvg('text', {
                    'x': 0, 'y': 4,
                    'text-anchor': 'middle',
                    'font-family': 'var(--font-mono)',
                    'font-size': '11', 'font-weight': '700',
                    'fill': colorCfg.text
                }, labelStr);

                const isTreeLink = link.isLocalLink || link.isRelayTreeLink;
                const initDisplay = (!showAllLinks && !isTreeLink) ? 'none' : '';
                const badgeW = Math.max(36, labelStr.length * 7.2 + 10);
                const badgeH = 18;

                const badgeG = createSvg('g', {
                    'transform': `translate(${mx},${my})`,
                    'style': `cursor: pointer; opacity: 0.9; transition: opacity 0.2s; display: ${initDisplay};`
                }, [
                    createSvg('rect', {
                        'x': -badgeW / 2, 'y': -badgeH / 2,
                        'width': badgeW, 'height': badgeH, 'rx': '9',
                        'fill': '#0f172a', 'stroke': colorCfg.line,
                        'stroke-width': '1.2', 'filter': 'url(#node-shadow)'
                    }),
                    textSvg
                ]);

                (function(lk) {
                    badgeG.addEventListener('mouseenter', () => {
                        hoveredLinkId = lk;
                        refreshLinkVisuals();
                    });
                    badgeG.addEventListener('mouseleave', () => {
                        if (hoveredLinkId === lk) {
                            hoveredLinkId = null;
                            refreshLinkVisuals();
                        }
                    });
                })(linkKey);

                badgeElementsMap[linkKey] = badgeG;
                badgesLayer.push(badgeG);
            }
        }

        // 边几何位置动态更新
        function updateEdgeGeometry(linkKey) {
            const link = linkMap[linkKey];
            if (!link) return;
            const p1 = posMap[String(link.srcId)];
            const p2 = posMap[String(link.dstId)];
            const sn1 = nodeMap[String(link.srcId)];
            const sn2 = nodeMap[String(link.dstId)];
            if (!p1 || !p2 || !sn1 || !sn2) return;

            const startPt = getCircleEdgePoint(p1.x, p1.y, p2.x, p2.y, sn1.radius);
            const endPt = getCircleEdgePoint(p2.x, p2.y, p1.x, p1.y, sn2.radius);

            const lineEl = lineElementsMap[linkKey];
            if (lineEl) {
                lineEl.setAttribute('x1', startPt.x);
                lineEl.setAttribute('y1', startPt.y);
                lineEl.setAttribute('x2', endPt.x);
                lineEl.setAttribute('y2', endPt.y);
                lineEl._origX1 = startPt.x;
                lineEl._origY1 = startPt.y;
                lineEl._origX2 = endPt.x;
                lineEl._origY2 = endPt.y;
            }

            const badgeEl = badgeElementsMap[linkKey];
            if (badgeEl) {
                const mx = Math.round((startPt.x + endPt.x) / 2);
                const my = Math.round((startPt.y + endPt.y) / 2);
                badgeEl.setAttribute('transform', `translate(${mx},${my})`);
            }
        }

        const allElements = [defsNode].concat(linesLayer, badgesLayer, nodesLayer);

        const svgNode = createSvg('svg', {
            'id': 'easytier-topo-svg',
            'viewBox': `0 0 ${width} ${height}`,
            'style': 'width: 100%; height: 100%; display: block; margin: 0 auto; user-select: none; background: transparent; cursor: default;'
        }, allElements);

        let currentScale = topologyViewState.scale || 1.0;
        let panX = topologyViewState.panX || 0;
        let panY = topologyViewState.panY || 0;
        let isCanvasDragging = false;
        let canvasDragStartX = 0;
        let canvasDragStartY = 0;

        function applyViewBox() {
            topologyViewState.scale = currentScale;
            topologyViewState.panX = panX;
            topologyViewState.panY = panY;
            const vbW = width / currentScale;
            const vbH = height / currentScale;
            const vbX = (width - vbW) / 2 - (panX / currentScale);
            const vbY = (height - vbH) / 2 - (panY / currentScale);
            svgNode.setAttribute('viewBox', `${Math.round(vbX)} ${Math.round(vbY)} ${Math.round(vbW)} ${Math.round(vbH)}`);
        }

        applyViewBox();
        refreshLinkVisuals();

        svgNode.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            const zoomFactor = ev.deltaY < 0 ? 1.15 : 0.85;
            currentScale = Math.min(3.5, Math.max(0.35, currentScale * zoomFactor));
            applyViewBox();
        }, { passive: false });

        svgNode.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0 || activeDraggingNodeId) return;
            isCanvasDragging = true;
            canvasDragStartX = ev.clientX - panX;
            canvasDragStartY = ev.clientY - panY;
            svgNode.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (ev) => {
            if (activeDraggingNodeId) {
                const dx = (ev.clientX - mouseStartX) / currentScale;
                const dy = (ev.clientY - mouseStartY) / currentScale;
                mouseStartX = ev.clientX;
                mouseStartY = ev.clientY;

                const pos = posMap[activeDraggingNodeId];
                if (pos) {
                    pos.x = Math.round(pos.x + dx);
                    pos.y = Math.round(pos.y + dy);
                    if (!topologyViewState.nodePositions) topologyViewState.nodePositions = {};
                    topologyViewState.nodePositions[activeDraggingNodeId] = { x: pos.x, y: pos.y };

                    const cardEl = nodeElementsMap[activeDraggingNodeId];
                    if (cardEl) {
                        cardEl.setAttribute('transform', `translate(${pos.x},${pos.y})`);
                    }

                    for (let k = 0; k < linkKeys.length; k++) {
                        const lk = linkMap[linkKeys[k]];
                        if (String(lk.srcId) === String(activeDraggingNodeId) || String(lk.dstId) === String(activeDraggingNodeId)) {
                            updateEdgeGeometry(linkKeys[k]);
                        }
                    }
                }
                return;
            }

            if (isCanvasDragging) {
                panX = ev.clientX - canvasDragStartX;
                panY = ev.clientY - canvasDragStartY;
                applyViewBox();
            }
        });

        window.addEventListener('mouseup', () => {
            if (activeDraggingNodeId) {
                const cardEl = nodeElementsMap[activeDraggingNodeId];
                if (cardEl) {
                    cardEl.style.cursor = 'pointer';
                    cardEl.firstElementChild.setAttribute('filter', 'url(#node-shadow)');
                }
                activeDraggingNodeId = null;
            }
            if (isCanvasDragging) {
                isCanvasDragging = false;
                svgNode.style.cursor = 'default';
            }
        });

        // 浮动工具栏
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'position: absolute; top: 14px; right: 14px; display: flex; gap: 6px; z-index: 10;';

        const btnStyle = 'display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; font-size: 13px; font-weight: bold; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: pointer; user-select: none; transition: all 0.15s;';

        const toggleLinksBtn = document.createElement('button');
        toggleLinksBtn.type = 'button';
        toggleLinksBtn.className = 'btn et-btn-toolbar' + (showAllLinks ? ' active' : '');
        toggleLinksBtn.style.cssText = `${btnStyle} width: auto; padding: 0 10px; font-size: 12px;` + (showAllLinks ? ' background: #2563eb !important; border-color: #3b82f6 !important;' : '');
        toggleLinksBtn.textContent = showAllLinks ? '全部链路' : '仅直连';
        toggleLinksBtn.title = showAllLinks ? '点击仅显示直连' : '点击显示全网对端连线';
        toggleLinksBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            topologyViewState.showAllLinks = !topologyViewState.showAllLinks;
            renderCurrentTopology();
        });

        const zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.className = 'btn et-btn-toolbar';
        zoomInBtn.style.cssText = btnStyle;
        zoomInBtn.textContent = '+';
        zoomInBtn.title = '放大视图';
        zoomInBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            currentScale = Math.min(3.5, currentScale * 1.25);
            applyViewBox();
        });

        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.className = 'btn et-btn-toolbar';
        zoomOutBtn.style.cssText = btnStyle;
        zoomOutBtn.textContent = '−';
        zoomOutBtn.title = '缩小视图';
        zoomOutBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            currentScale = Math.max(0.35, currentScale * 0.8);
            applyViewBox();
        });

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'btn et-btn-toolbar';
        resetBtn.style.cssText = `${btnStyle} width: auto; padding: 0 8px; font-size: 11px;`;
        resetBtn.textContent = '1:1';
        resetBtn.title = '复位视口';
        resetBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            currentScale = 1.0;
            panX = 0;
            panY = 0;
            applyViewBox();
        });

        const resetLayoutBtn = document.createElement('button');
        resetLayoutBtn.type = 'button';
        resetLayoutBtn.className = 'btn et-btn-toolbar';
        resetLayoutBtn.style.cssText = `${btnStyle} width: auto; padding: 0 8px; font-size: 13px;`;
        resetLayoutBtn.textContent = '⟲';
        resetLayoutBtn.title = '重置节点布局位置';
        resetLayoutBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            topologyViewState.nodePositions = {};
            topologyViewState.scale = 1.0;
            topologyViewState.panX = 0;
            topologyViewState.panY = 0;
            renderCurrentTopology();
        });

        toolbar.appendChild(toggleLinksBtn);
        toolbar.appendChild(zoomInBtn);
        toolbar.appendChild(zoomOutBtn);
        toolbar.appendChild(resetBtn);
        toolbar.appendChild(resetLayoutBtn);

        svgNode.addEventListener('click', () => {
            if (selectedNodeId) {
                selectedNodeId = null;
                refreshLinkVisuals();
            }
        });

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position: relative; width: 100%; height: 100%;';
        wrapper.appendChild(pathBanner);
        wrapper.appendChild(toolbar);
        wrapper.appendChild(svgNode);

        return wrapper;
    }

    const btnRefreshTopo = document.getElementById('btnRefreshTopo');
    if (btnRefreshTopo) {
        btnRefreshTopo.addEventListener('click', () => {
            fetchStatus();
            showToast('全网拓扑已刷新');
        });
    }

    // 初始化
    fetchStatus();
    fetchConfig();

    // 定时轮询
    pollTimer = setInterval(fetchStatus, 5000);
    logPollTimer = setInterval(() => {
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.getAttribute('data-tab') === 'logs') {
            fetchLogs();
        }
    }, 4000);
});
