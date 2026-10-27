#!/bin/sh
# Andromeda как плагин splify2: манифест, архив, граница API.
#
#   1. `s2p lint --official` чист на исходниках плагина (plugin/) и на собранном (build/andromeda/, нужен `sh build.sh`).
#   2. Тест совместимости SDK с хостом splify2-api 1.1 (`tests/compat/run.sh <каталог> 1.1`) — на обоих.
#   3. Архив out/andromeda-<версия>-all.s2p: проверяется s2p, в нём вид luci/home.js и сборка панели.
#   4. Граница API — Andromeda ходит к splify2 только через публичные методы объекта `splify2` (списком `methods.tsv` в SDK):
#      каждый вызов интерфейса есть в списке; вынесенные из каркаса методы (вид `moved`) называют плагин, и он в `requires`;
#      прежние методы карточки модулей (`steer_modules`, `steer_module_add`, `steer_module_del`) не зовутся; в коде нет
#      зашитых путей хоста (`/etc/…`, `/usr/…`) — их даёт метод `paths`; из глобалей LuCI берётся только мост `luci_rpc`.
#
# Запуск: PLUGIN_SDK=<каталог plugin-sdk> sh tests/plugin.sh   (после `sh build.sh`)
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${PLUGIN_SDK:-$HERE/../plugin-sdk}"
S2P="$(command -v s2p 2>/dev/null || echo "$SDK/bin/s2p")"
[ -x "$S2P" ] || { echo "нет s2p: PLUGIN_SDK=<каталог plugin-sdk> (sh build.sh там же)"; exit 1; }
COMPAT="$SDK/tests/compat"
HOSTV=1.1
fails=0
check() { if [ "$2" = "$3" ]; then printf '%-76s ok\n' "$1"; else printf '%-76s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fails=$((fails + 1)); fi; }
ok_cmd() { n="$1"; shift; if "$@" >/tmp/andromeda-plugin.$$ 2>&1; then printf '%-76s ok\n' "$n"; else printf '%-76s ПРОВАЛ\n' "$n"; sed 's/^/    /' /tmp/andromeda-plugin.$$; fails=$((fails + 1)); fi; rm -f /tmp/andromeda-plugin.$$; }

echo "== lint и совместимость"
ok_cmd "s2p lint --official: исходники plugin/" "$S2P" lint --official "$HERE/plugin"
ok_cmd "совместимость с splify2-api $HOSTV: исходники plugin/" sh "$COMPAT/run.sh" "$HERE/plugin" "$HOSTV"
if [ -d "$HERE/build/andromeda" ]; then
    ok_cmd "s2p lint --official: собранный плагин" "$S2P" lint --official "$HERE/build/andromeda"
    ok_cmd "совместимость с splify2-api $HOSTV: собранный плагин" sh "$COMPAT/run.sh" "$HERE/build/andromeda" "$HOSTV"
else
    echo "ПРОВАЛ: нет build/andromeda — сначала sh build.sh"; fails=$((fails + 1))
fi

echo "== архив"
A="$(ls -1 "$HERE"/out/andromeda-*-all.s2p 2>/dev/null | sort -V | tail -n 1)"
if [ -z "$A" ]; then echo "ПРОВАЛ: нет out/andromeda-*-all.s2p — сначала sh build.sh"; fails=$((fails + 1)); else
    ok_cmd "архив читается и без подписи проходит verify --unsigned" "$S2P" verify "$A" --unsigned
    list="$(tar tzf "$A")"
    for f in plugin.json settings.schema.json luci/home.js luci/build-id.txt luci/splify-index.js luci/splify-index.css luci/splify-x.js i18n/en.json i18n/ru.json; do
        check "в архиве есть $f" "1" "$(printf '%s\n' "$list" | grep -cx "$f")"
    done
    check "ui/ в архив не входит (панель раздаётся как вид luci/, а не как интерфейс хоста)" "0" "$(printf '%s\n' "$list" | grep -c '^ui/')"
    check "версия в имени архива = VERSION" "andromeda-$(cat "$HERE/VERSION")-all.s2p" "$(basename "$A")"
fi

echo "== граница API"
TSV="$COMPAT/splify2-$HOSTV/methods.tsv"
[ -f "$TSV" ] || { echo "нет $TSV"; exit 1; }
python3 - "$HERE" "$TSV" <<'PY' > /tmp/andromeda-boundary.$$
import json, re, sys
here, tsv = sys.argv[1:3]
txt = open(f"{here}/ui/src/lib/rpc.ts", encoding="utf-8").read()
calls = set(re.findall(r"declare<[\s\S]*?>\(\s*'([a-z0-9_]+)'", txt)) | set(re.findall(r"declare\(\s*'([a-z0-9_]+)'", txt))
kinds = {}
for l in open(tsv, encoding="utf-8"):
    if l.startswith("#") or not l.strip():
        continue
    f = l.rstrip("\n").split("\t")
    kinds[f[0]] = (f[1], f[2] if len(f) > 2 else "")
req = set(json.load(open(f"{here}/plugin/plugin.json"))["requires"]["plugins"])
print("count", "yes" if len(calls) > 40 else "no:%d" % len(calls))
print("unknown", " ".join(sorted(c for c in calls if c not in kinds)))
print("moved-not-required", " ".join(sorted("%s(%s)" % (c, kinds[c][1]) for c in calls if c in kinds and kinds[c][0] == "moved" and kinds[c][1] not in req)))
print("legacy", " ".join(sorted(calls & {"steer_modules", "steer_module_add", "steer_module_del"})))
PY
get() { sed -n "s/^$1 \{0,1\}//p" /tmp/andromeda-boundary.$$; }
check "вызовы извлекаются из ui/src/lib/rpc.ts (их больше сорока)" "yes" "$(get count)"
check "каждый вызов — публичный метод splify2-api $HOSTV (methods.tsv SDK)" "" "$(get unknown)"
check "вынесенные из каркаса методы: плагин-владелец есть в requires.plugins" "" "$(get moved-not-required)"
check "прежние методы карточки модулей не зовутся" "" "$(get legacy)"
rm -f /tmp/andromeda-boundary.$$

# Зашитые пути хоста в коде (не в комментариях и не в словарях ui/src/copy): их даёт `paths`, умолчания — один файл hostpaths.ts.
paths_bad="$(grep -rnE "['\"\`]/(etc|usr|var|www|lib|tmp)/" "$HERE/ui/src" "$HERE/desktop/renderer" "$HERE/desktop/electron" --include=*.ts --include=*.tsx --include=*.cjs --include=*.js 2>/dev/null \
    | grep -v '/ui/src/copy/' | grep -v '/ui/src/lib/hostpaths.ts' \
    | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' | grep -vE '/luci-static/' | head -8)"
check "в коде нет зашитых путей хоста (/etc, /usr, /var, /www)" "" "$paths_bad"

# Глобали LuCI: из страницы берётся только мост `window.luci_rpc` (его ставит вид luci/home.js); ни `window.L`, ни `window.ui`.
glob_bad="$(grep -rnE "window\.(L|ui|luci)\b|\bL\.(env|resource|require)\b" "$HERE/ui/src" --include=*.ts --include=*.tsx | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' | head -5)"
check "из глобалей LuCI панель берёт только window.luci_rpc" "" "$glob_bad"
check "вид luci/home.js выставляет только мост luci_rpc" "1" "$(grep -c 'window\.luci_rpc = rpc' "$HERE/plugin/luci/home.js" | awk '{print ($1>=1)?1:0}')"
check "вид luci/home.js не трогает таймаут ubus (им владеет каркас)" "0" "$(grep -c 'rpctimeout' "$HERE/plugin/luci/home.js")"

[ "$fails" -eq 0 ] && echo "все проверки прошли"
[ "$fails" -eq 0 ]
