'use client'

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  School, Users, Heart, BadgeDollarSign, Save, Plus, X, Check,
  AlertCircle, Settings, Mail, ExternalLink, Wifi, WifiOff, CreditCard, Trash2, KeyRound
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'

type Tab = 'general' | 'students' | 'donors' | 'tuition' | 'email' | 'payments'

// ── helpers ──────────────────────────────────────────────────────────────────

function useSettings() {
  const supabase = createClient()

  const get = useCallback(async (key: string): Promise<string> => {
    const { data } = await supabase.from('site_settings').select('value').eq('key', key).single()
    return data?.value ?? ''
  }, [supabase])

  const set = useCallback(async (key: string, value: string) => {
    await supabase.from('site_settings').upsert({ key, value }, { onConflict: 'key' })
  }, [supabase])

  const getAll = useCallback(async (keys: string[]): Promise<Record<string, string>> => {
    const { data } = await supabase.from('site_settings').select('key,value').in('key', keys)
    const map: Record<string, string> = {}
    for (const row of data || []) map[row.key] = row.value
    return map
  }, [supabase])

  function parseList(raw: string): string[] {
    try { return JSON.parse(raw) } catch { return [] }
  }

  return { get, set, getAll, parseList }
}

function ListEditor({
  title,
  items,
  onChange,
  placeholder,
}: {
  title: string
  items: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')

  function add() {
    const v = input.trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setInput('')
  }

  function remove(item: string) {
    onChange(items.filter(i => i !== item))
  }

  return (
    <div>
      <p className="text-sm font-medium text-slate-700 mb-2">{title}</p>
      <div className="flex flex-wrap gap-2 mb-2 min-h-[2rem]">
        {items.map(item => (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-sm px-2.5 py-1 rounded-full"
          >
            {item}
            <button
              onClick={() => remove(item)}
              className="text-slate-400 hover:text-red-500 transition-colors"
              title="Remove"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {items.length === 0 && <p className="text-xs text-slate-400 italic">None added yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder ?? 'Add item…'}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={add}
          disabled={!input.trim() || items.includes(input.trim())}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  )
}

function SaveBar({ onSave, saving, saved }: { onSave: () => void; saving: boolean; saved: boolean }) {
  return (
    <div className="flex justify-end pt-4 border-t border-slate-100">
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
      >
        {saving ? (
          <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
        ) : saved ? (
          <Check size={15} />
        ) : (
          <Save size={15} />
        )}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
      </button>
    </div>
  )
}

// ── Tab sections ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const { getAll, set } = useSettings()
  const [fields, setFields] = useState({
    school_name: '', school_email: '', school_phone: '', school_address: '', school_tagline: '', logo_url: '', website: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getAll(['school_name','school_email','school_phone','school_address','school_tagline','logo_url','website']).then(m => {
      setFields(prev => ({ ...prev, ...m }))
    })
  }, [getAll])

  async function save() {
    setSaving(true)
    await Promise.all(Object.entries(fields).map(([k, v]) => set(k, v)))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function field(key: keyof typeof fields, label: string, type = 'text', rows?: number) {
    return (
      <div key={key}>
        <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
        {rows ? (
          <textarea
            value={fields[key]}
            onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
            rows={rows}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <input
            type={type}
            value={fields[key]}
            onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {field('school_name', 'School Name')}
        {field('school_tagline', 'Tagline / Motto')}
        {field('school_email', 'Email Address', 'email')}
        {field('school_phone', 'Phone Number', 'tel')}
        {field('logo_url', 'Logo URL')}
        {field('website', 'Website URL', 'url')}
      </div>
      {field('school_address', 'Address', 'text', 2)}
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function StudentsTab() {
  const { getAll, set } = useSettings()
  const [grades, setGrades] = useState<string[]>([])
  const [semesters, setSemesters] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getAll(['grade_levels','semesters']).then(m => {
      try { setGrades(JSON.parse(m.grade_levels || '[]')) } catch { setGrades([]) }
      try { setSemesters(JSON.parse(m.semesters || '[]')) } catch { setSemesters([]) }
    })
  }, [getAll])

  async function save() {
    setSaving(true)
    await Promise.all([
      set('grade_levels', JSON.stringify(grades)),
      set('semesters', JSON.stringify(semesters)),
    ])
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5 space-y-4">
        <ListEditor
          title="Grade Levels"
          items={grades}
          onChange={setGrades}
          placeholder="e.g. 3rd Grade"
        />
      </div>
      <div className="bg-slate-50 rounded-xl p-5 space-y-4">
        <ListEditor
          title="Semesters / Terms"
          items={semesters}
          onChange={setSemesters}
          placeholder="e.g. Elul 2026"
        />
        <p className="text-xs text-slate-400">
          These appear as options when adding or editing a student&apos;s &quot;Semester Came&quot; field.
        </p>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function DonorsTab() {
  const supabase = createClient()
  const [categories, setCategories] = useState<string[]>([])
  const [relationships, setRelationships] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('donor_settings')
      .select('donor_categories,relationships')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCategories(data.donor_categories || [])
          setRelationships(data.relationships || [])
        }
      })
  }, [supabase])

  async function save() {
    setSaving(true)
    setError('')
    const { data: existing } = await supabase.from('donor_settings').select('id').limit(1).maybeSingle()
    const payload = { donor_categories: categories, relationships }
    const { error: err } = existing
      ? await supabase.from('donor_settings').update(payload).eq('id', existing.id)
      : await supabase.from('donor_settings').insert([payload])
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5">
        <ListEditor
          title="Donor Categories"
          items={categories}
          onChange={setCategories}
          placeholder="e.g. Major Donor"
        />
      </div>
      <div className="bg-slate-50 rounded-xl p-5">
        <ListEditor
          title="Relationships"
          items={relationships}
          onChange={setRelationships}
          placeholder="e.g. Alumni Parent"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle size={15} /> {error}
        </div>
      )}
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function TuitionTab() {
  const { getAll, set } = useSettings()
  const [years, setYears] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getAll(['academic_years']).then(m => {
      try { setYears(JSON.parse(m.academic_years || '[]')) } catch { setYears([]) }
    })
  }, [getAll])

  async function save() {
    setSaving(true)
    await set('academic_years', JSON.stringify(years))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5">
        <ListEditor
          title="Academic Years"
          items={years}
          onChange={setYears}
          placeholder="e.g. 2027-2028"
        />
        <p className="text-xs text-slate-400 mt-2">
          These appear as options when creating a tuition plan for a student.
        </p>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function EmailTab() {
  const { getAll, set } = useSettings()
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [connected, setConnected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Feedback from OAuth redirect, derived directly from the URL — no effect needed.
  const status = useMemo<{ type: 'success' | 'error'; msg: string } | null>(() => {
    const err = searchParams.get('error')
    const ok  = searchParams.get('success')
    if (ok === 'connected') return { type: 'success', msg: 'Google account connected successfully!' }
    if (err === 'missing_credentials') return { type: 'error', msg: 'Save your Client ID and Secret first, then connect.' }
    if (err === 'oauth_denied')       return { type: 'error', msg: 'Google authorization was cancelled.' }
    if (err === 'token_exchange')     return { type: 'error', msg: 'Failed to exchange authorization code. Check your credentials.' }
    return null
  }, [searchParams])

  useEffect(() => {
    getAll(['google_client_id', 'google_client_secret', 'google_refresh_token', 'google_from_email']).then(m => {
      setClientId(m.google_client_id || '')
      setClientSecret(m.google_client_secret || '')
      setFromEmail(m.google_from_email || '')
      setConnected(!!m.google_refresh_token)
    })
  }, [getAll])

  async function saveCredentials() {
    setSaving(true)
    await Promise.all([
      set('google_client_id',     clientId.trim()),
      set('google_client_secret', clientSecret.trim()),
    ])
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function disconnect() {
    if (!confirm('Disconnect Google account? You will need to reconnect to send emails.')) return
    await supabase.from('site_settings').upsert({ key: 'google_refresh_token', value: '' }, { onConflict: 'key' })
    await supabase.from('site_settings').upsert({ key: 'google_from_email',    value: '' }, { onConflict: 'key' })
    setConnected(false)
    setFromEmail('')
  }

  return (
    <div className="space-y-6">
      {status && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
          status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {status.type === 'success' ? <Check size={15} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />}
          {status.msg}
        </div>
      )}

      {/* Connection status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${connected ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
        {connected
          ? <Wifi size={20} className="text-green-600 flex-shrink-0" />
          : <WifiOff size={20} className="text-slate-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${connected ? 'text-green-800' : 'text-slate-600'}`}>
            {connected ? 'Connected to Google' : 'Not connected'}
          </p>
          {fromEmail && <p className="text-xs text-green-600 mt-0.5">Sending as: {fromEmail}</p>}
          {!connected && <p className="text-xs text-slate-400 mt-0.5">Complete the steps below to send email from this CRM.</p>}
        </div>
        {connected && (
          <button onClick={disconnect} className="text-xs text-red-500 hover:text-red-700 font-medium flex-shrink-0">
            Disconnect
          </button>
        )}
      </div>

      {/* Step 1: Google Cloud setup instructions */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-blue-900">Step 1 — Set up Google Cloud credentials</p>
        <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
          <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">console.cloud.google.com <ExternalLink size={10} /></a></li>
          <li>Create a project (or select an existing one)</li>
          <li>Enable the <strong>Gmail API</strong> under APIs &amp; Services → Library</li>
          <li>Go to APIs &amp; Services → Credentials → Create OAuth 2.0 Client ID</li>
          <li>Application type: <strong>Web application</strong></li>
          <li>Add Authorized redirect URI: <code className="bg-blue-100 px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/auth/google/callback</code></li>
          <li>Copy the Client ID and Client Secret below</li>
        </ol>
      </div>

      {/* Step 2: Enter credentials */}
      <div className="space-y-4">
        <p className="text-sm font-semibold text-slate-700">Step 2 — Enter your credentials</p>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Google OAuth Client ID</label>
          <input
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="123456789-abc...apps.googleusercontent.com"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Google OAuth Client Secret</label>
          <input
            type="password"
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder="GOCSPX-…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
        </div>
        <SaveBar onSave={saveCredentials} saving={saving} saved={saved} />
      </div>

      {/* Step 3: Connect */}
      <div className="space-y-3 border-t border-slate-100 pt-5">
        <p className="text-sm font-semibold text-slate-700">Step 3 — Authorize with Google</p>
        <p className="text-xs text-slate-400">After saving your credentials above, click the button below to sign in with your Google Workspace account. You only need to do this once.</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this hits an API route (OAuth redirect), not a page */}
        <a
          href="/api/auth/google"
          className="inline-flex items-center gap-2 bg-white border border-slate-300 hover:border-blue-400 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.9 3 4 11.9 4 23s8.9 20 20 20c11 0 19.7-7.7 19.7-20 0-1.3-.1-2.7-.2-4z"/>
            <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3c-7.7 0-14.3 4.5-17.7 11.7z"/>
            <path fill="#FBBC05" d="M24 43c5.9 0 10.9-2 14.5-5.4l-6.7-5.5C29.9 34 27.1 35 24 35c-6 0-11.1-4-12.9-9.5l-7 5.4C7.8 38.7 15.4 43 24 43z"/>
            <path fill="#EA4335" d="M43.6 20H24v8.5h11.8c-.9 2.7-2.7 5-5 6.6l6.7 5.5C41.4 37.1 44 30.6 44 23c0-1.3-.1-2.7-.4-4z"/>
          </svg>
          {connected ? 'Reconnect Google Account' : 'Connect Google Account'}
        </a>
      </div>
    </div>
  )
}

function PaymentsTab() {
  const [state, setState] = useState<{ configured: boolean; masked?: string; updatedAt?: string; testMode: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [togglingTestMode, setTogglingTestMode] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/sola-settings')
    const json = await res.json()
    setState(json)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await
  useEffect(() => { load() }, [load])

  async function save() {
    if (!keyInput.trim()) { setError('Enter a key value.'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/sola-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: keyInput.trim() }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error || 'Failed to save.'); return }
    setState(s => s ? { ...s, ...json } : json)
    setKeyInput('')
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function remove() {
    if (!confirm('Remove the Sola API key? Payment processing will stop working until a new key is added.')) return
    setSaving(true); setError('')
    const res = await fetch('/api/sola-settings', { method: 'DELETE' })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error || 'Failed to remove.'); return }
    setState(s => s ? { ...s, ...json } : json)
  }

  async function toggleTestMode() {
    if (!state) return
    const next = !state.testMode
    if (!next && !confirm('Switch to LIVE mode? Real charges will be sent to Sola and real money will move. Are you sure?')) return
    setTogglingTestMode(true); setError('')
    const res = await fetch('/api/sola-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testMode: next }),
    })
    const json = await res.json()
    setTogglingTestMode(false)
    if (!res.ok) { setError(json.error || 'Failed to update test mode.'); return }
    setState(s => s ? { ...s, testMode: json.testMode } : s)
  }

  if (!state) return <p className="text-sm text-slate-400">Loading…</p>

  return (
    <div className="space-y-6">
      <div className={`flex items-center gap-3 p-4 rounded-xl border-2 ${state.testMode ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-400'}`}>
        <CreditCard size={20} className={state.testMode ? 'text-amber-600' : 'text-red-600'} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${state.testMode ? 'text-amber-800' : 'text-red-800'}`}>
            {state.testMode ? 'TEST MODE — no real charges will be processed' : 'LIVE MODE — real charges will be sent to Sola'}
          </p>
          <p className={`text-xs mt-0.5 ${state.testMode ? 'text-amber-600' : 'text-red-600'}`}>
            {state.testMode
              ? 'Charges, recurring schedules, and payment plans are simulated only. Client sync (creating customer profiles) still happens for real.'
              : 'Every charge, recurring schedule, and payment plan now processes real money. Turn test mode back on to stop.'}
          </p>
        </div>
        <button
          onClick={toggleTestMode}
          disabled={togglingTestMode}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
            state.testMode
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-amber-600 hover:bg-amber-700 text-white'
          }`}
        >
          {togglingTestMode ? 'Updating…' : state.testMode ? 'Enable Live Mode' : 'Switch to Test Mode'}
        </button>
      </div>

      <div className={`flex items-center gap-3 p-4 rounded-xl border ${state.configured ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
        <KeyRound size={20} className={state.configured ? 'text-green-600' : 'text-slate-400'} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${state.configured ? 'text-green-800' : 'text-slate-600'}`}>
            {state.configured ? `Sola API key configured (${state.masked})` : 'No Sola API key configured'}
          </p>
          {state.configured && state.updatedAt && (
            <p className="text-xs text-green-600 mt-0.5">Last updated {new Date(state.updatedAt).toLocaleString()}</p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            The key is never displayed once saved — only the last 4 characters are shown, and it&apos;s stored where
            only this server can read it, never the browser.
          </p>
        </div>
      </div>

      {saved && (
        <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <Check size={15} /> Saved.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              {state.configured ? 'New Sola API Key' : 'Sola API Key'}
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="Paste the key here"
              autoComplete="off"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save Key'}
            </button>
            <button
              onClick={() => { setEditing(false); setKeyInput(''); setError('') }}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <KeyRound size={15} /> {state.configured ? 'Replace Key' : 'Add Key'}
          </button>
          {state.configured && (
            <button
              onClick={remove}
              disabled={saving}
              className="flex items-center gap-2 text-red-600 hover:bg-red-50 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium border border-red-200 transition-colors"
            >
              <Trash2 size={15} /> Remove Key
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: 'general',
    label: 'General',
    icon: <School size={17} />,
    description: 'School name, contact info, and branding',
  },
  {
    id: 'students',
    label: 'Students',
    icon: <Users size={17} />,
    description: 'Grade levels and semesters',
  },
  {
    id: 'donors',
    label: 'Donors',
    icon: <Heart size={17} />,
    description: 'Donor categories and relationships',
  },
  {
    id: 'tuition',
    label: 'Tuition',
    icon: <BadgeDollarSign size={17} />,
    description: 'Academic years for tuition plans',
  },
  {
    id: 'email',
    label: 'Email',
    icon: <Mail size={17} />,
    description: 'Google Workspace email integration',
  },
  {
    id: 'payments',
    label: 'Payment Settings',
    icon: <CreditCard size={17} />,
    description: 'Sola payment processor API key',
  },
]

function SettingsContent() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) ?? 'general'
  const [tab, setTab] = useState<Tab>(TABS.some(t => t.id === initialTab) ? initialTab : 'general')
  const current = TABS.find(t => t.id === tab)!

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="bg-slate-100 p-2 rounded-xl">
          <Settings size={22} className="text-slate-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500">Manage your site configuration</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        <div className="sm:w-52 flex-shrink-0">
          <nav className="space-y-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                  tab === t.id
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className={`mt-0.5 ${tab === t.id ? 'text-blue-600' : 'text-slate-400'}`}>
                  {t.icon}
                </span>
                <div>
                  <p className="text-sm font-medium leading-tight">{t.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-tight">{t.description}</p>
                </div>
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 bg-white rounded-xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">{current.label}</h2>
          <p className="text-sm text-slate-500 mb-5">{current.description}</p>

          {tab === 'general'  && <GeneralTab />}
          {tab === 'students' && <StudentsTab />}
          {tab === 'donors'   && <DonorsTab />}
          {tab === 'tuition'  && <TuitionTab />}
          {tab === 'email'    && <EmailTab />}
          {tab === 'payments' && <PaymentsTab />}
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm py-12 text-center">Loading settings…</div>}>
      <SettingsContent />
    </Suspense>
  )
}
