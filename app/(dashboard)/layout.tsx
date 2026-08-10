import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      {/* pt-20 clears the mobile top bar (h-14) that replaces the sidebar
          below md, with a little breathing room; md:p-8 replaces it once the
          fixed sidebar takes over and that bar is hidden. md:ml-60 only
          applies at md+ since the sidebar is off-screen by default on mobile. */}
      <main className="flex-1 p-4 pt-20 md:ml-60 md:p-8">
        {children}
      </main>
    </div>
  )
}
