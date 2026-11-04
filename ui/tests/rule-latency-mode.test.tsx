import { fireEvent, render, screen } from '@testing-library/preact'
import { useState } from 'preact/hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleTarget from '@/components/board/RuleTarget'
import { rpc } from '@/lib/rpc'
import { applyTarget, EMPTY_TARGET, targetOf, type Target } from '@/lib/ruleout'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import type { Output, Spec } from '@/lib/model'
import { live } from './fixtures'

// «Самый быстрый» в блоке «Куда» правила не сбрасывается: ни когда выбран один узел (или одно
// устройство, или hysteria2 «Авто») и спека читается обратно, ни когда следующий узел отмечается
// после первого — он добавляется к набору, а не заменяет прежний, как при «Вручную».

const SUB = '/etc/steer/subs/sub1'
const base = (out = 'direct'): Spec => ({
    outputs: { direct: { name: 'direct', kind: 'direct' } },
    channels: [{ name: 'a', out, match: { prefixes_files: ['/etc/steer/lists/a.lst'] } }],
} as unknown as Spec)

beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [{ name: 'sub1', title: 'Провайдер', path: SUB, present: true, kind: 'url', url: '', used: 0 }] } as never)
    vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue({
        nodes: [
            { index: 0, name: 'Amsterdam', host: 'a', type: 'vless', cc: 'NL' },
            { index: 1, name: 'Berlin', host: 'b', type: 'vless', cc: 'DE' },
        ],
    } as never)
    vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(null as never)
    vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(null as never)
})

/** Блок «Куда», как в редакторе правила: спека живёт у родителя и приходит обратно после каждой правки. */
function Host({ onSpec }: { onSpec: (s: Spec) => void }) {
    const [spec, setSpec] = useState<Spec>(base())
    return <RuleTarget spec={spec} index={0} live={live({})} onSpec={(s) => { setSpec(s); onSpec(s) }} />
}

describe('«Самый быстрый» в «Куда» правила', () => {
    it('режим, выбранный до узлов, держится: второй узел добавляется, в спеке pick: latency', async () => {
        const onSpec = vi.fn()
        render(<Host onSpec={onSpec} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Туннель' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Самый быстрый' }))
        fireEvent.click(await screen.findByRole('button', { name: /Amsterdam/ }))
        expect(screen.getByRole('button', { name: 'Самый быстрый' })).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(screen.getByRole('button', { name: /Berlin/ }))
        const s = onSpec.mock.calls.at(-1)![0] as Spec
        const o = s.outputs[s.channels[0].out]
        expect(o).toMatchObject({ kind: 'vless', nodes: [0, 1], pick: 'latency' })
        expect(screen.getByRole('button', { name: 'Самый быстрый' })).toHaveAttribute('aria-pressed', 'true')
    })
})

describe('«Самый быстрый» из одной части переживает сохранение', () => {
    const one = (t: Partial<Target>): Target => ({ ...structuredClone(EMPTY_TARGET), ...t })
    const roundtrip = (t: Target) => {
        const s = applyTarget(base(), 0, t)
        const back = decodeSpec(JSON.parse(JSON.stringify(encodeSpec(s))))
        return { s, t: targetOf(back, back.channels[0].out)! }
    }

    it('один узел vless — туннель с pick: latency', () => {
        const { s, t } = roundtrip(one({ subs: { mode: 'latency', picks: [{ sub: SUB, proto: 'vless', idx: 3 }] } }))
        expect(s.outputs.a).toMatchObject({ kind: 'vless', nodes: [3], pick: 'latency' })
        expect(t.subs).toMatchObject({ mode: 'latency', picks: [{ sub: SUB, proto: 'vless', idx: 3 }] })
    })

    it('hysteria2 «Авто» — пул latency из одной части', () => {
        const { s, t } = roundtrip(one({ subs: { mode: 'latency', picks: [{ sub: SUB, proto: 'hysteria2' }] } }))
        expect(s.outputs.a).toMatchObject({ kind: 'interface', pick: 'latency' })
        expect(s.outputs[s.outputs.a.devices![0]]).toMatchObject({ kind: 'hysteria2', part_of: 'a' } as Partial<Output>)
        expect(t.subs).toMatchObject({ mode: 'latency', picks: [{ sub: SUB, proto: 'hysteria2' }] })
    })

    it('одно своё устройство — пул из одного устройства с pick: latency', () => {
        const { s, t } = roundtrip(one({ own: { mode: 'latency', picks: ['dev:wg0'] } }))
        expect(s.outputs.a).toMatchObject({ kind: 'interface', devices: ['wg0'], pick: 'latency' })
        expect(t.own).toEqual({ mode: 'latency', picks: ['dev:wg0'] })
    })

    it('«Вручную» и «Первый живой» из одной части пишутся как прежде', () => {
        const m = applyTarget(base(), 0, one({ subs: { mode: 'manual', picks: [{ sub: SUB, proto: 'vless', idx: 3 }] } }))
        expect(m.outputs.a.pick).toBeUndefined()
        const d = applyTarget(base(), 0, one({ own: { mode: 'order', picks: ['dev:wg0'] } }))
        expect(d.outputs.a).toMatchObject({ kind: 'interface', device: 'wg0' })
        expect(d.outputs.a.pick).toBeUndefined()
    })
})
