import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function StudentsPage() {
  const supabase = await createClient()
  const { data: students } = await supabase
    .from('students')
    .select('*')
    .order('last_name')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Students</h1>
        <Link href="/students/new" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          <Plus size={16} /> Add Student
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Name</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">ID</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Grade</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">DOB</th>
              <th className="text-left px-5 py-3 text-slate-500 font-medium">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {students?.map(s => (
              <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                <td className="px-5 py-3 font-medium text-slate-900">{s.first_name} {s.last_name}</td>
                <td className="px-5 py-3 text-slate-600">{s.student_id ?? '—'}</td>
                <td className="px-5 py-3 text-slate-600">{s.grade_level ?? '—'}</td>
                <td className="px-5 py-3 text-slate-600">{s.date_of_birth ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    s.status === 'active' ? 'bg-green-100 text-green-700' :
                    s.status === 'graduated' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{s.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <Link href={`/students/${s.id}`} className="text-blue-600 hover:underline text-xs font-medium">View</Link>
                </td>
              </tr>
            ))}
            {!students?.length && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No students yet. Add your first student.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
