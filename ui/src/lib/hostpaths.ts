/** Каталоги хоста, которые интерфейс иначе зашивал бы в код (`paths`, splify2-api 1.1).
 *
 *  Спека называет списки и подписки путями: списки — под каталогом списков, подписки и ключи — относительно каталога спеки.
 *  Куда их кладёт роутер, знает он сам, поэтому интерфейс спрашивает его (`paths`), а до ответа пользуется умолчаниями
 *  OpenWrt — они те же, что у хоста без переопределений. Функции чистые и синхронные: путь нужен в разметке сразу, а
 *  ответ приходит один раз за сессию и ничего не перерисовывает — умолчание и ответ совпадают на любом настоящем роутере. */

export interface HostPaths { lists: string; specDir: string; subsDir: string }

const DEFAULTS: HostPaths = { lists: '/etc/steer/lists', specDir: '/etc/steer', subsDir: '/etc/steer/subs' }
let current: HostPaths = { ...DEFAULTS }

const trimEnd = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** Принять ответ `paths`. Пустое и негодное поле оставляет прежнее значение. */
export function setHostPaths(r: { lists?: string; spec_dir?: string; subs_dir?: string } | null | undefined) {
    if (!r) return
    const ok = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/')
    current = {
        lists: ok(r.lists) ? trimEnd(r.lists) : current.lists,
        specDir: ok(r.spec_dir) ? trimEnd(r.spec_dir) : current.specDir,
        subsDir: ok(r.subs_dir) ? trimEnd(r.subs_dir) : current.subsDir,
    }
}

export const hostPaths = (): HostPaths => current

/** Вернуть умолчания (стенды). */
export function resetHostPaths() { current = { ...DEFAULTS } }
