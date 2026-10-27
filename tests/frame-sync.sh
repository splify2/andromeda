#!/bin/sh
# Что Andromeda держит копией того, чем владеет пакет splify2, — и сверка копии с оригиналом. Исходники splify2 нужны ТОЛЬКО
# этому стенду (плагин к ним больше не обращается — ни в коде, ни в сборке): берутся из $SPLIFY2 (по умолчанию соседний
# каталог ../splify2). Нет каталога — стенд пропускается вслух и в итоге run.sh назван пропущенным.
#
#   1. Перечень модулей ядра в интерфейсе (ui/src/lib/engine.ts: STEER_MODULES, DEFAULT_MODULES) = установщик и бэкенд splify2.
#   2. Словарь Andromeda в языковых плагинах (lang-ru, lang-en: i18n/host/<язык>.json) = ui/src/copy/<язык>.json.
#
# Запуск: SPLIFY2=<каталог splify2> sh tests/frame-sync.sh
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SP="${SPLIFY2:-$HERE/../splify2}"
if [ ! -f "$SP/install.sh" ]; then
    echo "ПРОПУЩЕН: нет каталога splify2 ($SP): задайте SPLIFY2=<каталог>"
    exit 2
fi
fails=0
check() { if [ "$2" = "$3" ]; then printf '%-72s ok\n' "$1"; else printf '%-72s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fails=$((fails + 1)); fi; }

ui_list() { sed -n "s/^export const $1 = \[\(.*\)\]/\1/p" "$HERE/ui/src/lib/engine.ts" | tr -d "'," ; }
inst() { sed -n "s/^$1=\"\(.*\)\"/\1/p" "$SP/install.sh"; }
check "перечень модулей: интерфейс = установщик" "$(inst STEER_MODULES)" "$(ui_list STEER_MODULES)"
check "умолчание к первой установке: интерфейс = установщик" "$(inst STEER_DEFAULT_MODULES)" "$(ui_list DEFAULT_MODULES)"
pk="$SP/files/usr/lib/splify2/rpcd/pkg-lib.sh"
check "перечень модулей: интерфейс = бэкенд" "$(sed -n 's/^STEER_MODULES="\(.*\)"/\1/p' "$pk")" "$(ui_list STEER_MODULES)"

for lang in ru en; do
    P="$SP/plugins/lang-$lang/i18n/host/$lang.json"
    [ -f "$P" ] || { echo "нет $P"; fails=$((fails + 1)); continue; }
    check "lang-$lang: словарь Andromeda = ui/src/copy/$lang.json" "true" \
        "$(python3 -c 'import json,sys; print(str(json.load(open(sys.argv[1])) == json.load(open(sys.argv[2]))).lower())' "$P" "$HERE/ui/src/copy/$lang.json")"
done
[ "$fails" -eq 0 ] && echo "все проверки прошли"
[ "$fails" -eq 0 ]
