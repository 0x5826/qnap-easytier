#!/bin/sh
CONF="/etc/config/qpkg.conf"
QPKG_NAME="easytier"
QPKG_ROOT=$(/sbin/getcfg $QPKG_NAME Install_Path -f ${CONF} 2>/dev/null)

# 如果未安装为 QPKG，降级为当前脚本所在目录的父目录
if [ -z "$QPKG_ROOT" ] || [ ! -d "$QPKG_ROOT" ]; then
    SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
    QPKG_ROOT=$(dirname "$SCRIPT_DIR")
fi

DEF_SHARE_INFO="/etc/config/def_share.info"
DEF_WEB_NAME="Qweb"
if [ -f "$DEF_SHARE_INFO" ]; then
    DEF_WEB_NAME=$(/sbin/getcfg SHARE_DEF defWeb -d Qweb -f $DEF_SHARE_INFO 2>/dev/null)
fi
APACHE_ROOT="/share/$DEF_WEB_NAME"

LOG_FILE="$QPKG_ROOT/easytier.log"
CONFIG_TOML="$QPKG_ROOT/configs/easytier.toml"
CONFIG_JSON="$QPKG_ROOT/configs/easytier.conf"

detect_binary() {
    if [ -f "$QPKG_ROOT/easytier-core" ]; then
        CORE_BIN="$QPKG_ROOT/easytier-core"
        CLI_BIN="$QPKG_ROOT/easytier-cli"
        return 0
    fi

    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64|amd64)
            ARCH_DIR="$QPKG_ROOT/x86_64"
            ;;
        aarch64|arm64)
            ARCH_DIR="$QPKG_ROOT/arm_64"
            ;;
        *)
            ARCH_DIR="$QPKG_ROOT/x86_64"
            ;;
    esac

    if [ -f "$ARCH_DIR/easytier-core" ]; then
        CORE_BIN="$ARCH_DIR/easytier-core"
        CLI_BIN="$ARCH_DIR/easytier-cli"
        # 建立软链接到根目录方便统一管理
        ln -sf "$CORE_BIN" "$QPKG_ROOT/easytier-core"
        ln -sf "$CLI_BIN" "$QPKG_ROOT/easytier-cli"
        return 0
    fi

    return 1
}

log_sys() {
    if [ -x "/sbin/log_tool" ]; then
        /sbin/log_tool -t0 -uSystem -p127.0.0.1 -mlocalhost -a "[EasyTier] $1" 2>/dev/null
    fi
}

case "$1" in
  start)
    if [ -x "/sbin/getcfg" ]; then
        if [ "$(/sbin/getcfg "QWEB" "Enable" -d 1)" = "0" ]; then
            echo "Web服务器尚未启用，请前往[控制台]→[应用程序]→[Web服务器]开启"
            if [ -x "/sbin/log_tool" ]; then
                /sbin/log_tool -t1 -uSystem -p127.0.0.1 -mlocalhost -a "[EasyTier] Web服务尚未启用，请前往[控制台]→[应用程序]→[Web服务器]开启，并重启 EasyTier。" 2>/dev/null
            fi
        fi

        ENABLED=$(/sbin/getcfg $QPKG_NAME Enable -u -d TRUE -f $CONF 2>/dev/null)
        if [ "$ENABLED" = "FALSE" ]; then
            echo "$QPKG_NAME is disabled."
            exit 1
        fi
    fi

    echo "Starting $QPKG_NAME..."
    CURRENT_PID=$(pidof easytier-core)
    if [ -n "$CURRENT_PID" ]; then
        echo "$QPKG_NAME is already running (PID: $CURRENT_PID)."
        exit 0
    fi

    # 加载内核 TUN/TAP 驱动模块与权限修复 (自动在 QNAP 系统模块库中搜寻并加载)
    if ! lsmod 2>/dev/null | grep -q "^tun\s"; then
        modprobe tun >/dev/null 2>&1
        if ! lsmod 2>/dev/null | grep -q "^tun\s"; then
            for tun_ko in $(find /lib/modules -name "tun.ko*" 2>/dev/null); do
                if [ -f "$tun_ko" ]; then
                    insmod "$tun_ko" >/dev/null 2>&1
                    lsmod 2>/dev/null | grep -q "^tun\s" && break
                fi
            done
        fi
    fi
    if [ ! -c /dev/net/tun ]; then
        mkdir -p /dev/net
        mknod /dev/net/tun c 10 200 2>/dev/null
    fi
    chmod 666 /dev/net/tun 2>/dev/null

    detect_binary
    if [ ! -f "$CORE_BIN" ]; then
        echo "Error: easytier-core binary not found for architecture $(uname -m)."
        exit 1
    fi

    chown -R admin:administrators "$QPKG_ROOT" 2>/dev/null
    chmod +x "$CORE_BIN" "$CLI_BIN" "$QPKG_ROOT/easytierconfig" "$QPKG_ROOT/shared/easytierconfig" 2>/dev/null
    chmod -s "$CORE_BIN" "$CLI_BIN" 2>/dev/null
    chmod -Rf 777 "$QPKG_ROOT/configs" "$LOG_FILE" 2>/dev/null

    # 系统级 CLI 软链接
    ln -sf "$CLI_BIN" /usr/bin/easytier-cli
    ln -sf "$CLI_BIN" /usr/sbin/easytier-cli
    ln -sf "$CORE_BIN" /usr/bin/easytier-core
    ln -sf "$CORE_BIN" /usr/sbin/easytier-core

    # WebUI Apache 软链接
    WEB_SRC="$QPKG_ROOT/web"
    [ ! -d "$WEB_SRC" ] && WEB_SRC="$QPKG_ROOT/shared/web"
    for target_web in "$APACHE_ROOT" /share/Web /share/Qweb /share/CACHEDEV1_DATA/Web; do
        if [ -d "$target_web" ]; then
            ln -sf "$WEB_SRC" "$target_web/easytier"
        fi
    done

    # 刷新 QTS 系统桌面与 App Center 图标库为官方高清图
    ICON_SRC="$QPKG_ROOT/icons"
    [ ! -d "$ICON_SRC" ] && ICON_SRC="$QPKG_ROOT/shared/icons"
    if [ -d "$ICON_SRC" ]; then
        for sys_icon_dir in /home/httpd/RSS/images /home/httpd/cgi-bin/images /home/httpd/v3_images; do
            if [ -d "$sys_icon_dir" ]; then
                cp -f "$ICON_SRC"/* "$sys_icon_dir/" 2>/dev/null
            fi
        done
        touch /etc/config/qpkg.conf 2>/dev/null
    fi

    # 守护脚本软链接至主目录
    if [ -f "$QPKG_ROOT/shared/easytierconfig" ] && [ ! -f "$QPKG_ROOT/easytierconfig" ]; then
        ln -sf "$QPKG_ROOT/shared/easytierconfig" "$QPKG_ROOT/easytierconfig"
    fi

    # 多层持久化保障：检测配置文件自愈与系统级同步
    SYS_PERSIST_DIR="/etc/config/easytier"
    mkdir -p "$SYS_PERSIST_DIR" 2>/dev/null

    if [ ! -f "$CONFIG_JSON" ]; then
        if [ -f "$SYS_PERSIST_DIR/easytier.conf" ]; then
            cp -f "$SYS_PERSIST_DIR/easytier.conf" "$CONFIG_JSON"
        elif [ -f "$QPKG_ROOT/configs/easytier.conf.default" ]; then
            cp -f "$QPKG_ROOT/configs/easytier.conf.default" "$CONFIG_JSON"
        fi
    elif [ -f "$CONFIG_JSON" ]; then
        cp -f "$CONFIG_JSON" "$SYS_PERSIST_DIR/easytier.conf" 2>/dev/null
    fi

    if [ ! -f "$CONFIG_TOML" ]; then
        if [ -f "$SYS_PERSIST_DIR/easytier.toml" ]; then
            cp -f "$SYS_PERSIST_DIR/easytier.toml" "$CONFIG_TOML"
        elif [ -f "$QPKG_ROOT/configs/easytier.toml.default" ]; then
            cp -f "$QPKG_ROOT/configs/easytier.toml.default" "$CONFIG_TOML"
        fi
    elif [ -f "$CONFIG_TOML" ]; then
        cp -f "$CONFIG_TOML" "$SYS_PERSIST_DIR/easytier.toml" 2>/dev/null
    fi

    if [ ! -f "$QPKG_ROOT/configs/custom_flags.txt" ] && [ -f "$SYS_PERSIST_DIR/custom_flags.txt" ]; then
        cp -f "$SYS_PERSIST_DIR/custom_flags.txt" "$QPKG_ROOT/configs/custom_flags.txt" 2>/dev/null
    elif [ -f "$QPKG_ROOT/configs/custom_flags.txt" ]; then
        cp -f "$QPKG_ROOT/configs/custom_flags.txt" "$SYS_PERSIST_DIR/custom_flags.txt" 2>/dev/null
    fi

    # 自动探测并填充 NAS 系统主机名
    NAS_HOSTNAME="qnap-easytier"
    if [ -x "/sbin/getcfg" ] && [ -f "/etc/config/uLinux.conf" ]; then
        CONF_HOST=$(/sbin/getcfg System "Server Name" -f /etc/config/uLinux.conf 2>/dev/null)
        [ -n "$CONF_HOST" ] && NAS_HOSTNAME="$CONF_HOST"
    else
        CONF_HOST=$(hostname 2>/dev/null)
        [ -n "$CONF_HOST" ] && NAS_HOSTNAME="$CONF_HOST"
    fi
    NAS_HOSTNAME=$(echo "$NAS_HOSTNAME" | sed 's/[^a-zA-Z0-9_\-]//g')
    [ -z "$NAS_HOSTNAME" ] && NAS_HOSTNAME="qnap-easytier"

    if [ -f "$CONFIG_TOML" ]; then
        sed -i "s/instance_name = \"\"/instance_name = \"$NAS_HOSTNAME\"/g" "$CONFIG_TOML" 2>/dev/null
        sed -i "s/instance_name = \"qnap-easytier\"/instance_name = \"$NAS_HOSTNAME\"/g" "$CONFIG_TOML" 2>/dev/null
    fi
    if [ -f "$CONFIG_JSON" ]; then
        sed -i "s/\"instance_name\": \"\"/\"instance_name\": \"$NAS_HOSTNAME\"/g" "$CONFIG_JSON" 2>/dev/null
        sed -i "s/\"instance_name\": \"qnap-easytier\"/\"instance_name\": \"$NAS_HOSTNAME\"/g" "$CONFIG_JSON" 2>/dev/null
    fi

    # 读取用户自定义启动附加参数
    CUSTOM_ARGS=""
    if [ -f "$QPKG_ROOT/configs/custom_flags.txt" ]; then
        CUSTOM_ARGS=$(cat "$QPKG_ROOT/configs/custom_flags.txt" 2>/dev/null | tr '\r\n' ' ')
    fi

    # 启动后台维护守护进程 (无论核心是否启用均保持守护，以响应 WebUI 动作与维护软链接)
    DAEMON_SCRIPT="$QPKG_ROOT/easytierconfig"
    if [ ! -x "$DAEMON_SCRIPT" ] && [ -x "$QPKG_ROOT/shared/easytierconfig" ]; then
        DAEMON_SCRIPT="$QPKG_ROOT/shared/easytierconfig"
    fi
    if [ -x "$DAEMON_SCRIPT" ]; then
        "$DAEMON_SCRIPT" >/dev/null 2>&1 &
    fi

    # 检测服务启用状态 (enabled)，若为 0 则遵循用户停止意图，不拉起核心网络服务
    IS_ENABLED="1"
    if [ -f "$CONFIG_JSON" ]; then
        CONF_ENABLED=$(grep -o '"enabled"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_JSON" 2>/dev/null | awk -F: '{print $2}' | tr -d ' ')
        [ -n "$CONF_ENABLED" ] && IS_ENABLED="$CONF_ENABLED"
    fi

    if [ "$IS_ENABLED" = "0" ]; then
        log_sys "EasyTier 当前状态为已停止 (enabled: 0)，跳过拉起核心网络进程，仅常驻 WebUI 后台守护。"
        echo "$QPKG_NAME is stopped by user configuration (enabled: 0). Core service skipped."
        exit 0
    fi

    # 启动核心服务进程
    if [ -f "$CONFIG_TOML" ]; then
        eval "\"$CORE_BIN\" -c \"$CONFIG_TOML\" $CUSTOM_ARGS >> \"$LOG_FILE\" 2>&1 &"
    else
        eval "\"$CORE_BIN\" -d $CUSTOM_ARGS >> \"$LOG_FILE\" 2>&1 &"
    fi

    log_sys "EasyTier 服务已成功启动"
    echo "$QPKG_NAME started successfully."
    ;;

  stop)
    echo "Stopping $QPKG_NAME..."
    # 发送优雅终止信号 SIGTERM
    killall -15 easytierconfig 2>/dev/null
    killall -15 easytier-core 2>/dev/null
    sleep 1
    # 强制清理未响应进程
    killall -9 easytierconfig 2>/dev/null
    killall -9 easytier-core 2>/dev/null
    rm -f "$QPKG_ROOT/easytier.pid"

    # 清理系统软链接
    rm -f /usr/sbin/easytier-cli /usr/bin/easytier-cli /usr/sbin/easytier-core /usr/bin/easytier-core
    if [ -d "$APACHE_ROOT" ]; then
        rm -f "$APACHE_ROOT/easytier"
    fi

    # 清理 QuFirewall 防火墙规则
    if [ -x "/sbin/getcfg" ] && [ -x "iptables" ]; then
        qufirewall_enabled=$(/sbin/getcfg qufirewall Enable -u -d FALSE -f $CONF 2>/dev/null)
        qufirewall_status=$(/sbin/getcfg Global firewall_status -d 0 -f /etc/config/QuFirewall.conf 2>/dev/null)
        if [ "$qufirewall_enabled" = "TRUE" ] && [ "$qufirewall_status" = "1" ]; then
            device_name="et0"
            if [ -f "$CONFIG_TOML" ]; then
                custom_dev=$(grep -E '^\s*dev_name\s*=' "$CONFIG_TOML" | head -n1 | cut -d'"' -f2)
                [ -n "$custom_dev" ] && device_name="$custom_dev"
            fi
            while iptables -C QUFIREWALL -i "$device_name" -j ACCEPT 2>/dev/null; do
                iptables -D QUFIREWALL -i "$device_name" -j ACCEPT 2>/dev/null
            done
        fi
    fi

    log_sys "EasyTier 服务已停止"
    echo "$QPKG_NAME stopped."
    ;;

  restart)
    $0 stop
    sleep 2
    $0 start
    ;;

  status)
    PID=$(pidof easytier-core)
    if [ -n "$PID" ]; then
        echo "$QPKG_NAME is running (PID: $PID)."
        exit 0
    else
        echo "$QPKG_NAME is stopped."
        exit 1
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac

exit 0
