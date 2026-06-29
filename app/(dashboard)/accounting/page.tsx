import { createClient } from '@/lib/supabase/server'

export default async function AccountingPage() {
  const supabase = await createClient()
  const [{ data: accounts }, { data: entries }] = await Promise.all([
    supabase.from('ledger_accounts').select('*').eq('is_active', true).order('code'),
    supabase.from('ledger_entries').select('*, ledger_lines(debit, credit, ledger_accounts(name, code))').order('entry_date', { ascending: false }).limit(20),
  ])

  const balances: Record<string, number> = {}
  accounts?.forEach(a => { balances[a.id] = 0 })
  entries?.forEach((e: any) => {
    e.ledger_lines?.forEach((l: any) => {
      if (balances[l.account_id] !== undefined) {
        balances[l.account_id] += Number(l.debit) - Number(l.credit)
      }
    })
  })

  const byType = (type: string) => accounts?.filter(a => a.type === type) ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Accounting</h1>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {(['asset', 'liability', 'equity', 'revenue', 'expense'] as const).map(type => (
          <div key={type} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="font-semibold text-slate-900 capitalize mb-3">{type} Accounts</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left pb-2">Code</th>
                  <th className="text-left pb-2">Account</th>
                  <th className="text-right pb-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {byType(type).map(a => (
                  <tr key={a.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 font-mono text-slate-500 text-xs">{a.code}</td>
                    <td className="py-1.5 text-slate-700">{a.name}</td>
                    <td className="py-1.5 text-right font-medium text-slate-900">${Math.abs(balances[a.id] ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
                {byType(type).length === 0 && <tr><td colSpan={3} className="py-3 text-slate-400 text-xs">No accounts.</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Journal Entries</div>
        {entries?.length ? entries.map((e: any) => (
          <div key={e.id} className="px-5 py-4 border-b border-slate-50 last:border-0">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-900 text-sm">{e.description}</span>
              <span className="text-slate-500 text-xs">{e.entry_date}</span>
            </div>
            <table className="w-full text-xs text-slate-600">
              <tbody>
                {e.ledger_lines?.map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="pr-4 font-mono">{l.ledger_accounts?.code}</td>
                    <td className="pr-8">{l.ledger_accounts?.name}</td>
                    <td className="text-right pr-4 text-emerald-700">{Number(l.debit) > 0 ? `$${Number(l.debit).toFixed(2)}` : ''}</td>
                    <td className="text-right text-rose-600">{Number(l.credit) > 0 ? `$${Number(l.credit).toFixed(2)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )) : <p className="px-5 py-10 text-center text-slate-400 text-sm">No journal entries yet.</p>}
      </div>
    </div>
  )
}
