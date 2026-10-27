#!/bin/sh
# Сборка плагина andromeda: панель (ui/) -> каталог плагина -> `s2p lint --official` -> `s2p build` -> out/andromeda-<версия>-all.s2p.
#
#   sh build.sh                      неподписанный архив (разработка)
#   S2P_KEY=ключ.sec sh build.sh     подписанный (выпуск)
#   SPLIFY_RELEASE_SUFFIX="beta 1"   приписка к имени выпуска в панели («26.11 Andromeda beta 1»); версию плагина не меняет
#
# Нужны: node >= 20.19 (vite 8 и vitest 4 на node 18 не запускаются: сборка падает строкой про `styleText` из node:util),
# s2p (в PATH, либо $PLUGIN_SDK/bin/s2p, либо SDK рядом — собирается из исходников: Go 1.21+). Docker не нужен.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

VERSION="$(cat VERSION)"
# В VERSION только цифры и точки: из неё собираются имя архива, версия плагина и номер сборки, который подставляется
# в адреса бандлов (`?v=`). Пробел или буква дали бы страницу, которая открывается и не работает.
case "$VERSION" in ''|*[!0-9.]*) echo "в VERSION только цифры и точки, а там: «$VERSION»" >&2; exit 1 ;; esac
PJV="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' plugin/plugin.json)"
[ "$PJV" = "$VERSION" ] || { echo "VERSION ($VERSION) и plugin/plugin.json ($PJV) расходятся" >&2; exit 1; }

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 20 ] 2>/dev/null; then
    for n in /opt/node22/bin /opt/node24/bin /root/.local/opt/node-v22.14.0-linux-x64/bin; do
        [ -x "$n/node" ] && { PATH="$n:$PATH"; node_major="$(node -p 'process.versions.node.split(".")[0]')"; break; }
    done
fi
[ "$node_major" -ge 20 ] 2>/dev/null || { echo "нужен node >= 20.19 (найден $(node --version 2>/dev/null || echo 'нет node'))" >&2; exit 1; }

SDK="${PLUGIN_SDK:-$HERE/../plugin-sdk}"
if command -v s2p >/dev/null 2>&1; then S2P="$(command -v s2p)"
elif [ -x "$SDK/bin/s2p" ]; then S2P="$SDK/bin/s2p"
elif [ -f "$SDK/build.sh" ]; then
    (cd "$SDK" && S2P_OUT="${TMPDIR:-/tmp}/s2p-bin.$$" sh build.sh >/dev/null) || exit 1
    S2P="${TMPDIR:-/tmp}/s2p-bin.$$/s2p"
else
    echo "нет инструмента s2p: положите его в PATH или задайте PLUGIN_SDK (каталог plugin-sdk)" >&2; exit 1
fi

# Классы Tailwind, которых не существует, сборка не ловит ничем (ни tsc, ни vite, ни стенды на jsdom): страница открывается
# и выглядит неправильно. Два барьера из пакета splify2, где панель жила раньше.
#
# 1. Цвета называются БЕЗ приставки sp-: `bg-card`, `text-muted-foreground`. Приставка живёт только у CSS-переменных
#    (--sp-card), из которых конфиг эти цвета собирает; `bg-sp-card` — класс, которого нет, и элемент остаётся без цвета.
bad="$(grep -rEo '\b(bg|text|border|ring|from|to|via|fill|stroke)-sp-[a-z-]*' ui/src 2>/dev/null | head -5)"
[ -z "$bad" ] || { echo "в классах есть приставка sp-, таких классов не существует:"; printf '%s\n' "$bad"; echo "цвета называются без неё: bg-card, text-muted-foreground, bg-success"; exit 1; }
# 2. Размер и вес заголовка утилитой на h1–h4 не задать: сброс в ui/src/index.css объявляет font-size и font-weight: inherit
#    вне каскадных слоёв, и он главнее любой утилиты. Вместо них классы sp-verdict, sp-title, sp-sub.
bad="$(grep -rEn --include='*.tsx' '<h[1-6][^>]*className="[^"]*(text-\[[0-9]|text-(xs|sm|base|lg|xl|2xl|3xl)|font-(medium|semibold|bold))' ui/src 2>/dev/null | head -5)"
[ -z "$bad" ] || { echo "у заголовка задан размер или вес утилитой — она не подействует:"; printf '%s\n' "$bad"; echo "используйте классы sp-verdict / sp-title / sp-sub (ui/src/index.css)"; exit 1; }

mkdir -p build out
LOG=build/build.log
[ -d ui/node_modules ] || (cd ui && npm ci --no-audit --no-fund) > "$LOG" 2>&1 || { echo "npm ci провалилась:"; cat "$LOG"; exit 1; }
# Вывод сборки — в файл: на успехе полтора экрана tsc и vite только прячут то немногое, что стоит читать, а на провале
# нужна ровно эта диагностика.
(cd ui && npm run build) > "$LOG" 2>&1 || { echo "сборка интерфейса провалилась:"; cat "$LOG"; exit 1; }

PKG=build/andromeda
rm -rf "$PKG"
mkdir -p "$PKG/luci" "$PKG/i18n/core"
cp plugin/plugin.json plugin/settings.schema.json "$PKG/"
cp plugin/i18n/*.json "$PKG/i18n/"; cp plugin/i18n/core/*.json "$PKG/i18n/core/"
# Вид LuCI и сборка панели лежат вместе: каркас splify2 раздаёт каталог luci/ плагина как view/splify2/p-andromeda/ (splify2-api 1.1).
cp plugin/luci/home.js "$PKG/luci/home.js"
cp -r ui/dist/* "$PKG/luci/"

# Номер сборки: загрузчик (luci/home.js) читает его на каждой загрузке страницы и добавляет к адресам бандлов. Без него
# браузер держал бы прежнюю панель после обновления плагина. Номер СБОРКИ, а не версии: на выпуске они совпадают, сборка
# между выпусками несёт ревизию, несохранённое дерево — «dirty» (иначе браузер, помнящий `?v=26.11.0`, брал бы бандл из кеша).
BUILD_ID="$VERSION"
if ! git describe --tags --exact-match >/dev/null 2>&1; then
    rev="$(git rev-parse --short HEAD 2>/dev/null || true)"
    [ -n "$rev" ] && BUILD_ID="$VERSION-$rev"
    [ -n "$(git status --porcelain 2>/dev/null)" ] && BUILD_ID="$BUILD_ID-dirty"
fi
# Приписка к имени выпуска тоже меняет страницу, поэтому входит в адрес сборки — суммой, а не словами.
[ -z "${SPLIFY_RELEASE_SUFFIX:-}" ] || BUILD_ID="$BUILD_ID-s$(printf '%s' "$SPLIFY_RELEASE_SUFFIX" | cksum | cut -d' ' -f1)"
printf '%s\n' "$BUILD_ID" > "$PKG/luci/build-id.txt"
# И в сами бандлы: npm build оставляет заглушку ?v=0.0.0, иначе один чанк оказался бы доступен по двум адресам.
sed -i -E "s/\?v=[0-9]+\.[0-9]+\.[0-9]+/?v=$BUILD_ID/g" "$PKG"/luci/splify-*.js

# Всё, что загрузчик и сборка называют по имени, обязано лежать в плагине.
for f in luci/home.js luci/build-id.txt luci/splify-index.js luci/splify-index.css luci/splify-x.js; do
    test -s "$PKG/$f" || { echo "в плагине нет $f — панель не откроется" >&2; exit 1; }
done

"$S2P" lint --official "$PKG"
if [ -n "${S2P_KEY:-}" ]; then "$S2P" build "$PKG" --key "$S2P_KEY" -o out
else "$S2P" build "$PKG" --unsigned -o out; fi
ls -la out
