import { createClient } from '@/lib/supabase/server'
import TermForm from './TermForm'

export default async function TermsPage() {
  const supabase = await createClient()
  const { data: terms } = await supabase.from('academic_terms').select('*').order('start_date', { ascending: false })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Academic Terms</h1>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Term Name</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Start</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">End</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {terms?.map(t => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{t.name}</td>
                  <td className="px-5 py-3 text-slate-600">{t.start_date}</td>
                  <td className="px-5 py-3 text-slate-600">{t.end_date}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {!terms?.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No terms yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <TermForm />
      </div>
    </div>
  )
}
