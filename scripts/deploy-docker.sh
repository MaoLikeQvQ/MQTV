#!/usr/bin/env bash
# 从当前源码构建并部署；生产 CI 的固定镜像部署继续使用 deploy.sh。
set -euo pipefail

usage() {
  printf '用法：bash scripts/deploy-docker.sh [服务器端口]\n'
  printf '首次生成 .env 和随机密钥；后续复用配置与数据卷。默认端口 18080。\n'
}
if [[ $# -gt 1 ]]; then usage >&2; exit 2; fi
if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then usage; exit 0; fi
requested_port="${1:-}"
if [[ -n "$requested_port" ]]; then
  if [[ ! "$requested_port" =~ ^[0-9]{1,5}$ ]] || (( 10#$requested_port < 1 || 10#$requested_port > 65535 )); then
    printf '服务器端口必须是 1–65535 的整数。\n' >&2
    exit 2
  fi
  requested_port=$((10#$requested_port))
fi

mqtv_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$mqtv_root"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '请先安装 Docker Engine 和 Docker Compose v2。\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf '无法连接 Docker 服务，请先启动 Docker 并确认当前用户有访问权限。\n' >&2
  exit 1
fi
if ! docker compose up --help | grep -- '--wait-timeout' >/dev/null; then
  printf '当前 Compose 版本不支持健康等待，请升级 Docker Compose v2。\n' >&2
  exit 1
fi

deployment_env="$mqtv_root/.env"
temporary=''
trap 'if [[ -n "$temporary" ]]; then rm -f "$temporary"; fi' EXIT
umask 077
if [[ ! -e "$deployment_env" ]]; then
  # 系统随机源：不要求宿主机安装 Node/Python，密钥不打印到终端。
  admin_key="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
  drpy_key="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
  proxy_key="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
  temporary="$(mktemp "$deployment_env.tmp.XXXXXX")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ADMIN_KEY=*) printf 'ADMIN_KEY=%s\n' "$admin_key" ;;
      DRPY_API_KEY=*) printf 'DRPY_API_KEY=%s\n' "$drpy_key" ;;
      PROXY_SECRET=*) printf 'PROXY_SECRET=%s\n' "$proxy_key" ;;
      DRPY_ENABLED=*) printf 'DRPY_ENABLED=1\n' ;;
      HOST_PORT=*) printf 'HOST_PORT=%s\n' "${requested_port:-18080}" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$mqtv_root/.env.example" > "$temporary"
  printf '\nCOMPOSE_PROFILES=drpy\n' >> "$temporary"
  # 原子创建，不覆盖另一个部署进程已生成的配置。
  ln "$temporary" "$deployment_env"
  rm -f "$temporary"
  temporary=''
  printf '已生成 .env（权限 600）；后台密钥保存在 ADMIN_KEY 中。\n'
elif [[ -n "$requested_port" ]]; then
  temporary="$(mktemp "$deployment_env.tmp.XXXXXX")"
  awk -v port="$requested_port" '
    /^[[:space:]]*(export[[:space:]]+)?HOST_PORT[[:space:]]*=/ {
      if (!found) print "HOST_PORT=" port;
      found=1; next;
    }
    {print}
    END {if (!found) print "HOST_PORT=" port}
  ' "$deployment_env" > "$temporary"
  mv "$temporary" "$deployment_env"
  temporary=''
fi
chmod 600 "$deployment_env"
if [[ -n "$requested_port" ]]; then export HOST_PORT="$requested_port"; fi

compose=(docker compose --env-file "$deployment_env" -f "$mqtv_root/docker-compose.yml" -f "$mqtv_root/docker-compose.build.yml")
"${compose[@]}" config --quiet
# 只提取所需字段，不输出整份环境配置，也不执行 .env 中的内容。
setting() { "${compose[@]}" config --environment | sed -n "s/^$1=//p"; }
admin_setting="$(setting ADMIN_KEY)"
if [[ -z "$admin_setting" ]]; then
  printf '已有 .env 未配置 ADMIN_KEY，请填写后重试。\n' >&2
  exit 1
fi
if [[ "$(setting DRPY_ENABLED)" == 1 ]]; then
  if [[ -z "$(setting DRPY_API_KEY)" ]]; then
    printf '已启用 drpy，但 .env 未配置 DRPY_API_KEY，请填写后重试。\n' >&2
    exit 1
  fi
  compose+=(--profile drpy)
fi
printf '正在从源码构建 MQTV，并等待服务健康就绪…\n'
if ! "${compose[@]}" up -d --build --wait --wait-timeout 120; then
  printf '部署未成功就绪；配置和数据卷已保留。请查看 docker compose logs --tail=100。\n' >&2
  exit 1
fi
"${compose[@]}" ps
mapping="$("${compose[@]}" port libretv 8080)"
printf '\nHTTP 端口映射：%s\n' "$mapping"
printf '前台：http://服务器IP:%s\n后台：http://服务器IP:%s/admin\n' "${mapping##*:}" "${mapping##*:}"
printf '后台登录密钥：.env 的 ADMIN_KEY。更新时重复运行本脚本即可。\n'
