<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

// 校验 QNAP NAS 登录状态
function verifyQNAPSession() {
    if (getenv('EASYTIER_DEV_MODE') === 'true') {
        return true;
    }

    // 0. 优先复用本 Session 已通过鉴权的会话 (5分钟内有效)
    if (!empty($_SESSION['qnap_sid']) && !empty($_SESSION['qnap_auth_time']) && (time() - $_SESSION['qnap_auth_time'] < 300)) {
        return true;
    }

    // 1. 获取候选 SID
    $sid = $_COOKIE['NAS_SID'] ?? $_GET['sid'] ?? $_POST['sid'] ?? ($_SESSION['qnap_sid'] ?? '');
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

    // 2. 请求 QTS 内部 CGI 校验
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
            $_SESSION['qnap_sid'] = $sid;
            $_SESSION['qnap_auth_time'] = time();
            return true;
        }
    }

    // 3. 兼容旧版 QTS 4.x
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

if (!verifyQNAPSession()) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => '未授权：请先登录 QNAP QTS 系统']);
    exit;
}

$baseDir = dirname(__DIR__);
$configDir = $baseDir . '/configs';
$configFile = $configDir . '/easytier.conf';
$tomlFile = $configDir . '/easytier.toml';
$stateFile = $configDir . '/state.json';
$logFile = $baseDir . '/easytier.log';
$manageScript = $baseDir . '/easytier.sh';

// 自动探测并读取 QNAP NAS 系统主机名
function getNASHostname() {
    // 1. 尝试读取 QNAP 权威配置 uLinux.conf 中的 Server Name
    if (file_exists('/etc/config/uLinux.conf') && is_executable('/sbin/getcfg')) {
        $qnapName = trim(shell_exec('/sbin/getcfg System "Server Name" -f /etc/config/uLinux.conf 2>/dev/null') ?? '');
        if (!empty($qnapName)) {
            return preg_replace('/[^a-zA-Z0-9_\-]/', '', $qnapName);
        }
    }
    // 2. 尝试读取系统主机名
    $h = gethostname();
    if (!empty($h)) {
        return preg_replace('/[^a-zA-Z0-9_\-]/', '', $h);
    }
    $h = trim(shell_exec('hostname 2>/dev/null') ?? '');
    if (!empty($h)) {
        return preg_replace('/[^a-zA-Z0-9_\-]/', '', $h);
    }
    return 'qnap-easytier';
}

// 原子安全文件写入（优先临时文件原子替换，降级直接写入，增强容错）
function atomicWrite($filePath, $content) {
    $dir = dirname($filePath);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    @chmod($dir, 0777);

    // 1. 优先采用原子临时文件替换
    $tempFile = $filePath . '.' . uniqid('tmp_', true);
    if (@file_put_contents($tempFile, $content, LOCK_EX) !== false) {
        @chmod($tempFile, 0666);
        if (@rename($tempFile, $filePath)) {
            return true;
        }
        @unlink($tempFile);
    }

    // 2. 降级保底：直接写入目标文件
    if (@file_put_contents($filePath, $content, LOCK_EX) !== false) {
        @chmod($filePath, 0666);
        return true;
    }

    return false;
}

// 生成 TOML 配置内容
function generateToml(array $conf) {
    $instName = !empty($conf['instance_name']) ? $conf['instance_name'] : getNASHostname();
    $toml = "# Generated automatically by EasyTier QNAP WebUI\n";
    $toml .= 'instance_name = "' . addslashes($instName) . "\"\n";
    
    if (!empty($conf['dhcp'])) {
        $toml .= "dhcp = true\n";
    } else {
        $toml .= "dhcp = false\n";
        if (!empty($conf['ipv4'])) {
            $toml .= 'ipv4 = "' . addslashes($conf['ipv4']) . "\"\n";
        }
    }

    $toml .= "listeners = [\n";
    if (!empty($conf['listeners']) && is_array($conf['listeners'])) {
        foreach ($conf['listeners'] as $l) {
            $l = trim($l);
            if (!empty($l)) {
                $toml .= '    "' . addslashes($l) . "\",\n";
            }
        }
    }
    $toml .= "]\n";

    $rpc = !empty($conf['rpc_portal']) ? $conf['rpc_portal'] : '127.0.0.1:15888';
    $toml .= 'rpc_portal = "' . addslashes($rpc) . "\"\n\n";

    $toml .= "peer = [\n";
    if (!empty($conf['peers']) && is_array($conf['peers'])) {
        foreach ($conf['peers'] as $p) {
            $p = trim($p);
            if (!empty($p)) {
                $toml .= '    { uri = "' . addslashes($p) . "\" },\n";
            }
        }
    }
    $toml .= "]\n\n";

    $toml .= "[network_identity]\n";
    $toml .= 'network_name = "' . addslashes($conf['network_name'] ?? 'easytier') . "\"\n";
    $toml .= 'network_secret = "' . addslashes($conf['network_secret'] ?? '') . "\"\n\n";

    if (!empty($conf['proxy_networks']) && is_array($conf['proxy_networks'])) {
        $validProxies = array_filter(array_map('trim', $conf['proxy_networks']));
        foreach ($validProxies as $pn) {
            $toml .= "[[proxy_network]]\n";
            $toml .= 'cidr = "' . addslashes($pn) . "\"\n\n";
        }
    }

    $toml .= "[flags]\n";
    $dev = !empty($conf['dev_name']) ? $conf['dev_name'] : 'et0';
    $toml .= 'dev_name = "' . addslashes($dev) . "\"\n";

    return $toml;
}

$action = $_GET['action'] ?? ($_POST['action'] ?? '');

switch ($action) {
    case 'get_status':
        $pid = trim(shell_exec('pidof easytier-core 2>/dev/null') ?? '');
        $running = !empty($pid);
        
        $state = [
            'running' => $running,
            'pid' => $pid,
            'version' => '',
            'dev_name' => 'et0',
            'ipv4' => '',
            'peers' => [],
            'routes' => [],
            'node_info' => null
        ];

        if (file_exists($stateFile)) {
            $savedState = json_decode(file_get_contents($stateFile), true);
            if (is_array($savedState)) {
                $state = array_merge($state, $savedState);
                $state['running'] = $running;
                $state['pid'] = $pid;
            }
        }

        // 若服务在运行中，尝试调用 CLI 获取实时数据
        if ($running) {
            $cliBin = file_exists($baseDir . '/easytier-cli') ? $baseDir . '/easytier-cli' : 'easytier-cli';
            
            // 查询版本
            $verOut = shell_exec("$cliBin --version 2>/dev/null");
            if (!empty($verOut) && preg_match('/(\d+\.\d+(?:\.\d+)?)/', $verOut, $vm)) {
                $state['version'] = $vm[1];
            }
        }

        if (empty($state['version'])) {
            $verFile = $baseDir . '/version';
            if (file_exists($verFile)) {
                $rawVer = trim(file_get_contents($verFile));
                if (preg_match('/(\d+\.\d+(?:\.\d+)?)/', $rawVer, $vm)) {
                    $state['version'] = $vm[1];
                } else {
                    $state['version'] = '2.6.4';
                }
            } else {
                $state['version'] = '2.6.4';
            }
        }

        if ($running) {
            $cliBin = file_exists($baseDir . '/easytier-cli') ? $baseDir . '/easytier-cli' : 'easytier-cli';

            // 查询对端节点列表 (EasyTier 2.6.x 输出为 Markdown 表格)
            $peersOut = shell_exec("$cliBin peer 2>/dev/null");
            $peersList = [];
            if (!empty($peersOut)) {
                $lines = explode("\n", trim($peersOut));
                foreach ($lines as $line) {
                    $line = trim($line);
                    // 彻底过滤空行、分割线与各类表头关键字行
                    if (empty($line) 
                        || strpos($line, '---') !== false 
                        || stripos($line, 'tunnel') !== false 
                        || stripos($line, 'latency') !== false 
                        || stripos($line, 'peer_id') !== false
                        || preg_match('/\|\s*ipv4\s*\|/i', $line)) {
                        continue;
                    }
                    // 规范切分 Markdown 表格列，保留空格占位的空列，防止串位
                    $cleanLine = trim($line);
                    if (substr($cleanLine, 0, 1) === '|') {
                        $cleanLine = substr($cleanLine, 1);
                    }
                    if (substr($cleanLine, -1) === '|') {
                        $cleanLine = substr($cleanLine, 0, -1);
                    }
                    $cols = array_map('trim', explode('|', $cleanLine));

                    // 标准输出依次包含：ipv4, hostname, cost, lat, loss, rx, tx, tunnel, NAT, version
                    if (count($cols) >= 3) {
                        $costVal = $cols[2] ?? '--';
                        // 过滤本地节点自身 (Local)，提取本节点信息给控制台顶栏，不混入对端列表
                        if (strcasecmp($costVal, 'local') === 0) {
                            $state['local_node'] = [
                                'ipv4' => $cols[0] ?? '',
                                'hostname' => $cols[1] ?? '',
                                'version' => $cols[9] ?? ''
                            ];
                            if (empty($state['ipv4']) && !empty($cols[0])) {
                                $state['ipv4'] = $cols[0];
                            }
                            continue;
                        }

                        $peersList[] = [
                            'ipv4' => !empty($cols[0]) ? $cols[0] : '--',
                            'hostname' => !empty($cols[1]) ? $cols[1] : '--',
                            'cost' => !empty($cols[2]) ? $cols[2] : '--',
                            'latency' => !empty($cols[3]) ? $cols[3] : '--',
                            'loss' => !empty($cols[4]) ? $cols[4] : '0.0%',
                            'rx' => !empty($cols[5]) ? $cols[5] : '0 B',
                            'tx' => !empty($cols[6]) ? $cols[6] : '0 B',
                            'tunnel' => $cols[7] ?? '',
                            'nat' => $cols[8] ?? '',
                            'version' => $cols[9] ?? ''
                        ];
                    }
                }
            }
            $state['peers'] = $peersList;

            // 查询路由 (EasyTier 2.6.x 格式: ipv4 | hostname | proxy_cidrs | next_hop_ipv4 | next_hop_hostname | next_hop_lat | path_len | path_latency | ...)
            $routeOut = shell_exec("$cliBin route 2>/dev/null");
            $routesList = [];
            $localProxyCidr = '';
            if (!empty($routeOut)) {
                $lines = explode("\n", trim($routeOut));
                foreach ($lines as $line) {
                    $line = trim($line);
                    // 彻底过滤空行、分割线以及包含路由表头关键字的行
                    if (empty($line) 
                        || strpos($line, '---') !== false 
                        || stripos($line, 'proxy_cidrs') !== false 
                        || stripos($line, 'next_hop') !== false 
                        || stripos($line, 'destination') !== false
                        || preg_match('/\|\s*ipv4\s*\|/i', $line)) {
                        continue;
                    }

                    // 规范切分 Markdown 表格列，保留空代理子网列，绝不串位
                    $cleanLine = trim($line);
                    if (substr($cleanLine, 0, 1) === '|') {
                        $cleanLine = substr($cleanLine, 1);
                    }
                    if (substr($cleanLine, -1) === '|') {
                        $cleanLine = substr($cleanLine, 0, -1);
                    }
                    $cols = array_map('trim', explode('|', $cleanLine));

                    if (count($cols) >= 5) {
                        $nextHopIp = $cols[3] ?? '';
                        $nextHopHost = $cols[4] ?? '';
                        // 提取本地自身节点 (Local 或 -) 的代理网段并注入 local_node，同时不混入对外转发路由列表
                        if (strcasecmp($nextHopIp, 'local') === 0 || strcasecmp($nextHopHost, 'local') === 0 || $nextHopIp === '-') {
                            $localProxy = (!empty($cols[2]) && $cols[2] !== '-') ? $cols[2] : '';
                            if (!empty($localProxy)) {
                                $localProxyCidr = $localProxy;
                                if (!isset($state['local_node'])) $state['local_node'] = [];
                                $state['local_node']['proxy_cidrs'] = $localProxy;
                            }
                            continue;
                        }

                        $pathLen = $cols[6] ?? '';
                        $pathLat = $cols[7] ?? ($cols[5] ?? '');
                        $costHops = ($pathLen !== '' && is_numeric($pathLen)) ? intval($pathLen) : null;
                        $costLat = (is_numeric($pathLat) && floatval($pathLat) >= 0) ? round(floatval($pathLat), 1) : null;

                        $costStr = '--';
                        if ($costHops !== null) {
                            $costStr = ($costLat !== null) ? "{$costHops} 跳 ({$costLat}ms)" : "{$costHops} 跳";
                        }

                        $routesList[] = [
                            'destination' => !empty($cols[0]) ? $cols[0] : '--',
                            'hostname' => !empty($cols[1]) ? $cols[1] : '--',
                            'proxy_cidrs' => (!empty($cols[2]) && $cols[2] !== '-') ? $cols[2] : '--',
                            'next_hop_ipv4' => !empty($cols[3]) ? $cols[3] : '--',
                            'next_hop_hostname' => !empty($cols[4]) ? $cols[4] : '--',
                            'cost' => $costStr,
                            'cost_hops' => $costHops,
                            'cost_lat' => $costLat
                        ];
                    }
                }
            }
            $state['routes'] = $routesList;

            // 查询全网拓扑节点信息 (EasyTier peer-center)
            $topoOut = shell_exec("$cliBin -o json peer-center 2>/dev/null");
            $topoNodes = [];
            if (!empty($topoOut)) {
                $jsonNodes = json_decode($topoOut, true);
                if (is_array($jsonNodes)) {
                    $topoNodes = $jsonNodes;
                }
            }

            // 若 peer-center 未获取到完整 JSON，降级使用现有的 routes 与 peers 生成直连拓扑
            if (empty($topoNodes) && !empty($peersList)) {
                $localId = '1';
                $localIp = $state['ipv4'] ?: ($state['local_node']['ipv4'] ?? '10.144.144.1');
                $localHost = $state['local_node']['hostname'] ?? getNASHostname();

                $directPeers = [];
                $nodeIdx = 2;
                foreach ($peersList as $p) {
                    $pIp = explode('/', $p['ipv4'])[0];
                    $pLat = floatval(preg_replace('/[^0-9.]/', '', $p['latency'] ?? '0'));
                    $pId = strval($nodeIdx++);
                    $directPeers[] = [
                        'node_id' => $pId,
                        'hostname' => $p['hostname'],
                        'ipv4' => $p['ipv4'],
                        'latency_ms' => $pLat > 0 ? $pLat : null
                    ];
                    $topoNodes[] = [
                        'node_id' => $pId,
                        'hostname' => $p['hostname'],
                        'ipv4' => $p['ipv4'],
                        'proxy_cidrs' => '',
                        'direct_peers' => [
                            [
                                'node_id' => $localId,
                                'hostname' => $localHost,
                                'latency_ms' => $pLat > 0 ? $pLat : null
                            ]
                        ]
                    ];
                }

                array_unshift($topoNodes, [
                    'node_id' => $localId,
                    'hostname' => $localHost,
                    'ipv4' => $localIp,
                    'proxy_cidrs' => $localProxyCidr,
                    'direct_peers' => $directPeers
                ]);
            }

            // 融合路由表中的 proxy_cidrs 到各个拓扑节点
            if (!empty($topoNodes)) {
                $routeProxyMap = [];
                if (!empty($routesList)) {
                    foreach ($routesList as $r) {
                        $ipClean = explode('/', $r['destination'] ?? '')[0];
                        $host = $r['hostname'] ?? '';
                        $p = $r['proxy_cidrs'] ?? '';
                        if (!empty($p) && $p !== '--') {
                            if (!empty($ipClean)) $routeProxyMap[$ipClean] = $p;
                            if (!empty($host)) $routeProxyMap[$host] = $p;
                        }
                    }
                }

                // 融合本地节点的代理网段映射
                if (!empty($localProxyCidr)) {
                    $myIp = explode('/', $state['ipv4'] ?? ($state['local_node']['ipv4'] ?? ''))[0];
                    $myHost = $state['local_node']['hostname'] ?? '';
                    if (!empty($myIp)) $routeProxyMap[$myIp] = $localProxyCidr;
                    if (!empty($myHost)) $routeProxyMap[$myHost] = $localProxyCidr;
                }

                foreach ($topoNodes as &$tn) {
                    $tIp = explode('/', $tn['ipv4'] ?? '')[0];
                    $tHost = $tn['hostname'] ?? '';
                    if (empty($tn['proxy_cidrs'])) {
                        $tn['proxy_cidrs'] = $routeProxyMap[$tIp] ?? ($routeProxyMap[$tHost] ?? '');
                    }
                }
                unset($tn);
            }

            $state['topology'] = $topoNodes;
        }

        echo json_encode(['success' => true, 'data' => $state]);
        break;

    case 'get_topology':
        $cliBin = file_exists($baseDir . '/easytier-cli') ? $baseDir . '/easytier-cli' : 'easytier-cli';
        $topoOut = shell_exec("$cliBin -o json peer-center 2>/dev/null");
        $topoNodes = [];
        if (!empty($topoOut)) {
            $jsonNodes = json_decode($topoOut, true);
            if (is_array($jsonNodes)) {
                $topoNodes = $jsonNodes;
            }
        }
        echo json_encode(['success' => true, 'data' => ['nodes' => $topoNodes]]);
        break;

    case 'get_config':
        $defaultHost = getNASHostname();
        $defaultConfig = [
            'enabled' => 1,
            'autostart' => 1,
            'instance_name' => $defaultHost,
            'ipv4' => '',
            'dhcp' => true,
            'network_name' => 'easytier',
            'network_secret' => '',
            'peers' => ['tcp://public.easytier.top:11010'],
            'listeners' => ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'],
            'rpc_portal' => '127.0.0.1:15888',
            'dev_name' => 'et0',
            'proxy_networks' => [],
            'custom_flags' => ''
        ];

        $sysPersistDir = '/etc/config/easytier';
        $targetFile = file_exists($configFile) ? $configFile : ($sysPersistDir . '/easytier.conf');

        if (file_exists($targetFile)) {
            $data = json_decode(file_get_contents($targetFile), true);
            if (is_array($data)) {
                if (empty($data['instance_name']) || $data['instance_name'] === 'qnap-easytier') {
                    $data['instance_name'] = $defaultHost;
                }
                $defaultConfig = array_merge($defaultConfig, $data);
                // 若是从持久化目录恢复且本地缺失，自动同步到本地
                if (!file_exists($configFile)) {
                    atomicWrite($configFile, json_encode($defaultConfig, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                }
            }
        }

        // 读取独立 custom_flags.txt 保证一致性
        $customFlagsFile = $configDir . '/custom_flags.txt';
        if (file_exists($customFlagsFile)) {
            $flags = trim(file_get_contents($customFlagsFile));
            if (!empty($flags)) {
                $defaultConfig['custom_flags'] = $flags;
            }
        }

        echo json_encode(['success' => true, 'data' => $defaultConfig]);
        break;

    case 'save_config':
        $raw = file_get_contents('php://input');
        $input = json_decode($raw, true);
        if (!is_array($input)) {
            echo json_encode(['success' => false, 'message' => '无效的 JSON 配置数据']);
            exit;
        }

        $inputInst = trim($input['instance_name'] ?? '');
        $cleanInst = preg_replace('/[^a-zA-Z0-9_\-]/', '', $inputInst);
        if (empty($cleanInst)) {
            $cleanInst = getNASHostname();
        }

        $customFlags = trim($input['custom_flags'] ?? '');

        $corePid = trim(shell_exec('pidof easytier-core 2>/dev/null') ?? '');
        $isCurrentlyRunning = !empty($corePid);

        // 仅在服务运行时触发后台平滑重启 (change=1)；未运行时保存配置但不触发自启 (change=0)
        // 保留原配置或默认 enabled=1 偏好，杜绝因当前未运行而将开机自启标记覆写为 0
        $existingEnabled = 1;
        if (file_exists($configFile)) {
            $prevData = json_decode(file_get_contents($configFile), true);
            if (is_array($prevData) && isset($prevData['enabled'])) {
                $existingEnabled = intval($prevData['enabled']);
            }
        }
        $finalEnabled = isset($input['enabled']) ? (!empty($input['enabled']) ? 1 : 0) : $existingEnabled;
        
        // 开机自启动偏好持久化 (默认为 1)
        $existingAutostart = 1;
        if (file_exists($configFile)) {
            $prevData = json_decode(file_get_contents($configFile), true);
            if (is_array($prevData) && isset($prevData['autostart'])) {
                $existingAutostart = intval($prevData['autostart']);
            }
        }
        $finalAutostart = isset($input['autostart']) ? (!empty($input['autostart']) ? 1 : 0) : $existingAutostart;

        $needChange = $isCurrentlyRunning ? '1' : '0';

        // 参数安全过滤与格式化
        $cleanConfig = [
            'enabled' => $finalEnabled,
            'autostart' => $finalAutostart,
            'instance_name' => $cleanInst,
            'ipv4' => trim($input['ipv4'] ?? ''),
            'dhcp' => isset($input['dhcp']) ? !empty($input['dhcp']) : true,
            'network_name' => trim($input['network_name'] ?? 'easytier'),
            'network_secret' => trim($input['network_secret'] ?? ''),
            'peers' => is_array($input['peers']) ? array_values(array_filter(array_map('trim', $input['peers']))) : [],
            'listeners' => is_array($input['listeners']) ? array_values(array_filter(array_map('trim', $input['listeners']))) : ['tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010'],
            'rpc_portal' => trim($input['rpc_portal'] ?? '127.0.0.1:15888'),
            'dev_name' => preg_replace('/[^a-zA-Z0-9_\-]/', '', $input['dev_name'] ?? 'et0'),
            'proxy_networks' => is_array($input['proxy_networks']) ? array_values(array_filter(array_map('trim', $input['proxy_networks']))) : [],
            'custom_flags' => $customFlags,
            'change' => $needChange
        ];

        if (!is_dir($configDir)) {
            @mkdir($configDir, 0755, true);
        }

        // 保存 custom_flags.txt
        $customFlagsFile = $configDir . '/custom_flags.txt';
        atomicWrite($customFlagsFile, $customFlags . "\n");

        // 原子保存 JSON 与 TOML
        $jsonSaved = atomicWrite($configFile, json_encode($cleanConfig, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $tomlContent = generateToml($cleanConfig);
        $tomlSaved = atomicWrite($tomlFile, $tomlContent);

        if (!$jsonSaved || !$tomlSaved) {
            echo json_encode(['success' => false, 'message' => '配置文件原子写入失败，请检查目录权限']);
            exit;
        }

        // 双重持久化保障：同步沉淀至 QTS 系统级永久配置目录 /etc/config/easytier/
        $sysPersistDir = '/etc/config/easytier';
        if (!is_dir($sysPersistDir)) {
            @mkdir($sysPersistDir, 0755, true);
        }
        @copy($configFile, $sysPersistDir . '/easytier.conf');
        @copy($tomlFile, $sysPersistDir . '/easytier.toml');
        @copy($customFlagsFile, $sysPersistDir . '/custom_flags.txt');

        // 触发后台守护进程 (easytierconfig) 以 root 权限平滑重载 (仅当核心服务正在运行时)
        if ($isCurrentlyRunning) {
            $signalFile = $configDir . '/.restart_signal';
            @touch($signalFile);
            @chmod($signalFile, 0666);
            $restartMessage = '保存并已重启';
        } else {
            // 确保清理任何可能残留的重启信号
            $signalFile = $configDir . '/.restart_signal';
            @unlink($signalFile);
            $restartMessage = '配置已保存';
        }

        echo json_encode(['success' => true, 'message' => $restartMessage]);
        break;

    case 'set_autostart':
        $raw = file_get_contents('php://input');
        $input = json_decode($raw, true);
        if (!is_array($input) || !isset($input['autostart'])) {
            echo json_encode(['success' => false, 'message' => '缺少必要的 autostart 参数']);
            exit;
        }

        $autostartVal = !empty($input['autostart']) ? 1 : 0;
        $sysPersistDir = '/etc/config/easytier';

        if (file_exists($configFile)) {
            $confData = json_decode(file_get_contents($configFile), true);
            if (is_array($confData)) {
                $confData['autostart'] = $autostartVal;
                atomicWrite($configFile, json_encode($confData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

                // 同步写入系统级永久目录，保证重启后偏好不丢失
                if (!is_dir($sysPersistDir)) {
                    @mkdir($sysPersistDir, 0755, true);
                }
                @copy($configFile, $sysPersistDir . '/easytier.conf');
            }
        }

        $statusText = ($autostartVal === 1) ? '开机自启动已开启' : '开机自启动已关闭';
        echo json_encode(['success' => true, 'message' => $statusText, 'autostart' => $autostartVal]);
        break;

    case 'service_control':
        $sub = $_POST['cmd'] ?? '';
        if (!in_array($sub, ['start', 'stop', 'restart'])) {
            echo json_encode(['success' => false, 'message' => '不支持的操作指令']);
            exit;
        }

        $sysPersistDir = '/etc/config/easytier';
        // 修改配置 enabled 标记并双向持久化
        if (file_exists($configFile)) {
            $currentConf = json_decode(file_get_contents($configFile), true);
            if (is_array($currentConf)) {
                $currentConf['enabled'] = ($sub === 'stop') ? 0 : 1;
                atomicWrite($configFile, json_encode($currentConf, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

                // 同步写入系统级永久目录，保证重启后状态不丢失
                if (!is_dir($sysPersistDir)) {
                    @mkdir($sysPersistDir, 0755, true);
                }
                @copy($configFile, $sysPersistDir . '/easytier.conf');
            }
        }

        // 向后台 root 守护进程投递动作信号
        $actionFile = $configDir . '/.action_signal';
        @file_put_contents($actionFile, $sub);
        @chmod($actionFile, 0666);

        $msgMap = [
            'start' => '已启动 EasyTier 服务',
            'stop' => '已停止 EasyTier 服务',
            'restart' => '已重启 EasyTier 服务'
        ];
        $msg = $msgMap[$sub] ?? "已执行 EasyTier 服务 $sub 操作";

        echo json_encode(['success' => true, 'message' => $msg]);
        break;

    case 'get_logs':
        $linesCount = intval($_GET['lines'] ?? 100);
        if ($linesCount <= 0 || $linesCount > 500) {
            $linesCount = 100;
        }

        $logs = '';
        if (file_exists($logFile)) {
            $escapedFile = escapeshellarg($logFile);
            $logs = shell_exec("tail -n $linesCount $escapedFile 2>/dev/null") ?? '';
        }

        echo json_encode(['success' => true, 'data' => ['logs' => $logs]]);
        break;

    case 'clear_logs':
        if (file_exists($logFile)) {
            file_put_contents($logFile, '');
        }
        echo json_encode(['success' => true, 'message' => '日志已清空']);
        break;

    default:
        echo json_encode(['success' => false, 'message' => '未知的 action 请求']);
        break;
}
