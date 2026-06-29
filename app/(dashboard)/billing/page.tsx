import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function BillingPage() {
  const supabase = await createClient()
  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase.from('invoices').select('*, guardians(first_name, last_name), students(first_name, last_name)').order('created_at', { ascending: false }).limit(20),
    supabase.from('payments').select('*, guardians(first_name, last_name)').order('paid_at', { ascending: false }).limit(10),
  ])

  const totalUnpaid = invoices?.filter(i => i.status === 'unpaid').reduce((sum, i) => sum + Number(i.total), 0) ?? 0
  const totalCollected = payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Billing</h1>
        <Link href="/billing/invoices/new" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          <Plus size={16} /> New Invoice
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-5">
          <p className="text-sm text-rose-700 font-medium">Outstanding Balance</p>
          <p className="text-2xl font-bold text-rose-700 mt-1">${totalUnpaid.toFixed(2)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-sm text-emerald-700 font-medium">Recent Payments</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">${totalCollected.toFixed(2)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="text-sm text-blue-700 font-medium">Total Invoices</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{invoices?.length ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Recent Invoices</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-2 text-slate-500 font-medium">Invoice #</th>
                <th className="text-left px-5 py-2 text-slate-500 font-medium">Family</th>
                <th className="text-left px-5 py-2 text-slate-500 font-medium">Status</th>
                <th className="text-right px-5 py-2 text-slate-500 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices?.map((inv: any) => (
                <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-2 font-mono text-slate-900">{inv.invoice_number}</td>
                  <td className="px-5 py-2 text-slate-600">{inv.guardians?.first_name} {inv.guardians?.last_name}</td>
                  <td className="px-5 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                      inv.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                      inv.status === 'void' ? 'bg-slate-100 text-slate-500' :
                      'bg-red-100 text-red-700'
                    }`}>{inv.status}</span>
                  </td>
                  <td className="px-5 py-2 text-right font-semibold text-slate-900">${Number(inv.total).toFixed(2)}</td>
                </tr>
              ))}
              {!invoices?.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Recent Payments</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-2 text-slate-500 font-medium">Family</th>
                <th className="text-left px-5 py-2 text-slate-500 font-medium">Method</th>
                <th className="text-left px-5 py-2 text-slate-500 font-medium">Date</th>
                <th className="text-right px-5 py-2 text-slate-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments?.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-2 text-slate-900">{p.guardians?.first_name} {p.guardians?.last_name}</td>
                  <td className="px-5 py-2 text-slate-600 capitalize">{p.method}</td>
                  <td className="px-5 py-2 text-slate-600">{new Date(p.paid_at).toLocaleDateString()}</td>
                  <td className="px-5 py-2 text-right font-semibold text-emerald-700">${Number(p.amount).toFixed(2)}</td>
                </tr>
              ))}
              {!payments?.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
