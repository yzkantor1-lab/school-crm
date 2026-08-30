'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import {
  ArrowLeft, Edit2, Save, X, Trash2, DollarSign, Calendar,
  CreditCard, FileText, User, Mail, Phone, MapPin, Tag, Heart, Archive, ArchiveRestore,
  Printer, GraduationCap, Search, ExternalLink, PartyPopper, Repeat
} from 'lucide-react'
import { generateDonationReceiptPDF, getDonationReceiptPdfBase64 } from '@/lib/donationPdf'
import { openPreviewTab } from '@/lib/pdfPreview'
import EmailPdfModal from '@/components/EmailPdfModal'
import PrintNoteModal from '@/components/PrintNoteModal'
import SentLettersPanel from '@/components/SentLettersPanel'
import ChargeModal from '@/components/sola/ChargeModal'
import RecurringModal from '@/components/sola/RecurringModal'
import ManageRecurringModal from '@/components/sola/ManageRecurringModal'
import IncomingSolaPayments, { type PendingSolaPayment } from '@/components/sola/IncomingSolaPayments'
import NameInput from '@/components/NameInput'
import PhoneInput from '@/components/PhoneInput'
import TitleSelect from '@/components/TitleSelect'
import EmailInput from '@/components/EmailInput'

type Donor = {
  id: string; title: string | null; name: string; email: string | null; phone_number: string | null
  address: string | null; category: string | null; relationship: string | null
}
type Donation = {
  id: string; amount: number; donation_method: string; donation_date: string
  purpose: string; notes: string | null; archived: boolean
  category: string | null; event_id: string | null; source: string
  events: { name: string } | null
}
type LinkedStudent = { id: string; first_name: string; last_name: string }
type EventOption = { id: string; name: string }
type Schedule = {
  id: string; purpose: string; amount: number
  interval_type: string; interval_count: number
  total_payments: number | null; payment_method_id: string | null
}

function scheduleCadence(s: Schedule) {
  const amt = formatCurrency(s.amount)
  return s.interval_count === 1 ? `${amt} / ${s.interval_type}` : `${amt} every ${s.interval_count} ${s.interval_type}s`
}

const DONATION_CATEGORIES = [
  { value: 'one_time', label: 'One-Time Donation' },
  { value: 'monthly_recurring', label: 'Monthly Recurring Donation' },
  { value: 'event', label: 'Event Donation' },
]
function categoryLabel(c: string | null) {
  return DONATION_CATEGORIES.find(x => x.value === c)?.label ?? null
}

export default function DonorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [donor, setDonor] = useState<Donor | null>(null)
  const [donations, setDonations] = useState<Donation[]>([])
  const [donorCategories, setDonorCategories] = useState<string[]>(['General'])
  const [relationships, setRelationships] = useState<string[]>(['Other'])
  const [donationMethods, setDonationMethods] = useState<string[]>(['Cash'])
  const [donationPurposes, setDonationPurposes] = useState<string[]>(['General Fund'])
  const [loading, setLoading] = useState(true)
  const [isEditingDonor, setIsEditingDonor] = useState(false)
  const [editingDonationId, setEditingDonationId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [donorForm, setDonorForm] = useState({ title: '', name: '', email: '', phone_number: '', address: '', category: '', relationship: '' })
  const [donationForm, setDonationForm] = useState({ amount: '', donation_method: '', donation_date: '', purpose: '', notes: '', category: 'one_time', event_id: '' })
  const [emailModal, setEmailModal] = useState<{
    defaultRecipients: string[]
    defaultSubject: string
    defaultBody: string
    buildAttachment: () => Promise<{ filename: string; base64: string }>
  } | null>(null)
  const [pendingPrint, setPendingPrint] = useState<{
    title: string
    subject: string
    run: (note: string | undefined, win: Window | null) => Promise<{ base64: string; filename: string }>
  } | null>(null)
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<{ id: string; label: string }[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [pendingSolaPayments, setPendingSolaPayments] = useState<PendingSolaPayment[]>([])
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [showRecurringModal, setShowRecurringModal] = useState(false)
  const [showManageRecurring, setShowManageRecurring] = useState(false)
  const [events, setEvents] = useState<EventOption[]>([])
  const [linkedStudents, setLinkedStudents] = useState<LinkedStudent[]>([])
  const [studentQuery, setStudentQuery] = useState('')
  const [studentMatches, setStudentMatches] = useState<LinkedStudent[]>([])

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase.from('donor_settings').select('*').limit(1).maybeSingle()
    if (data) {
      setDonorCategories(data.donor_categories || ['General'])
      setRelationships(data.relationships || ['Other'])
      setDonationMethods(data.donation_methods || ['Cash'])
      setDonationPurposes(data.donation_purposes || ['General Fund'])
    }
  }, [supabase])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: d }, { data: dn }, { data: pm }, { data: ev }, { data: ds }, { data: sch }] = await Promise.all([
      supabase.from('donors').select('*').eq('id', id).maybeSingle(),
      supabase.from('donations').select('*,events(name)').eq('donor_id', id).order('donation_date', { ascending: false }),
      supabase.from('payment_methods').select('id,label').eq('donor_id', id).order('created_at', { ascending: false }),
      supabase.from('events').select('id,name').order('event_date', { ascending: false }),
      supabase.from('donor_students').select('students(id,first_name,last_name)').eq('donor_id', id),
      supabase.from('payment_schedules').select('id,purpose,amount,interval_type,interval_count,total_payments,payment_method_id').eq('donor_id', id).eq('status', 'active'),
    ])
    setEvents(ev ?? [])
    setLinkedStudents(((ds ?? []) as unknown as { students: LinkedStudent }[]).map(r => r.students).filter(Boolean))
    if (d) {
      setDonor(d)
      setDonorForm({ title: d.title || '', name: d.name, email: d.email || '', phone_number: d.phone_number || '', address: d.address || '', category: d.category || 'General', relationship: d.relationship || 'Other' })
    }
    setDonations((dn ?? []) as unknown as Donation[])
    setSavedPaymentMethods((pm || []).map(m => ({ id: m.id, label: m.label || 'Saved payment method' })))
    setSchedules(sch ?? [])
    setLoading(false)
  }, [id, supabase])

  // Completely separate from fetchData on purpose — some networks block
  // requests to the sola_sync_* tables outright ("TypeError: Failed to
  // fetch"), the same class of issue already documented elsewhere in this
  // codebase for tuition_payments. This card is a nice-to-have; it must
  // never be able to take the whole page down if it fails, so it gets its
  // own effect and swallows any error rather than surfacing one.
  const fetchPendingSolaPayments = useCallback(async () => {
    try {
      const { data: syncCustomers } = await supabase.from('sola_sync_customers').select('id').eq('matched_donor_id', id)
      const syncCustomerIds = (syncCustomers ?? []).map(c => c.id)
      if (!syncCustomerIds.length) return
      const { data: pending } = await supabase.from('sola_sync_payments')
        .select('id,amount,transaction_date,charge_kind,suggested_fee_type,suggested_donation_category,import_status')
        .in('sola_sync_customer_id', syncCustomerIds).in('import_status', ['pending', 'needs_review']).eq('gateway_status', 'Approved')
        .order('transaction_date')
      setPendingSolaPayments((pending ?? []) as PendingSolaPayment[])
    } catch {
      // Best-effort — leave the card empty rather than blocking or erroring
      // the page over a request some networks can't complete.
    }
  }, [id, supabase])

  useEffect(() => {
    const q = studentQuery.trim().toLowerCase()
    if (q.length < 2) return
    let cancelled = false
    supabase.from('students').select('id,first_name,last_name').ilike('first_name', `%${q}%`).limit(20).then(({ data }) => {
      if (!cancelled) setStudentMatches((data ?? []) as LinkedStudent[])
    })
    // Also try matching on last name — schools skew toward last-name search.
    supabase.from('students').select('id,first_name,last_name').ilike('last_name', `%${q}%`).limit(20).then(({ data }) => {
      if (!cancelled) setStudentMatches(prev => {
        const merged = [...prev, ...((data ?? []) as LinkedStudent[])]
        return Array.from(new Map(merged.map(s => [s.id, s])).values())
      })
    })
    return () => { cancelled = true }
  }, [studentQuery, supabase])

  async function linkStudent(studentId: string) {
    await supabase.from('donor_students').upsert([{ donor_id: id, student_id: studentId }], { onConflict: 'donor_id,student_id' })
    setStudentQuery('')
    setStudentMatches([])
    fetchData()
  }

  async function unlinkStudent(studentId: string) {
    await supabase.from('donor_students').delete().eq('donor_id', id).eq('student_id', studentId)
    fetchData()
  }

  /* eslint-disable react-hooks/set-state-in-effect -- standard fetch-on-mount, batches related state after the await */
  useEffect(() => {
    fetchSettings()
    fetchData()
    fetchPendingSolaPayments()
  }, [fetchSettings, fetchData, fetchPendingSolaPayments])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function updateDonor() {
    if (!donor) return
    const { error } = await supabase.from('donors').update({
      title: donorForm.title || null, name: donorForm.name, email: donorForm.email || null, phone_number: donorForm.phone_number || null,
      address: donorForm.address || null, category: donorForm.category, relationship: donorForm.relationship,
    }).eq('id', donor.id)
    if (error) { alert('Error updating donor.'); return }
    setIsEditingDonor(false)
    fetchData()
  }

  async function deleteDonor() {
    if (!donor) return
    if (!confirm(`Delete ${donor.name}? This will also delete all their donations.`)) return
    const { error } = await supabase.from('donors').delete().eq('id', donor.id)
    if (error) { alert('Error deleting donor.'); return }
    router.push('/admin/donors')
  }

  async function updateDonation(donationId: string) {
    const { error } = await supabase.from('donations').update({
      amount: parseFloat(donationForm.amount), donation_method: donationForm.donation_method,
      donation_date: donationForm.donation_date, purpose: donationForm.purpose, notes: donationForm.notes || null,
      category: donationForm.category, event_id: donationForm.category === 'event' ? (donationForm.event_id || null) : null,
    }).eq('id', donationId)
    if (error) { alert('Error updating donation.'); return }
    setEditingDonationId(null)
    fetchData()
  }

  async function deleteDonation(donationId: string) {
    if (!confirm('Delete this donation?')) return
    await supabase.from('donations').delete().eq('id', donationId)
    fetchData()
  }

  async function toggleArchive(donationId: string, archived: boolean) {
    await supabase.from('donations').update({ archived: !archived }).eq('id', donationId)
    fetchData()
  }

  function receiptOpts(donation: Donation, extraNote?: string) {
    return {
      donor: { name: donor!.name, email: donor!.email, address: donor!.address },
      donation: {
        amount: Number(donation.amount),
        donation_date: donation.donation_date,
        donation_method: donation.donation_method,
        purpose: donation.purpose,
        notes: donation.notes,
      },
      extraNote,
    }
  }

  // window.open() has to happen inside the click that actually confirms
  // printing — a native prompt() beforehand suppresses itself once that
  // window.open shifts focus off this tab, and calling it after the prompt
  // is too late for the popup blocker either way. Deferring to
  // PrintNoteModal's own Continue click sidesteps both.
  function printReceipt(donation: Donation) {
    if (!donor) return
    setPendingPrint({
      title: 'Add a note to this receipt?',
      subject: `Donation Receipt — ${donor.name}`,
      run: (note, win) => generateDonationReceiptPDF(receiptOpts(donation, note), win),
    })
  }

  // Logs the print the same way emailing already logs a send, so Sent
  // Letters shows both delivery methods.
  async function confirmPendingPrint(note: string | undefined) {
    if (!pendingPrint) return
    const win = openPreviewTab()
    const { subject } = pendingPrint
    setPendingPrint(null)
    const { base64, filename } = await pendingPrint.run(note, win)
    const { error } = await supabase.from('communications').insert([{
      type: 'print', subject, donor_id: id, attachment_filename: filename, pdf_base64: base64,
    }])
    if (error) console.warn('Failed to log printed letter:', error.message)
  }

  function emailReceipt(donation: Donation) {
    if (!donor) return
    const note = prompt('Add a note to this receipt? (optional)') || undefined
    setEmailModal({
      defaultRecipients: donor.email ? [donor.email] : [],
      defaultSubject: `Donation Receipt — ${donor.name}`,
      defaultBody: `Hi,\n\nPlease find attached your receipt for your generous donation of ${formatCurrency(Number(donation.amount))} on ${new Date(donation.donation_date + 'T00:00:00').toLocaleDateString()}.\n\nThank you for your support.`,
      buildAttachment: () => getDonationReceiptPdfBase64(receiptOpts(donation, note)),
    })
  }

  const shown = donations.filter(d => showArchived ? d.archived : !d.archived)
  const totalDonated = donations.filter(d => !d.archived).reduce((s, d) => s + Number(d.amount), 0)

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>
  if (!donor) return <div className="text-center py-12 text-slate-500">Donor not found.</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/admin/donors')} className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Donor Details</h1>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-3 rounded-xl"><User className="text-blue-600" size={24} /></div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{donor.title ? `${donor.title} ` : ''}{donor.name}</h2>
              <div className="flex gap-2 mt-1 flex-wrap items-center">
                {donor.category && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium"><Tag size={10} />{donor.category}</span>}
                {donor.relationship && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium"><Heart size={10} />{donor.relationship}</span>}
                {schedules.length > 0 && (
                  <button onClick={() => setShowManageRecurring(true)}
                    title={schedules.map(s => `${s.purpose}: ${scheduleCadence(s)}`).join('\n')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 hover:bg-violet-200 text-xs rounded-full font-medium transition-colors">
                    <Repeat size={10} />
                    {schedules.length === 1 ? scheduleCadence(schedules[0]) : `${schedules.length} active recurring`}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {!isEditingDonor ? (
              <>
                <button onClick={() => setShowChargeModal(true)} className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition text-sm"><CreditCard size={14} />Charge Now</button>
                <button onClick={() => setShowRecurringModal(true)} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition text-sm">Recurring</button>
                <button onClick={() => setIsEditingDonor(true)} className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition text-sm"><Edit2 size={14} />Edit</button>
                <button onClick={deleteDonor} className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition text-sm"><Trash2 size={14} />Delete</button>
              </>
            ) : (
              <>
                <button onClick={updateDonor} className="flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition text-sm"><Save size={14} />Save</button>
                <button onClick={() => setIsEditingDonor(false)} className="flex items-center gap-2 bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition text-sm"><X size={14} />Cancel</button>
              </>
            )}
          </div>
        </div>

        {isEditingDonor ? (
          <div className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <TitleSelect value={donorForm.title} onChange={v => setDonorForm({ ...donorForm, title: v })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              <NameInput required value={donorForm.name} onChange={v => setDonorForm({ ...donorForm, name: v })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Name *" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <EmailInput value={donorForm.email} onChange={v => setDonorForm({ ...donorForm, email: v })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Email" />
              <PhoneInput value={donorForm.phone_number} onChange={v => setDonorForm({ ...donorForm, phone_number: v })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Phone" />
            </div>
            <textarea value={donorForm.address} onChange={e => setDonorForm({ ...donorForm, address: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Address" />
            <div className="grid grid-cols-2 gap-3">
              <select value={donorForm.category} onChange={e => setDonorForm({ ...donorForm, category: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {donorCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={donorForm.relationship} onChange={e => setDonorForm({ ...donorForm, relationship: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {relationships.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 mt-4 text-sm text-slate-700">
            {donor.email && <div className="flex items-center gap-2"><Mail size={14} className="text-slate-400" />{donor.email}</div>}
            {donor.phone_number && <div className="flex items-center gap-2"><Phone size={14} className="text-slate-400" />{donor.phone_number}</div>}
            {donor.address && <div className="flex items-start gap-2"><MapPin size={14} className="text-slate-400 mt-0.5" />{donor.address}</div>}
          </div>
        )}
      </div>

      {/* Parent/student cross-link — kept entirely separate from donation
          totals below; this only ever displays which student(s) this donor
          is a parent of, never mixes tuition data into this page. */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <GraduationCap size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Linked Student{linkedStudents.length === 1 ? '' : 's'}</span>
        </div>
        {linkedStudents.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {linkedStudents.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full font-medium">
                <Link href={`/admin/tuition/${s.id}`} className="flex items-center gap-1 hover:underline">
                  {s.first_name} {s.last_name} <ExternalLink size={10} />
                </Link>
                <button onClick={() => unlinkStudent(s.id)} className="text-blue-400 hover:text-red-500"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input value={studentQuery} onChange={e => setStudentQuery(e.target.value)}
            placeholder="Link to a student this donor is a parent of…"
            className="w-full max-w-xs border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {studentQuery.trim().length >= 2 && studentMatches.length > 0 && (
            <div className="absolute z-10 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
              {studentMatches.filter(s => !linkedStudents.some(ls => ls.id === s.id)).map(s => (
                <button key={s.id} type="button" onClick={() => linkStudent(s.id)}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 transition-colors">
                  {s.first_name} {s.last_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <SentLettersPanel donorId={id} />

      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 mb-1"><DollarSign size={20} /><span className="font-semibold">Total Donated</span></div>
        <p className="text-4xl font-bold">{formatCurrency(totalDonated)}</p>
        <p className="text-green-100 text-sm mt-1">{donations.length} donation{donations.length !== 1 ? 's' : ''}</p>
      </div>

      <IncomingSolaPayments payments={pendingSolaPayments} />

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900">Donation History</h3>
          <button onClick={() => setShowArchived(!showArchived)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition text-sm ${showArchived ? 'bg-slate-700 text-white hover:bg-slate-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            <Archive size={14} />{showArchived ? 'Show Active' : 'Show Archived'}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="text-center py-8 text-slate-400">{showArchived ? 'No archived donations.' : 'No donations yet.'}</p>
        ) : (
          <div className="space-y-3">
            {shown.map(donation => (
              <div key={donation.id} className="border border-slate-100 rounded-lg p-4 hover:bg-slate-50 transition">
                {editingDonationId === donation.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input type="number" step="0.01" required value={donationForm.amount} onChange={e => setDonationForm({ ...donationForm, amount: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Amount" />
                      <input type="date" required value={donationForm.donation_date} onChange={e => setDonationForm({ ...donationForm, donation_date: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                      <select value={donationForm.donation_method} onChange={e => setDonationForm({ ...donationForm, donation_method: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {donationMethods.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select value={donationForm.purpose} onChange={e => setDonationForm({ ...donationForm, purpose: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {donationPurposes.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select value={donationForm.category} onChange={e => setDonationForm({ ...donationForm, category: e.target.value })}
                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                        {DONATION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      {donationForm.category === 'event' && (
                        events.length ? (
                          <select value={donationForm.event_id} onChange={e => setDonationForm({ ...donationForm, event_id: e.target.value })}
                            className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                            <option value="">— select event —</option>
                            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                          </select>
                        ) : (
                          <Link href="/admin/events" className="px-3 py-2 border border-amber-200 bg-amber-50 rounded-lg text-xs text-amber-700 flex items-center">
                            No events yet — create one first →
                          </Link>
                        )
                      )}
                    </div>
                    <textarea value={donationForm.notes} onChange={e => setDonationForm({ ...donationForm, notes: e.target.value })} rows={2}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Notes" />
                    <div className="flex gap-2">
                      <button onClick={() => updateDonation(donation.id)} className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition text-sm"><Save size={13} />Save</button>
                      <button onClick={() => setEditingDonationId(null)} className="flex items-center gap-1.5 bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-300 transition text-sm"><X size={13} />Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-green-600 text-lg">{formatCurrency(Number(donation.amount))}</span>
                        <span className="text-sm text-slate-500 flex items-center gap-1"><Calendar size={12} />{new Date(donation.donation_date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
                        <span className="flex items-center gap-1"><CreditCard size={12} />{donation.donation_method}</span>
                        <span className="flex items-center gap-1"><FileText size={12} />{donation.purpose}</span>
                        {categoryLabel(donation.category) && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{categoryLabel(donation.category)}</span>
                        )}
                        {donation.events?.name && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium flex items-center gap-1">
                            <PartyPopper size={10} />{donation.events.name}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${donation.source === 'sola' ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-400'}`}>
                          {donation.source === 'sola' ? 'Sola' : 'Manual'}
                        </span>
                      </div>
                      {donation.notes && <p className="text-sm text-slate-500 mt-1">{donation.notes}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => printReceipt(donation)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="View receipt"><Printer size={15} /></button>
                      <button onClick={() => emailReceipt(donation)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Email receipt"><Mail size={15} /></button>
                      <button onClick={() => { setEditingDonationId(donation.id); setDonationForm({ amount: donation.amount.toString(), donation_method: donation.donation_method, donation_date: donation.donation_date, purpose: donation.purpose, notes: donation.notes || '', category: donation.category || 'one_time', event_id: donation.event_id || '' }) }}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"><Edit2 size={15} /></button>
                      <button onClick={() => toggleArchive(donation.id, donation.archived)}
                        className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition">{donation.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
                      <button onClick={() => deleteDonation(donation.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {emailModal && (
        <EmailPdfModal
          onClose={() => setEmailModal(null)}
          defaultRecipients={emailModal.defaultRecipients}
          defaultSubject={emailModal.defaultSubject}
          defaultBody={emailModal.defaultBody}
          buildAttachment={emailModal.buildAttachment}
          logContext={{ donorId: id }}
        />
      )}
      {pendingPrint && (
        <PrintNoteModal
          title={pendingPrint.title}
          onConfirm={confirmPendingPrint}
          onClose={() => setPendingPrint(null)}
        />
      )}
      {showChargeModal && (
        <ChargeModal
          onClose={() => setShowChargeModal(false)}
          type="donor"
          id={id}
          purposeOptions={[{ value: 'donation', label: 'Donation' }]}
          savedMethods={savedPaymentMethods}
          onCharged={fetchData}
        />
      )}
      {showRecurringModal && (
        <RecurringModal
          onClose={() => setShowRecurringModal(false)}
          type="donor"
          id={id}
          purposeOptions={[{ value: 'donation', label: 'Donation' }]}
          savedMethods={savedPaymentMethods}
          onCreated={fetchData}
        />
      )}
      {showManageRecurring && (
        <ManageRecurringModal
          onClose={() => setShowManageRecurring(false)}
          type="donor"
          schedules={schedules}
          savedMethods={savedPaymentMethods}
          initialScheduleId={schedules.length === 1 ? schedules[0].id : undefined}
          onChanged={fetchData}
        />
      )}
    </div>
  )
}
