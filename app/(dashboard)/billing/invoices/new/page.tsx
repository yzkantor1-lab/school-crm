'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

export default function NewInvoicePage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [guardians, setGuardians] = useState<any[]>([])
  const [students, setStudents] = useState<any[]>([])
  const [terms, setTerms] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [form, setForm] = useState({ guardian_id: '', student_id: '', term_id: '', due_date: '', notes: '' })
  const [items, setItems] = useState([{ description: '', category_id: '', quantity: '1', unit_price: '' }])
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    Promise.all([
      supabase.from('guardians').select('id, first_name, last_name').order('last_name'),
      supabase.from('students').select('id, first_name, last_name').eq('status', 'active').order('last_name'),
      supabase.from('academic_terms').select('id, name').order('start_date', { ascending: false }),
      supabase.from('fee_categories').select('id, name, default_amount'),
    ]).then(([g, s, t, c]) => {
      setGuardians(g.data ?? [])
      setStudents(s.data ?? [])
      setTerms(t.data ?? [])
      setCategories(c.data ?? [])
    })
  }, [])

  const total = items.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.unit_price)), 0)

  function updateItem(idx: number, key: string, val: string) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [key]: val }
      if (key === 'category_id') {
        const cat = categories.find(c => c.id === val)
        if (cat?.default_amount) next[idx].unit_price = String(cat.default_amount)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`
    const { data: invoice, error: invErr } = await supabase.from('invoices').insert([{
      invoice_number: invoiceNumber,
      guardian_id: form.guardian_id || null,
      student_id: form.student_id || null,
      term_id: form.term_id || null,
      due_date: form.due_date || null,
      notes: form.notes || null,
      subtotal: total,
      total,
      status: 'unpaid',
    }]).select().single()
    if (invErr) { setError(invErr.message); setLoading(false); return }

    const lineItems = items.filter(i => i.description && i.unit_price).map(i => ({
      invoice_id: invoice.id,
      fee_category_id: i.category_id || null,
      description: i.description,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      total: Number(i.quantity) * Number(i.unit_price),
    }))
    if (lineItems.length) await supabase.from('invoice_items').insert(lineItems)
    router.push('/billing')
  }

  return (
    <div className="max-w-2xl">
      <Link href="/billing" className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm mb-5"><ArrowLeft size={15} /> Back to Billing</Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">New Invoice</h1>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-4">
          <h2 className="font-semibold text-slate-900">Invoice Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Guardian</label>
              <select value={form.guardian_id} onChange={e => set('guardian_id', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select…</option>
                {guardians.map(g => <option key={g.id} value={g.id}>{g.last_name}, {g.first_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Student</label>
              <select value={form.student_id} onChange={e => set('student_id', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select…</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.last_name}, {s.first_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Term</label>
              <select value={form.term_id} onChange={e => set('term_id', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No term</option>
                {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-4">
          <h2 className="font-semibold text-slate-900">Line Items</h2>
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>}
                <input value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)}
                  placeholder="e.g. Tuition" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-3">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>}
                <select value={item.category_id} onChange={e => updateItem(idx, 'category_id', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">None</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Qty</label>}
                <input type="number" min="1" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Price ($)</label>}
                <input type="number" step="0.01" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-1 flex justify-center">
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-600 transition mt-1"><Trash2 size={15} /></button>
                )}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setItems(prev => [...prev, { description: '', category_id: '', quantity: '1', unit_price: '' }])}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium">
            <Plus size={15} /> Add Line Item
          </button>
          <div className="border-t border-slate-100 pt-3 flex justify-end">
            <p className="text-lg font-bold text-slate-900">Total: ${total.toFixed(2)}</p>
          </div>
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg disabled:opacity-50">
            {loading ? 'Creating…' : 'Create Invoice'}
          </button>
          <Link href="/billing" className="text-sm text-slate-600 hover:text-slate-900 px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
