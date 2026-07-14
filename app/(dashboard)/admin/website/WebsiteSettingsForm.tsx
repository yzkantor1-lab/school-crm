'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function WebsiteSettingsForm({ settings }: { settings: Record<string, string> }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const supabase = createClient()

  const set = (key: string, value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    await Promise.all(
      Object.entries(form).map(([key, value]) =>
        supabase.from('site_settings').upsert({ key, value })
      )
    )
    setSaving(false)
    setSaved(true)
  }

  const fields = [
    { key: 'school_name', label: 'School Name' },
    { key: 'school_tagline', label: 'Tagline' },
    { key: 'school_email', label: 'Email', type: 'email' },
    { key: 'school_phone', label: 'Phone' },
    { key: 'school_address', label: 'Address' },
    { key: 'logo_url', label: 'Logo URL' },
  ]

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
      {fields.map(({ key, label, type }) => (
        <div key={key}>
          <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
          <input
            type={type || 'text'}
            value={form[key] ?? ''}
            onChange={e => set(key, e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ))}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Settings'}
      </button>
    </div>
  )
}
