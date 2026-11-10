import { awgRpc, type AwgPut } from '@/lib/rpc'
import { pluginActions } from '@/plugins/store'
import type { Output, Spec } from '@/lib/model'
import { S } from '@/copy'

/** Свой туннель WireGuard или AmneziaWG файлом или текстом — без настроек сети роутера.
 *
 *  Ядро заводит устройство такого туннеля само (выход `kind: awg`): ему нужен только файл, который
 *  человеку выдал сервер. Здесь — общий путь для всех мест, где туннель добавляют (мастер первой
 *  настройки, «Свои туннели»): отдать файл бэкенду, поставить плагин вида, положить выход в спеку.
 *
 *  ВЫХОД КЛАДЁТ ПАНЕЛЬ, а не бэкенд: у спеки есть черновик с несохранёнными правками, и запись за
 *  его спиной кончилась бы отказом «спеку изменили». Бэкенд отвечает готовым выходом. */

/** Имя туннеля — имя выхода и файла: буквы, цифры, `_ - .`, до 31 знака, не с точки. */
export const TUNNEL_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,30}$/

/** Свободное имя из подсказки (имя файла) — без расширения и чужих знаков; занятое получает номер. */
export function tunnelName(hint: string, taken: Iterable<string>): string {
    const busy = new Set(taken)
    let base = hint.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_.-]/g, '').replace(/^\.+/, '').slice(0, 28)
    /* `direct` и `block` — слова ядра, выходом с таким именем туннель не станет. */
    if (!base || base === 'direct' || base === 'block') base = 'tunnel'
    let name = base
    for (let n = 2; busy.has(name); n++) name = `${base}${n}`
    return name
}

/** Отдать файл роутеру и довести до состояния «выход можно класть в спеку». Отказ — исключением со
 *  словами бэкенда. `onStep` — что сейчас делается (установка модуля идёт десятки секунд).
 *
 *  Плагин `awg` ставится ЗДЕСЬ, заданием: без него ядро не знает вида, и спека с таким выходом не
 *  сохранится. Файл к этому моменту уже лежит на роутере — при отказе установки он остаётся в
 *  перечне неиспользуемых, и добавление можно повторить, не вставляя текст заново. */
export async function importTunnel(name: string, text: string, onStep?: (t: string) => void): Promise<AwgPut> {
    const r = await awgRpc.put(name, text)
    if (!r.ok) throw new Error(r.error || S.tunnelImport.neDobavlen)
    if (r.plugin_ready === false) {
        onStep?.(S.tunnelImport.stavimModul)
        try {
            await pluginActions.install(r.plugin || 'awg', undefined, (t) => onStep?.(t || S.tunnelImport.stavimModul))
        } catch (e) {
            throw new Error(S.tunnelImport.modulNeVstal(e instanceof Error ? e.message : String(e)), { cause: e })
        }
    }
    return r
}

/** Выход туннеля по ответу бэкенда. Файл лежит там, где ядро ищет его по имени выхода, поэтому пути
 *  (`conf`) в выходе нет. Ключ `ipv6` — по адресам файла (`nat`, если есть адрес IPv6): тем же
 *  правилом, которым самолечение при apply дописало бы его само. */
export function tunnelOutput(name: string, r?: Pick<AwgPut, 'output' | 'ipv6'>): Output {
    return { name, kind: 'awg', on_fail: r?.output?.on_fail ?? 'drop', ipv6: r?.output?.ipv6 ?? r?.ipv6 ?? 'off' }
}

/** Спека с выходом туннеля. Выход вида awg с тем же именем остаётся как есть: файл заменили, а
 *  настройки выхода (что делать при отказе, IPv6) человек мог поменять. */
export function withTunnel(spec: Spec, name: string, r?: Pick<AwgPut, 'output' | 'ipv6'>): Spec {
    if (spec.outputs[name]?.kind === 'awg') return spec
    return { ...spec, outputs: { ...spec.outputs, [name]: tunnelOutput(name, r) } }
}
