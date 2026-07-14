import { createClient } from '@/lib/supabase/server'
import ClassForm from './ClassForm'

export default async function ClassesPage() {
  const supabase = await createClient()
  const [{ data: classes }, { data: terms }] = await Promise.all([
    supabase.from('classes').select('*, academic_terms(name)').order('name'),
    supabase.from('academic_terms').select('id, name').order('start_date', { ascending: false }),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Classes</h1>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Class</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Subject</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Grade</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Term</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Room</th>
              </tr>
            </thead>
            <tbody>
              {classes?.map((c: any) => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-5 py-3 text-slate-600">{c.subject ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.grade_level ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.academic_terms?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.room ?? '—'}</td>
                </tr>
              ))}
              {!classes?.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No classes yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <ClassForm terms={terms ?? []} />
      </div>
    </div>
  )
}
