#!/bin/sh
# Все стенды Andromeda одной командой: интерфейс (lint, tsc, vitest), приложение для компьютера, плагин (манифест, архив, граница
# API) и сверка копий с пакетом splify2.
#
#   PLUGIN_SDK=<plugin-sdk> SPLIFY2=<splify2> sh tests/run.sh
#
# Нужен node >= 20.19 (vitest 4, vite 8; node 22 ищется в /opt). Плагин проверяется на собранном: `sh build.sh` запускается здесь же
# (кроме BUILD=0). Стенд сверки с splify2 без его каталога пропускается ВСЛУХ и считается провалом: молчаливый пропуск
# читается как «прошло».
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fails=0
run() { name="$1"; shift; printf '\n===== %s =====\n' "$name"; if "$@"; then printf '%s: зелено\n' "$name"; else printf '%s: ПРОВАЛ\n' "$name"; fails=$((fails + 1)); fi; }

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 20 ] 2>/dev/null; then
    for n in /opt/node22/bin /opt/node24/bin /root/.local/opt/node-v22.14.0-linux-x64/bin; do
        [ -x "$n/node" ] && { PATH="$n:$PATH"; node_major="$(node -p 'process.versions.node.split(".")[0]')"; break; }
    done
fi
[ "$node_major" -ge 20 ] 2>/dev/null || { echo "нужен node >= 20.19 (найден $(node --version 2>/dev/null || echo 'нет node'))"; exit 1; }
[ -d "$ROOT/ui/node_modules/vitest" ] || (cd "$ROOT/ui" && npm ci --no-audit --no-fund) || exit 1

# Те же три проверки, что в Actions, и до стенда: локальный прогон зелёный при красном CI — ровно так стенд однажды и превратился в фикцию.
run ui-lint sh -c "cd '$ROOT/ui' && npm run lint --silent && npx tsc -b && npm run check:cn --silent"
run ui-harness sh -c "cd '$ROOT/ui' && npm test --silent"
[ -d "$ROOT/desktop/node_modules/ssh2" ] || (cd "$ROOT/desktop" && npm ci --ignore-scripts --no-audit --no-fund) || exit 1
run desktop sh -c "cd '$ROOT/desktop' && npm test --silent"
[ "${BUILD:-1}" = 0 ] || run build sh -c "sh '$ROOT/build.sh' >/dev/null"
run plugin sh "$ROOT/tests/plugin.sh"
run frame-sync sh "$ROOT/tests/frame-sync.sh"

printf '\n%s\n' "$([ "$fails" -eq 0 ] && echo 'ВСЕ СТЕНДЫ ЗЕЛЁНЫЕ' || echo "СТЕНДОВ С ПРОВАЛОМ: $fails")"
[ "$fails" -eq 0 ]
