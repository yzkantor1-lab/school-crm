import { createClient } from '@/lib/supabase/server'
import BookForm from './BookForm'
import LoanForm from './LoanForm'

export default async function BooksPage() {
  const supabase = await createClient()
  const [{ data: books }, { data: loans }] = await Promise.all([
    supabase.from('books').select('*').order('title'),
    supabase.from('book_loans').select('*, books(title), students(first_name, last_name)').is('returned_at', null).order('loaned_at', { ascending: false }),
  ])

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Library & Books</h1>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Inventory</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Title</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Author</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Category</th>
                  <th className="text-center px-5 py-2 text-slate-500 font-medium">Total</th>
                  <th className="text-center px-5 py-2 text-slate-500 font-medium">Available</th>
                </tr>
              </thead>
              <tbody>
                {books?.map(b => (
                  <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-900">{b.title}</td>
                    <td className="px-5 py-2 text-slate-600">{b.author ?? '—'}</td>
                    <td className="px-5 py-2 text-slate-600 capitalize">{b.category ?? '—'}</td>
                    <td className="px-5 py-2 text-center text-slate-700">{b.total_copies}</td>
                    <td className="px-5 py-2 text-center">
                      <span className={`font-semibold ${Number(b.available_copies) === 0 ? 'text-red-600' : 'text-emerald-700'}`}>{b.available_copies}</span>
                    </td>
                  </tr>
                ))}
                {!books?.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No books yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Active Loans</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Book</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Student</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Loaned</th>
                  <th className="text-left px-5 py-2 text-slate-500 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {loans?.map((l: any) => (
                  <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2 font-medium text-slate-900">{l.books?.title}</td>
                    <td className="px-5 py-2 text-slate-600">{l.students?.first_name} {l.students?.last_name}</td>
                    <td className="px-5 py-2 text-slate-600">{new Date(l.loaned_at).toLocaleDateString()}</td>
                    <td className={`px-5 py-2 font-medium ${l.due_date && new Date(l.due_date) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>
                      {l.due_date ?? '—'}
                    </td>
                  </tr>
                ))}
                {!loans?.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No active loans.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <BookForm />
          <LoanForm books={books ?? []} />
        </div>
      </div>
    </div>
  )
}
