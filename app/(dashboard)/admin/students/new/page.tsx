import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import StudentEditForm from '../[id]/StudentEditForm'

export default function NewStudentPage() {
  return (
    <div className="max-w-3xl">
      <Link href="/admin/students" className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm mb-5">
        <ArrowLeft size={15} /> Back to Students
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">New Student</h1>

      <StudentEditForm />
    </div>
  )
}
