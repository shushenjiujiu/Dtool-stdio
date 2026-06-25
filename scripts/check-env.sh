#!/bin/bash
# ============================================================
# dtool Studio — 环境检查脚本
# 检查部署前置条件是否满足
# 维护: Manager (系统运维与安全审计官)
#
# 用法:
#   bash check-env.sh              # 标准检查
#   bash check-env.sh --json       # JSON 格式输出（供工具解析）
#   bash check-env.sh --quiet      # 仅输出 PASS/FAIL 状态码
#
# 退出码:
#   0 — 全部通过
#   1 — 有警告（非阻塞）
#   2 — 有失败项（阻塞）
# ============================================================

set -euo pipefail

MODE="${1:-standard}"
EXIT_CODE=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ---- 输出函数 ----
print_header() {
    [[ "$MODE" == "json" || "$MODE" == "--json" ]] && return
    echo ""
    echo "============================================"
    echo "  dtool Studio — 环境检查"
    echo "  时间: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "  主机: $(hostname 2>/dev/null || echo 'unknown')"
    echo "============================================"
    echo ""
}

print_result() {
    local status="$1"   # PASS / WARN / FAIL / INFO
    local check="$2"
    local detail="${3:-}"

    if [[ "$MODE" == "json" || "$MODE" == "--json" ]]; then
        echo "  {\"check\": \"$check\", \"status\": \"$status\", \"detail\": \"$detail\"},"
        return
    fi

    local icon=""
    case "$status" in
        PASS) icon="${GREEN}✓${NC}" ;;
        WARN) icon="${YELLOW}⚠${NC}" ;;
        FAIL) icon="${RED}✗${NC}" ;;
        INFO) icon="${BLUE}→${NC}" ;;
    esac

    printf "  %b %-30s %s\n" "$icon" "$check" "$detail"
}

# ---- 检查函数 ----

check_docker() {
    if command -v docker &>/dev/null; then
        local ver
        ver=$(docker --version 2>/dev/null || echo "unknown")
        print_result "PASS" "Docker" "$ver"

        # 检查 docker 权限
        if docker ps &>/dev/null; then
            print_result "PASS" "Docker 权限" "当前用户可直接运行"
        else
            print_result "WARN" "Docker 权限" "当前用户不在 docker 组，需 sudo"
        fi
    else
        print_result "FAIL" "Docker" "未安装"
        EXIT_CODE=2
    fi
}

check_docker_compose() {
    if docker compose version &>/dev/null; then
        local ver
        ver=$(docker compose version 2>/dev/null || echo "unknown")
        print_result "PASS" "Docker Compose" "$ver"
    elif command -v docker-compose &>/dev/null; then
        local ver
        ver=$(docker-compose --version 2>/dev/null || echo "unknown")
        print_result "PASS" "Docker Compose (v1)" "$ver"
    else
        print_result "FAIL" "Docker Compose" "未安装"
        EXIT_CODE=2
    fi
}

check_nodejs() {
    if command -v node &>/dev/null; then
        local ver
        ver=$(node --version 2>/dev/null || echo "unknown")
        local major
        major=$(echo "$ver" | grep -oP 'v\K\d+')

        if [[ "$major" -ge 22 ]]; then
            print_result "PASS" "Node.js" "$ver (LTS 22.x ✅)"
        elif [[ "$major" -ge 20 ]]; then
            print_result "WARN" "Node.js" "$ver (建议升级到 22.x LTS)"
            [[ $EXIT_CODE -eq 0 ]] && EXIT_CODE=1
        else
            print_result "WARN" "Node.js" "$ver (版本偏低，建议 22.x LTS)"
            [[ $EXIT_CODE -eq 0 ]] && EXIT_CODE=1
        fi
    else
        print_result "FAIL" "Node.js" "未安装（需要 22.x LTS）"
        EXIT_CODE=2
    fi

    # npm 检查
    if command -v npm &>/dev/null; then
        local ver
        ver=$(npm --version 2>/dev/null || echo "unknown")
        print_result "PASS" "npm" "v${ver}"
    else
        print_result "WARN" "npm" "未安装（随 Node.js 一起安装）"
    fi
}

check_ports() {
    local ports=(3000 3001 3080)
    local services=("Studio 前端" "Studio 后端" "旧 dtool")

    for i in "${!ports[@]}"; do
        local port="${ports[$i]}"
        local svc="${services[$i]}"

        if ss -tlnp 2>/dev/null | grep -qE ":${port}[[:space:]]"; then
            local owner
            owner=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'users:\(\("([^"]+)"' | head -1 || echo "未知")
            print_result "FAIL" "端口 ${port} (${svc})" "已被占用 (${owner})"
            [[ $EXIT_CODE -eq 0 ]] && EXIT_CODE=2
        else
            print_result "PASS" "端口 ${port} (${svc})" "空闲"
        fi
    done
}

check_disk() {
    if command -v df &>/dev/null; then
        local avail_k
        avail_k=$(df / 2>/dev/null | awk 'NR==2 {print $4}')
        local avail_g
        avail_g=""

        if [[ -n "$avail_k" ]]; then
            # 尝试用字节转 GB（兼容不同 df 格式）
            if [[ "$avail_k" =~ ^[0-9]+$ ]]; then
                # Linux df 输出 1K-blocks
                avail_g=$(awk "BEGIN { printf \"%.1f\", $avail_k / 1024 / 1024 }")
            else
                # 可能已经带单位
                avail_g="$avail_k"
            fi

            local cmp_ok
            cmp_ok=$(awk -v a="$avail_g" 'BEGIN { print (a >= 5.0) ? 1 : 0 }')

            if [[ "$cmp_ok" = "1" ]]; then
                print_result "PASS" "磁盘空间" "${avail_g}GB 可用（≥ 5GB ✅）"
            else
                print_result "WARN" "磁盘空间" "${avail_g}GB 可用（建议 ≥ 5GB）"
                [[ $EXIT_CODE -eq 0 ]] && EXIT_CODE=1
            fi
        else
            print_result "WARN" "磁盘空间" "无法检测"
        fi
    else
        print_result "WARN" "磁盘空间" "df 不可用"
    fi
}

check_ollama() {
    local host="${AI_HOST:-localhost}"
    local port="${AI_PORT:-11434}"

    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://${host}:${port}" 2>/dev/null | grep -q "200"; then
        print_result "PASS" "ollama (${host}:${port})" "可达 ✅"
    else
        print_result "WARN" "ollama (${host}:${port})" "不可达（可选，部署后可配）"
    fi
}

check_litellm() {
    local host="${LITELLM_HOST:-localhost}"
    local port="${LITELLM_PORT:-4000}"

    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://${host}:${port}/health" 2>/dev/null | grep -q "200"; then
        print_result "PASS" "litellm (${host}:${port})" "可达 ✅"
    else
        print_result "INFO" "litellm (${host}:${port})" "不可达（可选，依赖自身部署）"
    fi
}

check_old_dtool() {
    local port="${DTOOL_V1_PORT:-8080}"

    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://localhost:${port}" 2>/dev/null | grep -q "200"; then
        print_result "PASS" "旧 dtool (:${port})" "运行正常 ✅"
    else
        # 也检查 3080（composition 的新端口）
        if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://localhost:3080" 2>/dev/null | grep -q "200"; then
            print_result "PASS" "旧 dtool (:3080)" "运行正常 ✅"
        else
            print_result "INFO" "旧 dtool" "未检测到运行实例（不影响部署）"
        fi
    fi
}

# ============================================================
# 主流程
# ============================================================

if [[ "$MODE" == "json" || "$MODE" == "--json" ]]; then
    echo "["
fi

print_header

check_docker
check_docker_compose
check_nodejs
check_ports
check_disk
check_ollama
check_litellm
check_old_dtool

if [[ "$MODE" == "json" || "$MODE" == "--json" ]]; then
    # 移除最后一个逗号
    echo "  {\"check\": \"_summary\", \"status\": \"$([ $EXIT_CODE -eq 0 ] && echo 'PASS' || ([ $EXIT_CODE -eq 1 ] && echo 'WARN' || echo 'FAIL'))\", \"exit_code\": $EXIT_CODE}"
    echo "]"
else
    echo ""
    if [[ $EXIT_CODE -eq 0 ]]; then
        echo -e "  ${GREEN}结果: 全部通过 ✅${NC}"
    elif [[ $EXIT_CODE -eq 1 ]]; then
        echo -e "  ${YELLOW}结果: 通过（有警告） ⚠️${NC}"
    else
        echo -e "  ${RED}结果: 有失败项，请修复后重试 ✗${NC}"
    fi
    echo ""
fi

exit $EXIT_CODE
