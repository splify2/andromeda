import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import { AUTO_APPLY_MS, startAutoApply } from '@/lib/autoapply'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc, type AutoApplyStatus } from '@/lib/rpc'
import { decodeSpec } from '@/lib/specv2'
import type { Spec } from '@/lib/model'

// ПРИМЕНЯЕТ РОУТЕР, СТРАНИЦА ТОЛЬКО СЛЕДИТ.
//
// Поддельный роутер ведёт себя как каркас с плагином autoapply 1.1: запись спеки ставит ожидание
// (pending), через «паузу» идёт применение (applying), потом снимок применённого равен спеке (idle).
// Страница не зовёт apply вовсе: правка видна сразу, «Применение» висит, пока роутер занят, а после —
// сверка. Проверяется lib/pending.ts (follow) вместе с lib/autoapply.ts, который в этом режиме молчит.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const BASE: Spec = { outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] } as Spec
const withRule = (n: number): Spec => ({
    ...BASE,
    channels: Array.from({ length: n }, (_, i) => ({ name: `r${i}`, out: 'direct', match: { any: true } })),
}) as Spec

/** Роутер: диск, снимок применённого, состояние плагина. Время идёт по `step()` — одному «тику» плагина. */
const router = {
    disk: BASE, snapshot: BASE,
    state: 'idle' as NonNullable<AutoApplyStatus['state']>,
    enabled: true, verdict: 'ok' as 'ok' | 'reject' | 'stuck', applies: 0,
    last: undefined as AutoApplyStatus['last'],
    /** Ожидание → применение → исход. */
    step() {
        if (this.state === 'pending') { this.state = 'applying'; return }
        if (this.state !== 'applying') return
        this.applies++
        if (this.verdict === 'ok') { this.snapshot = clone(this.disk); this.state = 'idle'; this.last = { ok: true, at: 1, source: 'pause', message: '' } }
        else if (this.verdict === 'reject') { this.state = 'rejected'; this.last = { ok: false, at: 1, source: 'pause', message: 'cannot read a list' } }
        else { this.state = 'unapplied'; this.last = { ok: false, at: 1, source: 'pause', message: 'core is busy' } }
    },
}

let set: ReturnType<typeof vi.spyOn>
let apply: ReturnType<typeof vi.spyOn>
let kick: ReturnType<typeof vi.spyOn>
let cancel: ReturnType<typeof vi.spyOn>

async function open(onDisk: Spec = BASE, applied: Spec = BASE, state: typeof router.state = 'idle') {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    Object.assign(router, { disk: clone(onDisk), snapshot: clone(applied), state, enabled: true, verdict: 'ok', applies: 0, last: undefined })
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => clone(router.disk))
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => clone(router.snapshot))
    set = vi.spyOn(rpc, 'specSet').mockImplementation((async (json: string) => {
        router.disk = decodeSpec(JSON.parse(json))
        if (router.enabled && router.state !== 'applying') router.state = 'pending'
        return { ok: true }
    }) as never)
    apply = vi.spyOn(rpc, 'apply').mockImplementation((async () => { router.snapshot = clone(router.disk); return { ok: true, output: '' } }) as never)
    vi.spyOn(rpc, 'autoapplyStatus').mockImplementation((async () => ({ ok: true, enabled: router.enabled, state: router.state, last: router.last })) as never)
    kick = vi.spyOn(rpc, 'autoapplyKick').mockImplementation((async () => { router.state = 'pending'; return { ok: true, scheduled: true } }) as never)
    cancel = vi.spyOn(rpc, 'autoapplyCancel').mockImplementation((async () => {
        if (router.state === 'pending') router.state = 'unapplied'
        return { ok: true, cancelled: true }
    }) as never)
    const p = pending as unknown as Record<string, unknown>
    Object.assign(p, {
        saved: null, applied: null, dirty: false, applying: false, justApplied: false, savedFlash: false, appliedAt: 0,
        saveError: null, applyFailed: false, backend: null, following: false, followAgain: false, lastApplied: null, holds: 0,
    })
    await pending.load()
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const errors = () => vi.mocked(notify).mock.calls.filter(([, k]) => k === 'error').map(([t]) => String(t))
/** Запись (500 мс тишины) и первый круг слежения. */
const WRITE = 520

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('применяет роутер, страница следит', () => {
    it('правка записывается, apply со страницы не зовётся, «Применение» стоит, пока роутер занят', async () => {
        await open()
        expect(pending.backend).toBe(true)
        const stop = startAutoApply()
        try {
            pending.edit(withRule(1))
            /* Правка на экране сразу — до записи и до применения. */
            expect(pending.saved?.channels).toHaveLength(1)
            await tick(WRITE)
            expect(set).toHaveBeenCalledTimes(1)
            expect(pending.applying).toBe(true)
            router.step(); await tick(500)
            expect(pending.applying).toBe(true)
            router.step(); await tick(600)
            expect(pending.applying).toBe(false)
            expect(pending.applyFailed).toBe(false)
            expect(pending.count()).toBe(0)
            expect(pending.lastApplied?.changes).toHaveLength(1)
            /* Страница не применяла ни сама, ни по своему таймеру. */
            await tick(AUTO_APPLY_MS + 3000)
            expect(apply).not.toHaveBeenCalled()
            expect(router.applies).toBe(1)
        } finally { stop() }
    })

    it('правка во время применения уезжает сразу и применяется следом', async () => {
        await open()
        pending.edit(withRule(1))
        await tick(WRITE)
        router.step()                       // роутер применяет первую правку
        await tick(500)
        pending.edit(withRule(2))
        await tick(WRITE)
        /* Запись не ждала конца применения. */
        expect(set).toHaveBeenCalledTimes(2)
        expect(router.disk.channels).toHaveLength(2)
        router.step()                       // первое применение кончилось: снимок — уже с двумя правилами
        await tick(600)
        expect(pending.applying).toBe(false)
        expect(pending.count()).toBe(0)
        expect(pending.saved?.channels).toHaveLength(2)
    })

    it('ядро отвергло настройки: причина человеку, страница не закрыта для ухода', async () => {
        await open()
        router.verdict = 'reject'
        pending.edit(withRule(1))
        await tick(WRITE)
        router.step(); router.step()
        await tick(600)
        expect(pending.applying).toBe(false)
        expect(pending.applyFailed).toBe(true)
        expect(errors().some((t) => t.includes('cannot read a list'))).toBe(true)
        /* Записанное применит (или не применит) роутер — страницу это не держит. */
        expect(pending.unfinished()).toBe(false)
    })

    it('записано, не применено и никто не занят — роутер получает просьбу применить сейчас', async () => {
        await open()
        pending.edit(withRule(1))
        await tick(WRITE)
        router.state = 'unapplied'          // ожидание пропало (перезагрузка роутера в паузе)
        await tick(1100)                    // состояние повторилось — просьба
        expect(kick).toHaveBeenCalledTimes(1)
        router.step(); router.step()
        await tick(600)
        expect(pending.applying).toBe(false)
        expect(pending.applyFailed).toBe(false)
        expect(pending.count()).toBe(0)
    })

    it('просьба не помогла — отказ с причиной последнего применения, без второй просьбы', async () => {
        await open()
        router.verdict = 'stuck'
        pending.edit(withRule(1))
        await tick(WRITE)
        router.step(); router.step()        // «не состоялось»: unapplied
        await tick(1100)
        expect(kick).toHaveBeenCalledTimes(1)
        router.step(); router.step()
        await tick(1600)
        expect(kick).toHaveBeenCalledTimes(1)
        expect(pending.applying).toBe(false)
        expect(pending.applyFailed).toBe(true)
        expect(errors().some((t) => t.includes('core is busy'))).toBe(true)
    })

    it('открытие страницы с записанным и не применённым: «Применение» и доведение до конца', async () => {
        await open(withRule(1), BASE, 'unapplied')
        expect(pending.applying).toBe(true)
        await tick(600)
        expect(kick).toHaveBeenCalledTimes(1)
        router.step(); router.step()
        await tick(600)
        expect(pending.applying).toBe(false)
        expect(pending.count()).toBe(0)
    })

    it('пачка правок: применение на роутере придерживается и идёт один раз в конце', async () => {
        await open()
        const release = pending.hold()
        pending.edit(withRule(1))
        await tick(WRITE)
        pending.edit(withRule(2))
        await tick(WRITE)
        expect(cancel).toHaveBeenCalledTimes(2)
        expect(router.applies).toBe(0)
        expect(pending.applying).toBe(false)
        release()
        await tick(50)
        expect(kick).toHaveBeenCalledTimes(1)
        router.step(); router.step()
        await tick(600)
        expect(router.applies).toBe(1)
        expect(pending.count()).toBe(0)
    })

    it('плагина нет или он выключен — применяет страница, как прежде', async () => {
        await open()
        router.enabled = false
        const p = pending as unknown as Record<string, unknown>
        Object.assign(p, { saved: null, applied: null, backend: null })
        await pending.load()
        expect(pending.backend).toBe(false)
        const stop = startAutoApply()
        try {
            pending.edit(withRule(1))
            await tick(500 + 1800 + AUTO_APPLY_MS + 200)
            expect(apply).toHaveBeenCalledTimes(1)
            expect(pending.count()).toBe(0)
        } finally { stop() }
    })
})
