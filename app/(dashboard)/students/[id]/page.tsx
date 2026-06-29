import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import StudentEditForm from './StudentEditForm'

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: student }, { data: guardians }, { data: enrollments }] = await Promise.all([
    supabase.from('students').select('*').eq('id', id).single(),
    supabase.from('student_guardians').select('guardians(*)').eq('student_id', id),
    supabase.from('class_enrollments').select('classes(name, subject, grade_level)').eq('student_id', id),
  ])

  if (!student) notFound()

  return (
    <div className="max-w-3xl">
      <Link href="/students" className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm mb-5">
        <ArrowLeft size={15} /> Back to Students
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">{student.first_name} {student.last_name}</h1>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <StudentEditForm student={student} />

        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Guardians</h2>
            {guardians?.length ? guardians.map((g: any) => (
              <div key={g.guardians.id} className="text-sm text-slate-700 py-1.5 border-b border-slate-50 last:border-0">
                <p className="font-medium">{g.guardians.first_name} {g.guardians.last_name}</p>
                <p className="text-slate-500">{g.guardians.email} · {g.guardians.phone_primary}</p>
              </div>
            )) : <p className="text-slate-400 text-sm">No guardians linked.</p>}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Enrolled Classes</h2>
            {enrollments?.length ? enrollments.map((e: any, i: number) => (
              <div key={i} className="text-sm text-slate-700 py-1.5 border-b border-slate-50 last:border-0">
                <p className="font-medium">{e.classes.name}</p>
                <p className="text-slate-500">{e.classes.subject}</p>
              </div>
            )) : <p className="text-slate-400 text-sm">Not enrolled in any classes.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
