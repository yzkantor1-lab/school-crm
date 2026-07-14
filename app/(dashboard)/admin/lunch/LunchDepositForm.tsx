'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LunchDepositForm() {
  const router = useRouter()
  const supabase = createClient()
  const [students, setStudents] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({ student_id: '', amount: '', type: 'deposit', description: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    supabase.from('students').select('id, first_name, last_name').eq('status', 'active').order('last_name')
      .then(({ data }) => setStudents(data ?? []))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    const amount = form.type === 'purchase' ? -Math.abs(Number(form.amount)) : Math.abs(Number(form.amount))

    let { data: account } = await supabase.from('lunch_accounts').select('id, balance').eq('student_id', form.student_id).single()
    if (!account) {
      const { data: newAccount } = await supabase.from('lunch_accounts').insert([{ student_id: form.student_id, balance: 0 }]).select().single()
      account = newAccount
    }
    if (!account) { setError('Could not find or create account.'); setLoading(false); return }

    const [txResult] = await Promise.all([
      supabase.from('lunch_transactions').insert([{ account_id: account.id, amount, type: form.type, description: form.description || null }]),
      supabase.from('lunch_accounts').update({ balance: Number(account.balance) + amount, updated_at: new Date().toISOString() }).eq('id', account.id),
    ])
    if (txResult.error) { setError(txResult.error.message) }
    else { setSuccess('Transaction recorded.'); setForm({ student_id: '', amount: '', type: 'deposit', description: '' }); router.refresh() }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3 h-fit">
      <h2 className="font-semibold text-slate-900">Add Transaction</h2>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Student *</label>
        <select value={form.student_id} onChange={e => set('student_id', e.target.value)} required
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Select student…</option>
          {students.map(s => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
        <select value={form.type} onChange={e => set('type', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="deposit">Deposit</option>
          <option value="purchase">Purchase</option>
          <option value="adjustment">Adjustment</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Amount ($) *</label>
        <input type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} required
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
        <input value={form.description} onChange={e => set('description', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      {success && <p className="text-green-600 text-xs">{success}</p>}
      <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50">
        {loading ? 'Saving…' : 'Record Transaction'}
      </button>
    </form>
  )
}
