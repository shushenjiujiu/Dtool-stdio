#!/bin/bash
# ============================================================
# dtool Studio — Node.js 安装脚本
# 目标: Rocky Linux 10.x (Red Quartz)
# 方案: NodeSource RPM 源
# 版本: Node.js LTS 22.x
# 维护: Manager (系统运维与安全审计官)
#
# 用法:
#   sudo bash install-nodejs.sh
#   或
#   bash install-nodejs.sh --dry-run   # 仅检查，不安装
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    log_info "干运行模式 — 仅检查，不执行任何变更"
fi

echo ""
echo "============================================"
echo "  dtool Studio — Node.js 安装脚本"
echo "  目标: Node.js LTS 22.x"
echo "  系统: $(grep -oP '^PRETTY_NAME="\K[^"]+' /etc/os-release 2>/dev/null || echo 'Unknown')"
echo "============================================"
echo ""

# --- 前置检查 ---

# 检查是否 root 或 sudo
if [[ $EUID -ne 0 ]] && [[ "$DRY_RUN" == false ]]; then
    log_warn "建议以 root 或 sudo 运行此脚本"
    log_info "尝试: curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs"
    echo ""
fi

# 检查是否已安装
if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version)
    CURRENT_NPM=$(npm --version 2>/dev/null || echo "未安装")
    log_info "Node.js 已安装: ${CURRENT_NODE}"
    log_info "npm 已安装: ${CURRENT_NPM}"

    MAJOR=$(echo "$CURRENT_NODE" | grep -oP 'v\K\d+')
    if [[ "$MAJOR" -ge 22 ]]; then
        log_info "版本 ≥ 22.x，符合要求。无需操作。"
        exit 0
    else
        log_warn "当前版本 v${MAJOR}.x，建议升级到 v22.x LTS"
        if [[ "$DRY_RUN" == true ]]; then
            log_info "执行安装将升级 Node.js"
            exit 0
        fi
    fi
fi

if [[ "$DRY_RUN" == true ]]; then
    log_info "干运行完成，未执行任何变更。"
    exit 0
fi

# --- 检查可用的包管理器 ---
PKG_MGR=""
if command -v dnf &>/dev/null; then
    PKG_MGR="dnf"
elif command -v yum &>/dev/null; then
    PKG_MGR="yum"
else
    log_error "未找到 dnf 或 yum。此脚本仅支持 Rocky Linux / RHEL / CentOS 系。"
    log_error "请手动安装 Node.js: https://nodejs.org/en/download/"
    exit 1
fi

# --- 检查架构 ---
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|aarch64)
        log_info "架构 ${ARCH} 支持。"
        ;;
    *)
        log_warn "架构 ${ARCH} 未广泛测试。NodeSource 可能不支持。"
        log_warn "备用方案: 下载二进制 tarball"
        echo ""
        echo "  wget https://nodejs.org/dist/v22.x.x/node-v22.x.x-linux-${ARCH}.tar.gz"
        echo "  sudo tar -xzf node-v22.x.x-linux-${ARCH}.tar.gz -C /usr/local --strip-components=1"
        echo ""
        read -rp "是否继续尝试 NodeSource？(y/N): " choice
        if [[ ! "$choice" =~ ^[Yy]$ ]]; then
            exit 1
        fi
        ;;
esac

# ============================================================
# 安装流程
# ============================================================

log_info "步骤 1/3 — 添加 NodeSource 22.x RPM 源..."

# NodeSource 官方安装脚本
# 来源: https://github.com/nodesource/distributions
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -

log_info "步骤 2/3 — 安装 Node.js..."

if [[ "$PKG_MGR" == "dnf" ]]; then
    dnf install -y nodejs
else
    yum install -y nodejs
fi

# ============================================================
# 验证
# ============================================================
echo ""
log_info "步骤 3/3 — 验证安装..."

NODE_VER=$(node --version)
NPM_VER=$(npm --version)

if [[ -n "$NODE_VER" ]]; then
    echo ""
    echo "============================================"
    echo "  ✅ Node.js 安装成功"
    echo "============================================"
    echo "  Node.js:    ${NODE_VER}"
    echo "  npm:        ${NPM_VER}"
    echo "  路径:       $(which node)"
    echo "============================================"

    # 验证 LTS
    MAJOR=$(echo "$NODE_VER" | grep -oP 'v\K\d+')
    if [[ "$MAJOR" -ge 22 ]]; then
        log_info "版本 ${NODE_VER} (LTS 22.x) ✅"
    else
        log_warn "版本 ${NODE_VER} 不是预期的 22.x LTS，但可用"
    fi
else
    log_error "安装失败 — node 命令不可用"
    exit 1
fi

log_info "完成。可通过 'node --version' 和 'npm --version' 验证。"

# --- 清理 NodeSource 安装脚本残留 ---
rm -f /tmp/nodesource-setup.sh 2>/dev/null || true
