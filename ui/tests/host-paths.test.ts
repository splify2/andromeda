import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hostPaths, resetHostPaths, setHostPaths } from '@/lib/hostpaths'
import { pathFor, srsPathFor, onRouter } from '@/lib/rulefiles'

// Каталоги списков, спеки и подписок интерфейс не зашивает: их называет хост (метод `paths`, splify2-api 1.1). До ответа —
// умолчания OpenWrt, ответ их заменяет, негодное поле не портит прежнего.

describe('каталоги хоста', () => {
    beforeEach(() => resetHostPaths())

    it('до ответа хоста — умолчания OpenWrt', () => {
        expect(hostPaths()).toEqual({ lists: '/etc/steer/lists', specDir: '/etc/steer', subsDir: '/etc/steer/subs' })
        expect(pathFor('itdog/domains/x.lst')).toBe('/etc/steer/lists/itdog/domains/x.lst')
    })

    it('ответ хоста подменяет каталоги, путь правила следует за ним', () => {
        setHostPaths({ lists: '/mnt/data/steer/lists/', spec_dir: '/mnt/data/steer', subs_dir: '/mnt/data/steer/subs' })
        expect(hostPaths().lists).toBe('/mnt/data/steer/lists')
        expect(pathFor('/news.lst')).toBe('/mnt/data/steer/lists/news.lst')
        expect(srsPathFor('jinndi/domains/adguard.srs.lst')).toBe('/mnt/data/steer/lists/jinndi/domains/adguard.srs')
    })

    it('«лежит на роутере» ищет по относительному имени под каталогом хоста', () => {
        setHostPaths({ lists: '/mnt/l' })
        const sv = { prefixes: [], domains: ['a.lst'], parts: [{ file: 'a.lst' }], srs: false } as never
        expect(onRouter(sv, { 'a.lst': { count: 1, mtime: 1 } })).toBe(true)
        expect(onRouter(sv, {})).toBe(false)
    })

    it('негодное и пустое поле оставляет прежнее значение', () => {
        setHostPaths({ lists: '/a/lists' })
        setHostPaths({ lists: '', spec_dir: 'relative', subs_dir: undefined })
        setHostPaths(null)
        expect(hostPaths()).toEqual({ lists: '/a/lists', specDir: '/etc/steer', subsDir: '/etc/steer/subs' })
    })
})

describe('метод paths', () => {
    beforeEach(() => {
        vi.resetModules()
        delete (window as unknown as Record<string, unknown>).luci_rpc
    })

    it('зовётся объектом splify2, методом paths, без параметров', async () => {
        const { rpc } = await import('@/lib/rpc')
        const call = vi.fn(async () => ({ ok: true, lists: '/x' }))
        const declare = vi.fn(() => call)
        ;(window as unknown as Record<string, unknown>).luci_rpc = { declare }
        await expect(rpc.paths()).resolves.toEqual({ ok: true, lists: '/x' })
        expect(declare).toHaveBeenCalledWith({ object: 'splify2', method: 'paths', params: [] })
    })
})
