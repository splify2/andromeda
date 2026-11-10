import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import IfacesPanel from '@/components/IfacesPanel'
import SetupWizard from '@/components/board/SetupWizard'
import Vpn from '@/components/sections/Vpn'
import { tunnelName, withTunnel } from '@/lib/awg'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { awgRpc, rpc, type AwgPut, type AwgTunnel } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { encodeSpec } from '@/lib/specv2'
import { live } from './fixtures'

// Свой туннель WireGuard или AmneziaWG добавляется файлом или текстом — в настройки сети роутера
// человека не отправляют. Файл принимает бэкенд (awg_put), выход `kind: awg` кладёт в черновик
// панель; плагин вида ставится заданием, когда его нет.

const CONF = '[Interface]\nPrivateKey = YAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\nAddress = 10.8.0.2/32\n\n[Peer]\nPublicKey = HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=\nEndpoint = 203.0.113.7:51820\n'
const EMPTY: Spec = { schema: 1, outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] }
const put = (over: Partial<AwgPut> = {}): AwgPut => ({
    ok: true, name: 'nl', conf: '/etc/steer/awg/nl.conf', endpoint: '203.0.113.7:51820', addresses: ['10.8.0.2/32'],
    amnezia: false, ipv6: 'off', checked: true, plugin: 'awg', plugin_ready: true,
    output: { kind: 'awg', on_fail: 'drop', ipv6: 'off' }, ...over,
})
const file = (over: Partial<AwgTunnel> = {}): AwgTunnel => ({
    name: 'nl', conf: '/etc/steer/awg/nl.conf', endpoint: '203.0.113.7:51820', addresses: ['10.8.0.2/32'],
    amnezia: false, ipv6: 'off', outputs: [], ...over,
})
const said = () => vi.mocked(notify).mock.calls.map(([t, k]) => [t, k])

function boot(spec: Spec, files: AwgTunnel[] | 'old' = [], devices: { name: string; up: boolean; kind: string }[] = []) {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    window.localStorage.clear()
    pending.saved = spec
    pending.applied = spec
    vi.spyOn(rpc, 'specGet').mockResolvedValue(spec)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices })
    const list = vi.spyOn(awgRpc, 'list')
    if (files === 'old') list.mockRejectedValue(new Error('Method not found'))
    else list.mockResolvedValue({ ok: true, plugin_ready: true, dir: '/etc/steer/awg', tunnels: files })
    return vi.spyOn(pending, 'edit')
}

async function fill(name: string, text = CONF) {
    fireEvent.input(await screen.findByLabelText('Имя'), { target: { value: name } })
    fireEvent.input(screen.getByLabelText('Текст файла туннеля'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить туннель' }))
}

describe('Свои туннели: добавить файлом или текстом', () => {
    it('туннелей нет: форма добавления вместо отсылки в настройки сети роутера', async () => {
        boot(EMPTY)
        render(<IfacesPanel live={live()} />)
        expect(await screen.findByText('Своих туннелей пока нет')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Добавить туннель' })).toBeDisabled()
        expect(document.body.textContent).not.toMatch(/настройках сети/)
    })

    it('текст принят: файл уходит бэкенду, в черновик ложится выход awg без пути и ключей', async () => {
        const edit = boot(EMPTY)
        const p = vi.spyOn(awgRpc, 'put').mockResolvedValue(put())
        render(<IfacesPanel live={live()} />)
        await fill('nl')
        await waitFor(() => expect(edit).toHaveBeenCalled())
        expect(p).toHaveBeenCalledWith('nl', CONF)
        const next = edit.mock.calls[0][0] as Spec
        expect(next.outputs.nl).toEqual({ name: 'nl', kind: 'awg', on_fail: 'drop', ipv6: 'off' })
        expect(JSON.stringify(next)).not.toMatch(/PrivateKey|YAnz5/)
        /* Что уйдёт ядру: выход вида awg без `conf` — файл ядро находит по имени выхода. */
        const v2 = encodeSpec(next) as unknown as { outputs: Record<string, Record<string, unknown>> }
        expect(v2.outputs.nl).toMatchObject({ kind: 'awg', ipv6: 'off' })
        expect(v2.outputs.nl.conf).toBeUndefined()
        expect(said()).toEqual([['Туннель nl добавлен', 'info']])
        /* Текст с ключом в форме не остаётся. */
        expect((screen.getByLabelText('Текст файла туннеля') as HTMLTextAreaElement).value).toBe('')
    })

    it('файл: текст читается в форму, имя берётся из имени файла', async () => {
        boot({ ...EMPTY, outputs: { ...EMPTY.outputs, amsterdam: { name: 'amsterdam', kind: 'interface', device: 'wg0', devices: ['wg0'] } } })
        const p = vi.spyOn(awgRpc, 'put').mockResolvedValue(put({ name: 'amsterdam2' }))
        render(<IfacesPanel live={live()} />)
        const input = await screen.findByLabelText('Файл туннеля')
        const f = new File([CONF], 'amsterdam.conf', { type: 'text/plain' })
        Object.defineProperty(input, 'files', { value: [f] })
        fireEvent(input, new Event('change', { bubbles: true }))
        await waitFor(() => expect((screen.getByLabelText('Текст файла туннеля') as HTMLTextAreaElement).value).toBe(CONF))
        /* Имя amsterdam занято выходом другого вида — подставлено свободное. */
        expect((screen.getByLabelText('Имя') as HTMLInputElement).value).toBe('amsterdam2')
        fireEvent.click(screen.getByRole('button', { name: 'Добавить туннель' }))
        await waitFor(() => expect(p).toHaveBeenCalledWith('amsterdam2', CONF))
    })

    it('отказ бэкенда — его словами, выход не добавлен, текст остаётся для правки', async () => {
        const edit = boot(EMPTY)
        vi.spyOn(awgRpc, 'put').mockResolvedValue({ ok: false, error: 'файл туннеля не принят: строка 2: PrivateKey — не ключ WireGuard (44 знака base64)', code: 'awg.rejected' })
        render(<IfacesPanel live={live()} />)
        await fill('nl', '[Interface]\nPrivateKey = x\n')
        await waitFor(() => expect(said()).toEqual([['файл туннеля не принят: строка 2: PrivateKey — не ключ WireGuard (44 знака base64)', 'error']]))
        expect(edit).not.toHaveBeenCalled()
        expect((screen.getByLabelText('Текст файла туннеля') as HTMLTextAreaElement).value).toBe('[Interface]\nPrivateKey = x\n')
    })

    it('имя занято выходом другого вида — до вызова бэкенда', async () => {
        boot({ ...EMPTY, outputs: { ...EMPTY.outputs, nl: { name: 'nl', kind: 'interface', device: 'wg0', devices: ['wg0'] } } })
        const p = vi.spyOn(awgRpc, 'put')
        render(<IfacesPanel live={live()} />)
        await fill('nl')
        await waitFor(() => expect(said()).toEqual([['Имя nl занято', 'warning']]))
        expect(p).not.toHaveBeenCalled()
    })

    it('плагина awg нет: ставится заданием, и только потом выход ложится в черновик', async () => {
        const edit = boot(EMPTY)
        vi.spyOn(awgRpc, 'put').mockResolvedValue(put({ plugin_ready: false, checked: false }))
        const inst = vi.spyOn(rpc, 'pluginInstall').mockResolvedValue({ ok: true, job: '7' })
        const job = vi.spyOn(rpc, 'pluginJob')
            .mockResolvedValueOnce({ ok: true, state: 'running', progress: 'пакет kmod-wireguard для awg' } as never)
            .mockResolvedValue({ ok: true, state: 'done' } as never)
        vi.spyOn(rpc, 'pluginsList').mockRejectedValue(new Error('нет'))
        render(<IfacesPanel live={live()} />)
        await fill('nl')
        expect(await screen.findByText('пакет kmod-wireguard для awg', {}, { timeout: 5000 })).toBeInTheDocument()
        expect(edit).not.toHaveBeenCalled()
        await waitFor(() => expect(edit).toHaveBeenCalled(), { timeout: 5000 })
        expect(inst).toHaveBeenCalledWith('awg', undefined)
        expect(job).toHaveBeenCalledWith('7')
        expect((edit.mock.calls[0][0] as Spec).outputs.nl.kind).toBe('awg')
    })

    it('плагин не встал — выход не добавлен, причина названа', async () => {
        const edit = boot(EMPTY)
        vi.spyOn(awgRpc, 'put').mockResolvedValue(put({ plugin_ready: false }))
        vi.spyOn(rpc, 'pluginInstall').mockResolvedValue({ ok: false, error: 'awg не встаёт: не поставился ни один из пакетов kmod-amneziawg, kmod-wireguard' })
        render(<IfacesPanel live={live()} />)
        await fill('nl')
        await waitFor(() => expect(said()).toEqual([['Модуль туннеля не установлен: awg не встаёт: не поставился ни один из пакетов kmod-amneziawg, kmod-wireguard', 'error']]))
        expect(edit).not.toHaveBeenCalled()
    })

    it('бэкенд старше методов awg: формы нет, туннели роутера работают как прежде', async () => {
        boot(EMPTY, 'old', [{ name: 'wg9', up: true, kind: 'wireguard' }])
        render(<IfacesPanel live={live()} />)
        await screen.findByRole('switch', { name: 'wg9' })
        expect(screen.queryByRole('button', { name: 'Добавить туннель' })).toBeNull()
    })
})

describe('Свои туннели: добавленные', () => {
    const WITH: Spec = { ...EMPTY, outputs: { ...EMPTY.outputs, nl: { name: 'nl', kind: 'awg', on_fail: 'drop', ipv6: 'off' } } }

    it('строка туннеля: вид, сервер, включён; рядом — туннели роутера', async () => {
        boot(WITH, [file({ outputs: ['nl'], amnezia: true })], [{ name: 'wg9', up: true, kind: 'wireguard' }])
        render(<IfacesPanel live={live({ status: { outputs: { nl: { up: true } } } as never })} />)
        const sw = await screen.findByRole('switch', { name: 'nl' })
        expect(sw).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByText('AmneziaWG · сервер 203.0.113.7:51820')).toBeInTheDocument()
        expect(screen.getByText('Добавленные туннели')).toBeInTheDocument()
        expect(screen.getByText('Туннели роутера')).toBeInTheDocument()
        expect(screen.getByRole('switch', { name: 'wg9' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Удалить nl' })).toBeNull()
    })

    it('отклик меряется тем же вызовом, что у любого выхода', async () => {
        boot(WITH, [file({ outputs: ['nl'] })])
        const probe = vi.spyOn(rpc, 'outboundProbe').mockResolvedValue({ output: 'nl', state: 'ok', ms: 31, how: 'ping' })
        render(<IfacesPanel live={live()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Проверить отклик nl' }))
        expect(await screen.findByText('отклик 31 мс')).toBeInTheDocument()
        expect(probe).toHaveBeenCalledWith('nl')
    })

    it('выключение убирает выход из черновика, файл не трогает', async () => {
        const edit = boot(WITH, [file({ outputs: ['nl'] })])
        const del = vi.spyOn(awgRpc, 'del')
        render(<IfacesPanel live={live()} />)
        fireEvent.click(await screen.findByRole('switch', { name: 'nl' }))
        expect(Object.keys((edit.mock.calls[0][0] as Spec).outputs)).toEqual(['direct'])
        expect(del).not.toHaveBeenCalled()
    })

    it('туннель под правилом не выключается: сказано, кто его держит', async () => {
        const edit = boot({ ...WITH, channels: [{ name: 'YouTube', out: 'nl', match: {} }] }, [file({ outputs: ['nl'] })])
        render(<IfacesPanel live={live()} />)
        fireEvent.click(await screen.findByRole('switch', { name: 'nl' }))
        expect(edit).not.toHaveBeenCalled()
        expect(said()[0][1]).toBe('warning')
        expect(said()[0][0]).toMatch(/YouTube/)
    })

    it('файл без выхода: «не используется», включается обратно без вставки текста', async () => {
        const edit = boot(EMPTY, [file({ ipv6: 'nat' })])
        render(<IfacesPanel live={live()} />)
        expect(await screen.findByText('WireGuard · сервер 203.0.113.7:51820 · не используется')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('switch', { name: 'nl' }))
        expect((edit.mock.calls[0][0] as Spec).outputs.nl).toEqual({ name: 'nl', kind: 'awg', on_fail: 'drop', ipv6: 'nat' })
    })

    it('удаление файла — вызовом бэкенда; его отказ («ещё работает») показан словами', async () => {
        boot(EMPTY, [file()])
        const del = vi.spyOn(awgRpc, 'del')
            .mockResolvedValueOnce({ ok: false, code: 'awg.in_use_applied', error: 'туннель nl ещё работает по применённым настройкам — сначала примените изменения' })
            .mockResolvedValue({ ok: true, name: 'nl' })
        render(<IfacesPanel live={live()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Удалить nl' }))
        await waitFor(() => expect(said()).toEqual([['туннель nl ещё работает по применённым настройкам — сначала примените изменения', 'error']]))
        expect(screen.getByRole('switch', { name: 'nl' })).toBeInTheDocument()
        vi.mocked(awgRpc.list).mockResolvedValue({ ok: true, tunnels: [] })
        fireEvent.click(screen.getByRole('button', { name: 'Удалить nl' }))
        await waitFor(() => expect(screen.queryByRole('switch', { name: 'nl' })).toBeNull())
        expect(del).toHaveBeenCalledWith('nl')
        expect(said()[1]).toEqual(['Туннель nl удалён', 'info'])
    })
})

describe('Мастер первой настройки: свой туннель файлом', () => {
    function wizard(spec: Spec, files: AwgTunnel[] | 'old', devices: { name: string; up: boolean; kind: string }[] = []) {
        const edit = boot(spec, files, devices)
        vi.spyOn(rpc, 'manifest').mockRejectedValue(new Error('нет'))
        vi.spyOn(rpc, 'allowDomains').mockRejectedValue(new Error('нет'))
        vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: { 'custom/domains/mine.lst': { count: 3, mtime: 1 } } } as never)
        vi.spyOn(rpc, 'uiGet').mockResolvedValue({ state: '{}' } as never)
        vi.spyOn(rpc, 'uiSet').mockResolvedValue({ ok: true } as never)
        const done = vi.fn()
        render(<SetupWizard onDone={done} />)
        return { edit, done }
    }

    it('туннелей на роутере нет — «Свой туннель» доступен: файл или текст', async () => {
        const { edit, done } = wizard(EMPTY, [])
        vi.spyOn(awgRpc, 'put').mockResolvedValue(put({ ipv6: 'nat', output: { kind: 'awg', on_fail: 'drop', ipv6: 'nat' } }))
        fireEvent.click(await screen.findByRole('button', { name: 'Начать' }))
        const own = await screen.findByRole('button', { name: /Свой туннель/ })
        await waitFor(() => expect(own).not.toBeDisabled())
        expect(own).toHaveTextContent('Файл или текст WireGuard либо AmneziaWG')
        fireEvent.click(own)
        expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
        await fill('nl')
        expect(await screen.findByText('Туннель nl добавлен')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
        fireEvent.click(await screen.findByRole('button', { name: /mine/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Далее' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Готово' }))
        await waitFor(() => expect(done).toHaveBeenCalled())
        const next = edit.mock.calls[0][0] as Spec
        expect(next.outputs.nl).toEqual({ name: 'nl', kind: 'awg', on_fail: 'drop', ipv6: 'nat' })
        /* Правило ведёт в выход туннеля. */
        expect(next.channels).toHaveLength(1)
        expect(next.channels[0].out).toBe('nl')
    })

    it('туннель роутера по-прежнему можно выбрать, и он не смешивается с добавленным', async () => {
        wizard(EMPTY, [], [{ name: 'wg9', up: true, kind: 'wireguard' }])
        fireEvent.click(await screen.findByRole('button', { name: 'Начать' }))
        fireEvent.click(await screen.findByRole('button', { name: /Свой туннель/ }))
        expect(await screen.findByText('Туннели роутера')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'wg9' }))
        expect(screen.getByRole('button', { name: 'wg9' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Далее' })).not.toBeDisabled()
        expect(screen.getByRole('button', { name: 'Добавить туннель' })).toBeInTheDocument()
    })

    it('бэкенд старше методов awg и туннелей нет — ветка недоступна, как прежде', async () => {
        wizard(EMPTY, 'old')
        fireEvent.click(await screen.findByRole('button', { name: 'Начать' }))
        const own = await screen.findByRole('button', { name: /Свой туннель/ })
        expect(own).toBeDisabled()
        expect(own).toHaveTextContent('Туннелей на роутере нет')
    })
})

describe('VPN: подпись «Своих туннелей»', () => {
    it('добавленный туннель назван в подписи', async () => {
        boot({ ...EMPTY, outputs: { ...EMPTY.outputs, nl: { name: 'nl', kind: 'awg', on_fail: 'drop', ipv6: 'off' } } })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        render(<Vpn live={live()} />)
        expect(await screen.findByText('используются: nl')).toBeInTheDocument()
    })
})

describe('имя и выход туннеля', () => {
    it('имя из имени файла: без расширения и чужих знаков, занятое — с номером, слова ядра — нет', () => {
        expect(tunnelName('amsterdam.conf', [])).toBe('amsterdam')
        expect(tunnelName('мой туннель (1).conf', [])).toBe('1')
        expect(tunnelName('...conf', [])).toBe('tunnel')
        expect(tunnelName('direct.conf', [])).toBe('tunnel')
        expect(tunnelName('nl.conf', ['nl', 'nl2'])).toBe('nl3')
        expect(tunnelName('', ['tunnel'])).toBe('tunnel2')
    })

    it('замена файла уже добавленного туннеля выход не переписывает', () => {
        const spec: Spec = { ...EMPTY, outputs: { ...EMPTY.outputs, nl: { name: 'nl', kind: 'awg', on_fail: 'direct', ipv6: 'nat' } } }
        expect(withTunnel(spec, 'nl', put())).toBe(spec)
    })
})
