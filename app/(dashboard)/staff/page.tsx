import { createClient } from '@/lib/supabase/server'
import StaffForm from './StaffForm'

export default async function StaffPage() {
  const supabase = await createClient()
  const { data: staff } = await supabase.from('staff').select('*').order('last_name')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Staff</h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Name</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Role</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Email</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Phone</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {staff?.map(s => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{s.first_name} {s.last_name}</td>
                  <td className="px-5 py-3 text-slate-600 capitalize">{s.role}</td>
                  <td className="px-5 py-3 text-slate-600">{s.email}</td>
                  <td className="px-5 py-3 text-slate-600">{s.phone ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {!staff?.length && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No staff yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <StaffForm />
      </div>
    </div>
  )
}
