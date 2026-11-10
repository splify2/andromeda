import { render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import SubsBoard from '@/components/board/SubsBoard'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'

// ВЫБОР ПЕРИОДА ОБНОВЛЕНИЯ — В СТРОКЕ ПОДПИСКИ НА ДОСКЕ VPN.
//
// Он жил только в подпункте «Узлы и автообновление», и с доски, где подписку заводят и обновляют, его
// не было видно: владелец счёл, что выбор пропал. Проверяется, что выбор есть у подписки по ссылке,
// показывает то, что хранит роутер, пишет через sub_auto и что у вставленных руками ссылок его нет.

type Subs = Awaited<ReturnType<typeof rpc.subList>>['subs']
const URL_SUB = { name: 'sub1', title: 'Панель', kind: 'url', url: 'https://panel.example/sub/abc', present: true, auto: 0 }
const LINKS_SUB = { name: 'sub2', title: 'Свои ссылки', kind: 'links', present: true }

let disk: Record<string, unknown>[]
let auto: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    try { localStorage.clear() } catch { /* нет хранилища — нечего чистить */ }
    disk = [{ ...URL_SUB }, { ...LINKS_SUB }]
    vi.spyOn(rpc, 'subList').mockImplementation((async () => ({ subs: JSON.parse(JSON.stringify(disk)) as Subs })) as never)
    auto = vi.spyOn(rpc, 'subAuto').mockImplementation((async (name: string, minutes: number) => {
        if (minutes === 30) return { ok: false, error: 'реже раза в 30 мин нельзя' }
        const s = disk.find((x) => x.name === name)
        if (s) s.auto = minutes
        return { ok: true, name, auto: minutes }
    }) as never)
})

describe('доска подписок: как часто роутер обновляет подписку', () => {
    it('у подписки по ссылке есть выбор периода, у вставленных ссылок — нет', async () => {
        render(<SubsBoard />)
        await screen.findByText('Панель')
        expect(screen.getAllByRole('combobox', { name: 'Обновлять' })).toHaveLength(1)
    })

    it('показывает период с роутера и пишет новый через sub_auto', async () => {
        disk[0].auto = 60
        render(<SubsBoard />)
        const sel = (await screen.findByRole('combobox', { name: 'Обновлять' })) as HTMLSelectElement
        expect(sel.value).toBe('60')
        await userEvent.selectOptions(sel, '1440')
        await waitFor(() => expect(auto).toHaveBeenCalledWith('sub1', 1440))
        await waitFor(() => expect((screen.getByRole('combobox', { name: 'Обновлять' }) as HTMLSelectElement).value).toBe('1440'))
        expect(notify).not.toHaveBeenCalled()
    })

    it('период, заданный мимо страницы, показывается как есть, а не подменяется «Вручную»', async () => {
        disk[0].auto = 45
        render(<SubsBoard />)
        const sel = (await screen.findByRole('combobox', { name: 'Обновлять' })) as HTMLSelectElement
        expect(sel.value).toBe('45')
        expect(sel.selectedOptions[0].textContent).toBe('каждые 45 мин')
    })

    it('отказ роутера назван его словами, выбор остаётся прежним', async () => {
        disk[0].auto = 60
        render(<SubsBoard />)
        const sel = (await screen.findByRole('combobox', { name: 'Обновлять' })) as HTMLSelectElement
        await userEvent.selectOptions(sel, '30')
        await waitFor(() => expect(notify).toHaveBeenCalledWith('реже раза в 30 мин нельзя', 'error'))
        await waitFor(() => expect((screen.getByRole('combobox', { name: 'Обновлять' }) as HTMLSelectElement).value).toBe('60'))
    })
})
