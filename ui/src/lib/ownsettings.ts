/** Настройки самой Andromeda — по схеме плагина (`plugin/settings.schema.json`), как их видят и форма каркаса, и эта панель.
 *
 *  Значения лежат у хоста (`plugin_settings_get`): записанное человеком, иначе умолчание схемы. Хост не отвечает — берутся
 *  умолчания из этого файла, они те же, что в схеме (стенд `tests/plugin.sh` сверяет). */
import { rpc } from '@/lib/rpc'

export const PLUGIN_ID = 'andromeda'

/** Ключи схемы и их умолчания. */
export const DEFAULT_SETTINGS = {
    /** Показать мастер первоначальной настройки на пустом роутере. */
    setup_wizard: true,
    /** Показать «Быстрый старт» на пустой главной. */
    quick_start: true,
}
export type OwnSettings = typeof DEFAULT_SETTINGS

/** Настройки Andromeda: значение человека поверх умолчания схемы хоста поверх умолчания здесь. Ошибки хоста не бросает. */
export async function ownSettings(): Promise<OwnSettings> {
    const out: OwnSettings = { ...DEFAULT_SETTINGS }
    try {
        const r = await rpc.pluginSettingsGet(PLUGIN_ID)
        if (!r?.ok) return out
        for (const k of Object.keys(out) as (keyof OwnSettings)[]) {
            const own = r.values?.[k]
            const dflt = r.schema?.properties?.[k]?.default
            const v = typeof own === 'boolean' ? own : typeof dflt === 'boolean' ? dflt : undefined
            if (v !== undefined) out[k] = v
        }
    } catch { /* без хоста — умолчания */ }
    return out
}
