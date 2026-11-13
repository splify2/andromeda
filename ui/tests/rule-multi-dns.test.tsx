import { render, screen } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { PRESETS, pruneDnsPresets } from '@/lib/dnspresets'
import { S } from '@/copy'
import type { Channel, Spec } from '@/lib/model'

// Несколько серверов DNS у правила (#2965, #3012): до 26.11 правило брало группу серверов, в 26.11 — один.
// Отмеченные пилюли — группа прямо в правиле (`dns: { servers, mode }` спеки v2), по очереди или сразу все.

const DOM = '/etc/steer/lists/news.lst'
const OUTPUTS = { direct: { kind: 'direct', up: true }, wg0: { kind: 'interface', device: 'wg0', up: true } } as never
const SPEC: Spec = {
    outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
    channels: [],
}
const title = (name: string) => new Map(S.dns.presetTitles).get(name)!
const pill = (name: string) => screen.getByRole('button', { name: new RegExp(`^${title(name).replace(/[()]/g, '\\$&')}`) })

function mount(ch: Channel) {
    const changes: Channel[] = []
    const el = (c: Channel) => (
        <RuleEditor ch={c} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1} defer
            target={<div />} coveredBy={[]} onChange={(n) => { changes.push(n); r.rerender(el(n)) }} onClose={() => {}} onDelete={() => {}} />
    )
    const r = render(el(ch))
    return changes
}

const base: Channel = { name: 'Новости', out: 'wg0', match: { domains_files: [DOM], mode: 'fakeip' } } as Channel

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = SPEC
    pending.dirty = false
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('несколько серверов DNS у правила', () => {
    it('две пилюли — группа в правиле по порядку отметки; «Сразу все» — race; снятая — снова один сервер', async () => {
        const changes = mount(base)
        await userEvent.click(screen.getByRole('switch', { name: S.ruleEditor.nastroykaDnsDlyaPravila }))
        await userEvent.click(pill('google'))
        expect(changes.at(-1)!.dns).toBe('google')
        await userEvent.click(pill('quad9-doh'))
        expect(changes.at(-1)!.dns).toEqual({ servers: ['google', 'quad9-doh'], mode: 'failover' })
        await userEvent.click(pill('cloudflare'))
        await userEvent.click(screen.getByRole('button', { name: S.dns.srazuVse }))
        const grp = changes.at(-1)!
        expect(grp.dns).toEqual({ servers: ['google', 'quad9-doh', 'cloudflare'], mode: 'race' })

        // В спеке — группа у правила; серверы — готовые профили, которые RulesTab заводит при сохранении.
        const ups = Object.fromEntries(['google', 'quad9-doh', 'cloudflare'].map((n) => [n, PRESETS.find((p) => p.name === n)!.up]))
        const spec: Spec = { ...SPEC, dns: { upstreams: ups }, channels: [grp] }
        const doc = encodeSpec(spec)
        expect((doc.rules as Record<string, unknown>[])[0].dns).toEqual({ servers: ['google', 'quad9-doh', 'cloudflare'], mode: 'race' })
        expect(decodeSpec(doc).channels[0].dns).toEqual(grp.dns)
        // Серверы группы в правиле — ссылки: уборка готовых профилей их не трогает.
        expect(pruneDnsPresets(spec)).toBe(spec)
        if (process.env.MULTI_DNS_SPEC_OUT) writeFileSync(process.env.MULTI_DNS_SPEC_OUT, JSON.stringify(doc, null, 1))

        await userEvent.click(pill('google'))
        await userEvent.click(pill('cloudflare'))
        expect(changes.at(-1)!.dns).toBe('quad9-doh')
        await userEvent.click(pill('quad9-doh'))
        expect(changes.at(-1)!.dns).toBeUndefined()
    })
})
