<div align="center">

<img src="https://splify2.github.io/assets/img/logo.svg" width="104" alt="">

# Andromeda

**Панель splify2: правила, выходы, подписки, DNS, запросы и диагностика на одной странице. Плагин splify2 и приложение для компьютера**

[![Документация](https://img.shields.io/badge/документация-splify2.github.io-a897ff)](https://splify2.github.io/docs/)
[![Telegram](https://img.shields.io/badge/Telegram-чат-2CA5E0?logo=telegram&logoColor=white)](https://t.me/ssplify)

</div>

Andromeda — интерфейс [splify2](https://github.com/splify2/splify2) для роутера на OpenWrt. С 26.11 это **плагин** `andromeda`
(тип `plugin`, архив `.s2p`), а не часть пакета `splify2`: пакет `splify2` несёт каркас на классическом LuCI JS и кладёт архив
Andromeda в семя `/usr/share/splify2/seed/`, откуда его ставит при установке и обновлении. Адрес страницы **Сервисы → splify2**
не меняется; какой интерфейс открывать — Andromeda или каркас («Basic»), выбирают в «Настройки → Интерфейс», а `?basic=1` в адресе
всегда открывает каркас.

В репозитории два проекта:

| Каталог | Что |
|---|---|
| `ui/` | панель: React (на сборке — preact), vite, Tailwind, vitest. Исходники, дизайн-система `ui/andromeda/` |
| `desktop/` | приложение для компьютера (Electron): та же панель в своём окне, вход по паролю через API splify2 на роутере |
| `plugin/` | то, что делает панель плагином: манифест, схема настроек, словари `en`/`ru`, вид LuCI `luci/home.js` |

## Как Andromeda встаёт в splify2

Только через публичный API платформы ([plugin-sdk](https://github.com/splify2/plugin-sdk): `docs/splify2-api.md`,
`docs/splify2-api-1.1.md`, `docs/host-api.md`, `docs/manifest.md`):

- **Главный экран** — `splify2.luci.interface` в манифесте (splify2-api 1.1): каталог `luci/` плагина раздаётся как
  `view/splify2/p-andromeda/`, и вид `luci/home.js` грузит бандл рядом с собой.
- **Методы** — только публичные методы объекта `splify2` (список `methods.tsv` в SDK); вынесенные из каркаса в плагины
  (списки, подписки, архив настроек, проверка узлов, обновление) называют плагин-владельца, и он указан в `requires.plugins`.
  `tests/plugin.sh` сверяет вызовы `ui/src/lib/rpc.ts` с этим списком.
- **Каталоги хоста** (списки, спека, подписки) — методом `paths`; в коде нет зашитых `/etc/steer/…`.
- **Настройки** — схема `plugin/settings.schema.json` (`setup_wizard`, `quick_start`), значения читает `plugin_settings_get`.
  Одна схема — форма и в каркасе, и здесь.
- **Тексты** — `plugin.name` и `plugin.description` в `plugin/i18n/{en,ru}.json`; строки самой панели — `ui/src/copy`, их
  переводы языковых плагинов (`lang-ru`, `lang-en` в splify2) сверяет `tests/frame-sync.sh`.
- **Плагины для панели** (вкладка «Плагины», слоты, темы) — [host-api](https://github.com/splify2/plugin-sdk/blob/main/docs/host-api.md)
  v1: его хозяин — Andromeda.

## Сборка и проверка

Нужны node ≥ 20.19 и инструмент `s2p` из [plugin-sdk](https://github.com/splify2/plugin-sdk) (`sh build.sh` там даёт `bin/s2p`).

```sh
export PLUGIN_SDK=../plugin-sdk
sh build.sh                       # ui -> plugin -> s2p lint --official -> out/andromeda-<версия>-all.s2p
S2P_KEY=ключ.sec sh build.sh      # с подписью (выпуск)
sh tests/run.sh                   # lint, tsc, vitest панели и приложения, плагин, сверка с splify2 (SPLIFY2=<каталог>)
cd ui && npm run dev              # dev-сервер панели; вызовы ubus вне LuCI падают вслух
```

На роутере с ядром steer 2.1 и splify2 26.11: `steer plugin install --file out/andromeda-26.11.0-all.s2p --unsigned`
(без подписи — только для разработки). В обычной жизни архив приезжает семенем пакета `splify2`.

Устройство панели — [ui/README.md](ui/README.md), приложения — [desktop/README.md](desktop/README.md).

## История

Репозиторий выделен из `ui/` и `desktop/` репозитория splify2 (ветка `plugins`) с сохранением истории коммитов.
