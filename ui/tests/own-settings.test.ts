import { beforeEach, describe, expect, it, vi } from 'vitest'

// Настройки Andromeda — по схеме плагина (plugin/settings.schema.json): значение человека, иначе умолчание схемы хоста,
// иначе умолчание в коде; хост не отвечает — не падаем.

describe('настройки Andromeda', () => {
    beforeEach(() => {
        vi.resetModules()
        delete (window as unknown as Record<string, unknown>).luci_rpc
    })

    async function withReply(reply: unknown) {
        const call = vi.fn(async () => reply)
        const declare = vi.fn(() => call)
        ;(window as unknown as Record<string, unknown>).luci_rpc = { declare }
        const m = await import('@/lib/ownsettings')
        return { m, call, declare }
    }

    it('значение человека главнее умолчания схемы', async () => {
        const { m, declare } = await withReply({
            ok: true, schema: { properties: { setup_wizard: { default: true }, quick_start: { default: true } } },
            values: { setup_wizard: false },
        })
        await expect(m.ownSettings()).resolves.toEqual({ setup_wizard: false, quick_start: true })
        expect(declare).toHaveBeenCalledWith({ object: 'splify2', method: 'plugin_settings_get', params: ['id'] })
    })

    it('нет значения — умолчание схемы хоста', async () => {
        const { m } = await withReply({ ok: true, schema: { properties: { quick_start: { default: false } } }, values: {} })
        await expect(m.ownSettings()).resolves.toEqual({ setup_wizard: true, quick_start: false })
    })

    it('хост отказал или не ответил — умолчания в коде', async () => {
        const { m } = await withReply({ ok: false, error: 'нет плагина' })
        await expect(m.ownSettings()).resolves.toEqual(m.DEFAULT_SETTINGS)
        vi.resetModules()
        const m2 = await import('@/lib/ownsettings')
        await expect(m2.ownSettings()).resolves.toEqual(m2.DEFAULT_SETTINGS)
    })

    it('значения не булевы — игнорируются', async () => {
        const { m } = await withReply({ ok: true, schema: {}, values: { setup_wizard: 'no', quick_start: 0 } })
        await expect(m.ownSettings()).resolves.toEqual(m.DEFAULT_SETTINGS)
    })

    it('умолчания в коде равны умолчаниям схемы плагина', async () => {
        const { readFileSync } = await import('node:fs')
        const { resolve } = await import('node:path')
        const schema = JSON.parse(readFileSync(resolve(__dirname, '../../plugin/settings.schema.json'), 'utf8')) as {
            properties: Record<string, { default: unknown }>
        }
        const m = await import('@/lib/ownsettings')
        expect(Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, v.default]))).toEqual(m.DEFAULT_SETTINGS)
    })
})
