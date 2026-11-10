import { useId, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileButton, inputCls } from '@/components/formbits'
import { importTunnel, tunnelName, TUNNEL_NAME_RE } from '@/lib/awg'
import { notify } from '@/lib/notify'
import type { AwgPut } from '@/lib/rpc'
import { S } from '@/copy'

/** Добавить свой туннель: файл или текст WireGuard либо AmneziaWG.
 *
 *  Одна форма на все места, где туннель добавляют (мастер первой настройки, «Свои туннели»): имя,
 *  текст, кнопка выбора файла. Файл читается в браузере и ложится в то же поле — человек видит, что
 *  уйдёт на роутер, и может поправить. Что делать с принятым туннелем (положить выход в спеку,
 *  выбрать его в правиле), решает вызывающий: `onAdded` получает имя и ответ бэкенда.
 *
 *  Текст с ключом живёт только в состоянии формы и стирается сразу после приёма. */
export default function TunnelImport({ taken, onAdded }: {
    /** Занятые имена: выходы других видов и файлы уже добавленных туннелей. Под тем же именем новый
     *  туннель заменил бы ключи прежнего — форма такое имя не отдаёт, а бэкенд без `replace` отказывает. */
    taken: string[]
    onAdded: (name: string, r: AwgPut) => void
}) {
    const id = useId()
    const [name, setName] = useState('')
    /** Имя подставлено формой (из имени файла), а не набрано человеком: его можно заменить следующим файлом. */
    const [auto, setAuto] = useState(true)
    const [text, setText] = useState('')
    const [busy, setBusy] = useState(false)
    const [step, setStep] = useState('')

    async function fromFile(f: File) {
        try {
            const t = await f.text()
            setText(t)
            if (auto) setName(tunnelName(f.name, taken))
        } catch {
            notify(S.tunnelImport.faylNeProchitan, 'error')
        }
    }

    async function add() {
        const n = name.trim() || tunnelName('', taken)
        if (!TUNNEL_NAME_RE.test(n)) { notify(S.tunnelImport.nuzhnoImya, 'warning'); return }
        if (taken.includes(n) || n === 'direct' || n === 'block') { notify(S.tunnelImport.imyaZanyato(n), 'warning'); return }
        if (!text.trim()) { notify(S.tunnelImport.nuzhenTekst, 'warning'); return }
        setBusy(true)
        setStep(S.tunnelImport.dobavlyaem)
        try {
            const r = await importTunnel(n, text, setStep)
            setText('')
            setName('')
            setAuto(true)
            onAdded(n, r)
            notify(S.tunnelImport.dobavlen(n), 'info')
        } catch (e) {
            notify(e instanceof Error ? e.message : String(e), 'error')
        } finally {
            setBusy(false)
            setStep('')
        }
    }

    return (
        <div className="space-y-2.5">
            <div>
                <div className="text-sm font-medium">{S.tunnelImport.zagolovok}</div>
                <div className="mt-0.5 text-xs text-subtle">{S.tunnelImport.podskazka}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">{S.tunnelImport.imya}</label>
                <input
                    id={`${id}-name`}
                    className={inputCls + ' w-40 font-mono'}
                    value={name}
                    onChange={(e) => { setName(e.currentTarget.value); setAuto(false) }}
                    placeholder={tunnelName('', taken)}
                    spellCheck={false}
                    disabled={busy}
                />
                <FileButton accept=".conf,.txt,text/plain" label={S.tunnelImport.fayl} disabled={busy} onFile={(f) => void fromFile(f)} />
            </div>
            <textarea
                aria-label={S.tunnelImport.tekst}
                className={inputCls + ' h-32 w-full resize-y py-2 font-mono text-xs'}
                value={text}
                onChange={(e) => setText(e.currentTarget.value)}
                placeholder={S.tunnelImport.tekstPlaceholder}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
            />
            <div className="flex items-center gap-3">
                <Button type="button" onClick={() => void add()} disabled={busy || !text.trim()}>
                    {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                    {S.tunnelImport.dobavit}
                </Button>
                {busy && step && <span role="status" className="text-xs text-muted-foreground">{step}</span>}
            </div>
        </div>
    )
}
