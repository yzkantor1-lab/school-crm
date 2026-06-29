import { createClient } from '@/lib/supabase/server'
import CommunicationForm from './CommunicationForm'

export default async function CommunicationsPage() {
  const supabase = await createClient()
  const [{ data: comms }, { data: students }, { data: staff }] = await Promise.all([
    supabase.from('communications').select('*, students(first_name, last_name), staff(first_name, last_name)').order('created_at', { ascending: false }).limit(50),
    supabase.from('students').select('id, first_name, last_name').eq('status', 'active').order('last_name'),
    supabase.from('staff').select('id, first_name, last_name').eq('is_active', true).order('last_name'),
  ])

  const typeColors: Record<string, string> = {
    note: 'bg-slate-100 text-slate-700',
    email: 'bg-blue-100 text-blue-700',
    call: 'bg-emerald-100 text-emerald-700',
    meeting: 'bg-violet-100 text-violet-700',
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Communications</h1>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-3">
          {comms?.map((c: any) => (
            <div key={c.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[c.type] ?? typeColors.note}`}>{c.type}</span>
                  {c.students && <span className="text-sm font-medium text-slate-900">{c.students.first_name} {c.students.last_name}</span>}
                  {c.subject && <span className="text-sm text-slate-600">— {c.subject}</span>}
                </div>
                <span className="text-xs text-slate-400">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
              {c.body && <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>}
              {c.staff && <p className="text-xs text-slate-400 mt-2">By {c.staff.first_name} {c.staff.last_name}</p>}
            </div>
          ))}
          {!comms?.length && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-10 text-center text-slate-400">No communications yet.</div>
          )}
        </div>
        <CommunicationForm students={students ?? []} staff={staff ?? []} />
      </div>
    </div>
  )
}
