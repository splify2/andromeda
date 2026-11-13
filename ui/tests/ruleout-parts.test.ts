import { describe, expect, it } from 'vitest'
import { applyTarget, EMPTY_TARGET, outputTree, type Mode, type SubPick, type Target } from '@/lib/ruleout'
import { isTunnelKind, type Channel, type Output, type Spec } from '@/lib/model'
import { decodeSpec, encodeSpec } from '@/lib/specv2'

// Части пула при правке набора правила (lib/ruleout.ts: place, prune). Чат D#2986: правило «Google AI» в VLESS —
// и на главной новая карточка «WireGuard» googleai-4 с «устройства googleai-1 нет». Выход-интерфейс (пул) остался
// без своих туннелей: правило перешло на пул из своего прежнего набора, а части ушли вместе с прежним верхом;
// и при переходе «самый быстрый» → «+ WARP» новый пул забирал имя первого туннеля, туннели съезжали на следующие
// номера — каждый живой перезапускался.

const SUB = '/etc/steer/subs/sub1.txt'
const SUB2 = '/etc/steer/subs/sub2.txt'
const rule = (name: string): Channel => ({ name, out: 'direct', match: { prefixes_files: [`/etc/steer/lists/${name}.lst`] } })
const start = (): Spec => ({
    outputs: { direct: { name: 'direct', kind: 'direct' }, warp: { name: 'warp', kind: 'warp' as Output['kind'] } },
    channels: [rule('Google AI'), rule('YouTube')],
})
/* Через спеку ядра и обратно — как после сохранения и перечитывания с роутера. */
const rt = (s: Spec): Spec => decodeSpec(JSON.parse(JSON.stringify(encodeSpec(s))))
const T = (mode: Mode, picks: SubPick[], warp = false): Target =>
    ({ ...structuredClone(EMPTY_TARGET), subs: { mode, picks }, warp: warp ? ['warp'] : [] })

/** Сироты (выходы, до которых не дотянуться от правил) и устройства пулов, которых не заведёт ни один туннель. */
function broken(s: Spec): string[] {
    const reach = new Set(['direct', 'warp'])
    for (const c of s.channels) for (const n of outputTree(s.outputs, c.out)) reach.add(n)
    const devs = new Set(Object.values(s.outputs).filter((o) => isTunnelKind(o.kind)).map((o) => o.device || o.name))
    return [
        ...Object.keys(s.outputs).filter((n) => !reach.has(n)).map((n) => `сирота ${n}`),
        ...Object.values(s.outputs).filter((o) => o.kind === 'interface')
            .flatMap((o) => (o.devices || [o.device as string]).filter((d) => !devs.has(d)).map((d) => `нет устройства ${o.name}.${d}`)),
    ]
}

const VL: SubPick[] = [{ sub: SUB, proto: 'vless' }, { sub: SUB2, proto: 'vless' }]
const ALL: SubPick[] = [...VL, { sub: SUB, proto: 'hysteria2', idx: 0 }, { sub: SUB, proto: 'hysteria2', idx: 1 }, { sub: SUB, proto: 'vless', idx: 2 }]

describe('части пула при правке набора', () => {
    it('набор с WARP → тот же без WARP: правило на прежнем пуле, туннели при нём', () => {
        let s = rt(applyTarget(start(), 0, T('order', ALL, true)))
        expect(broken(s)).toEqual([])
        s = rt(applyTarget(s, 0, T('order', ALL)))
        expect(broken(s)).toEqual([])
        const out = s.outputs[s.channels[0].out]
        expect(out.kind).toBe('interface')
        expect(out.devices).toHaveLength(4)
    })

    it('«самый быстрый» → «+ WARP»: туннели сохраняют имена (не перезапускаются), пул берёт новое', () => {
        let s = rt(applyTarget(start(), 0, T('latency', VL)))
        const before = Object.entries(s.outputs).filter(([, o]) => isTunnelKind(o.kind)).map(([n, o]) => `${n}:${o.sub_file}`).sort()
        s = rt(applyTarget(s, 0, T('latency', VL, true)))
        const after = Object.entries(s.outputs).filter(([, o]) => isTunnelKind(o.kind)).map(([n, o]) => `${n}:${o.sub_file}`).sort()
        expect(after).toEqual(before)
        expect(broken(s)).toEqual([])
    })

    it('любые правки двух правил подряд не оставляют сирот и пулов без туннелей', () => {
        let seed = 7
        const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
        const modes: Mode[] = ['order', 'latency', 'balance', 'manual']
        for (let run = 0; run < 150; run++) {
            let s = start()
            for (let step = 0; step < 6; step++) {
                const picks = ALL.filter(() => rnd(2) === 0)
                s = rt(applyTarget(s, rnd(2), T(modes[rnd(4)], picks.length ? picks : [ALL[0]], rnd(3) === 0)))
                expect(broken(s), `прогон ${run}, шаг ${step}`).toEqual([])
            }
        }
    }, 60_000)
})
