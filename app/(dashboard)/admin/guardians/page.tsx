import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import GuardianForm from './GuardianForm'

export default async function GuardiansPage() {
  const supabase = await createClient()
  const { data: guardians } = await supabase.from('guardians').select('*').order('last_name')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Guardians</h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Name</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Email</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Phone</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Relationship</th>
              </tr>
            </thead>
            <tbody>
              {guardians?.map(g => (
                <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-5 py-3 font-medium text-slate-900">{g.first_name} {g.last_name}</td>
                  <td className="px-5 py-3 text-slate-600">{g.email ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{g.phone_primary ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600 capitalize">{g.relationship ?? '—'}</td>
                </tr>
              ))}
              {!guardians?.length && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No guardians yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <GuardianForm />
      </div>
    </div>
  )
}
