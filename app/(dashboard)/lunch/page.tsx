import { createClient } from '@/lib/supabase/server'
import LunchDepositForm from './LunchDepositForm'

export default async function LunchPage() {
  const supabase = await createClient()
  const { data: accounts } = await supabase
    .from('lunch_accounts')
    .select('*, students(first_name, last_name, grade_level)')
    .order('balance', { ascending: true })

  const { data: recentTx } = await supabase
    .from('lunch_transactions')
    .select('*, lunch_accounts(students(first_name, last_name))')
    .order('created_at', { ascending: false })
    .limit(10)

  const lowBalance = accounts?.filter((a: any) => Number(a.balance) < 10) ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Lunch Program</h1>

      {lowBalance.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-6 text-sm text-amber-800">
          <strong>{lowBalance.length} student{lowBalance.length > 1 ? 's' : ''}</strong> have a balance under $10.00
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Account Balances</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Student</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Grade</th>
                  <th className="text-right px-5 py-2 text-slate-500 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts?.map((a: any) => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-900">{a.students?.first_name} {a.students?.last_name}</td>
                    <td className="px-5 py-2 text-slate-600">{a.students?.grade_level ?? '—'}</td>
                    <td className={`px-5 py-2 text-right font-semibold ${Number(a.balance) < 10 ? 'text-red-600' : 'text-emerald-700'}`}>
                      ${Number(a.balance).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {!accounts?.length && <tr><td colSpan={3} className="px-5 py-10 text-center text-slate-400">No lunch accounts yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Recent Transactions</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Student</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Type</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Description</th>
                  <th className="text-right px-5 py-2 text-slate-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentTx?.map((tx: any) => (
                  <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-900">
                      {tx.lunch_accounts?.students?.first_name} {tx.lunch_accounts?.students?.last_name}
                    </td>
                    <td className="px-5 py-2 text-slate-600 capitalize">{tx.type}</td>
                    <td className="px-5 py-2 text-slate-600">{tx.description ?? '—'}</td>
                    <td className={`px-5 py-2 text-right font-medium ${Number(tx.amount) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {Number(tx.amount) >= 0 ? '+' : ''}${Number(tx.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {!recentTx?.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No transactions yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <LunchDepositForm />
      </div>
    </div>
  )
}
