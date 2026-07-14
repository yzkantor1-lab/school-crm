import { createClient } from '@/lib/supabase/server'
import { Users, UserRound, UserCog, BookOpen, Receipt, UtensilsCrossed } from 'lucide-react'

async function getStat(supabase: Awaited<ReturnType<typeof createClient>>, table: string) {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true })
  return count ?? 0
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const [students, guardians, staff, classes, invoices, lunchAccounts] = await Promise.all([
    getStat(supabase, 'students'),
    getStat(supabase, 'guardians'),
    getStat(supabase, 'staff'),
    getStat(supabase, 'classes'),
    getStat(supabase, 'invoices'),
    getStat(supabase, 'lunch_accounts'),
  ])

  const { data: recentStudents } = await supabase
    .from('students')
    .select('id, first_name, last_name, grade_level, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: unpaidInvoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, due_date, status')
    .eq('status', 'unpaid')
    .order('due_date', { ascending: true })
    .limit(5)

  const stats = [
    { label: 'Students', value: students, icon: Users, color: 'bg-blue-500' },
    { label: 'Guardians', value: guardians, icon: UserRound, color: 'bg-violet-500' },
    { label: 'Staff', value: staff, icon: UserCog, color: 'bg-emerald-500' },
    { label: 'Classes', value: classes, icon: BookOpen, color: 'bg-amber-500' },
    { label: 'Invoices', value: invoices, icon: Receipt, color: 'bg-rose-500' },
    { label: 'Lunch Accounts', value: lunchAccounts, icon: UtensilsCrossed, color: 'bg-cyan-500' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-3 gap-5 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
            <div className={`${color} text-white rounded-xl p-3`}>
              <Icon size={22} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{value}</p>
              <p className="text-sm text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Recent Students</h2>
          {recentStudents?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left pb-2">Name</th>
                  <th className="text-left pb-2">Grade</th>
                  <th className="text-left pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentStudents.map(s => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{s.first_name} {s.last_name}</td>
                    <td className="py-2 text-slate-600">{s.grade_level ?? '—'}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                      }`}>{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-slate-400 text-sm">No students yet.</p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Unpaid Invoices</h2>
          {unpaidInvoices?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left pb-2">Invoice</th>
                  <th className="text-left pb-2">Due</th>
                  <th className="text-right pb-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {unpaidInvoices.map(inv => (
                  <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{inv.invoice_number}</td>
                    <td className="py-2 text-slate-600">{inv.due_date ?? '—'}</td>
                    <td className="py-2 text-right font-medium text-rose-600">${Number(inv.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-slate-400 text-sm">No unpaid invoices.</p>
          )}
        </div>
      </div>
    </div>
  )
}
