import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Spec } from '@/lib/model'

const edit = vi.fn()
let current: Spec
vi.mock('@/lib/pending', () => ({
    pending: { load: vi.fn(async () => current), edit: (s: Spec) => edit(s), onReplaced: () => () => {} },
}))
vi.mock('@/lib/rpc', () => ({
    rpc: {
        dnsLog: vi.fn(async () => ({ running: true, upstreams: [] })),
        dnsProbe: vi.fn(async () => ({ results: [{ url: 'https://cloudflare-dns.com/dns-query', ok: true, ms: 3 }] })),
    },
}))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import Dns from '@/components/sections/Dns'
import { S } from '@/copy'

// Вкладка DNS приложения для ПК (board): карточки — все запросы DNS. Сервер, назначенный только
// для остальных имён (`dns.other`, старая форма вкладки), — отмечен, а не «DNS провайдера».

const live = { status: { features: ['dns_other', 'dns_groups'] } } as never

beforeEach(() => {
    edit.mockClear()
    current = {
        outputs: { direct: { name: 'direct', kind: 'direct' } },
        channels: [],
        dns: { upstreams: { cloudflare: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'] } }, other: 'cloudflare' },
    } as Spec
})

describe('вкладка DNS — карточки', () => {
    it('сервер только в dns.other — карточка отмечена, «DNS провайдера» нет', async () => {
        render(<Dns live={live} board />)
        const cf = await screen.findByRole('button', { name: /Cloudflare \(DoH\)/ })
        expect(cf.getAttribute('aria-pressed')).toBe('true')
        expect(screen.getByRole('button', { name: new RegExp(S.dns.dnsProvaydera) }).getAttribute('aria-pressed')).toBe('false')
    })

    it('«DNS провайдера» снимает оба назначения', async () => {
        render(<Dns live={live} board />)
        fireEvent.click(await screen.findByRole('button', { name: new RegExp(S.dns.dnsProvaydera) }))
        await waitFor(() => expect(edit).toHaveBeenCalled())
        const d = edit.mock.calls.at(-1)![0].dns
        expect(d?.upstream).toBeUndefined()
        expect(d?.other).toBeUndefined()
    })

    it('лампочка — по ответу проверки с роутера', async () => {
        render(<Dns live={live} board />)
        await waitFor(() => expect(screen.getAllByText('3 мс').length).toBeGreaterThan(0))
    })
})

// «DNS для правил / DNS для остального» (#2964, #3023): раздельный выбор вернулся выключателем.
describe('вкладка DNS — отдельный DNS для имён под правилами', () => {
    const ups = {
        cloudflare: { url: 'https://cloudflare-dns.com/dns-query', ips: ['1.1.1.1'] },
        google: { url: 'https://dns.google/dns-query', ips: ['8.8.8.8'] },
    }
    it('общая группа разводится: имена под правилами — своя копия, остальные — прежняя', async () => {
        current = { ...current, dns: { upstreams: ups, groups: { all: { servers: ['cloudflare', 'google'], mode: 'failover' } }, upstream: 'all', other: 'all' } } as Spec
        render(<Dns live={live} board />)
        expect(await screen.findByRole('heading', { name: S.dns.vseZaprosyDns })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('switch', { name: S.dns.otdelnyyDlyaPravil }))
        await waitFor(() => expect(edit).toHaveBeenCalled())
        const d = edit.mock.calls.at(-1)![0].dns
        expect(d.other).toBe('all')
        expect(d.upstream).toBe('rules')
        expect(d.groups.rules).toEqual({ servers: ['cloudflare', 'google'], mode: 'failover' })
    })

    it('назначения разные — раздельный вид сам; выключатель снова пишет одно в оба', async () => {
        current = { ...current, dns: { upstreams: ups, upstream: 'google', other: 'cloudflare' } } as Spec
        render(<Dns live={live} board />)
        expect(await screen.findByRole('heading', { name: S.dns.dlyaOstalnyhSaytov })).toBeInTheDocument()
        expect(screen.getByText(S.dns.dlyaImenPodPravilami)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Cloudflare \(DoH\)/ }).getAttribute('aria-pressed')).toBe('true')
        fireEvent.click(screen.getByRole('switch', { name: S.dns.otdelnyyDlyaPravil }))
        await waitFor(() => expect(edit).toHaveBeenCalled())
        const d = edit.mock.calls.at(-1)![0].dns
        expect([d.upstream, d.other]).toEqual(['cloudflare', 'cloudflare'])
    })
})
