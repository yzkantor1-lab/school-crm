'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { DollarSign, ChevronRight, Plus } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type TuitionPlan = {
  id: string
  academic_year: string
  total_amount: number
  payment_structure: string
  payment_amount: number
  status: string
  discount_amount: number
}

type TuitionPayment = {
  id: string
  tuition_plan_id: string
  amount: number
  status: string
}

export default function TuitionSection({ studentId }: { studentId: string }) {
  const supabase = createClient()
  const [plans, setPlans] = useState<TuitionPlan[]>([])
  const [payments, setPayments] = useState<TuitionPayment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Fetched as a nested embed on tuition_plans, not a standalone
      // tuition_payments request — some school network filters block any
      // direct request to that resource outright (confirmed live; see the
      // student tuition page's load()), so payments only reliably arrive
      // piggybacked on a request whose primary resource is tuition_plans.
      const { data: p } = await supabase
        .from('tuition_plans')
        .select('*, tuition_payments(id,tuition_plan_id,amount,status)')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
      setPlans(p || [])
      setPayments((p || []).flatMap(plan => (plan.tuition_payments || []) as TuitionPayment[]).filter(pay => ['paid', 'partial', 'forgiven'].includes(pay.status)))
      setLoading(false)
    }
    load()
  }, [studentId, supabase])

  if (loading) return <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5"><p className="text-slate-400 text-sm">Loading tuition…</p></div>

  const activePlan = plans.find(p => p.status === 'active') || plans[0]
  const paid = activePlan
    ? payments.filter(p => p.tuition_plan_id === activePlan.id).reduce((s, p) => s + Number(p.amount), 0)
    : 0
  const netTotal = activePlan ? Number(activePlan.total_amount) - Number(activePlan.discount_amount) : 0
  const balance = netTotal - paid

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900">Tuition</h2>
        <Link
          href={`/admin/tuition/${studentId}`}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
        >
          Manage
          <ChevronRight size={13} />
        </Link>
      </div>

      {!activePlan ? (
        <div className="text-center py-4">
          <DollarSign size={28} className="text-slate-200 mx-auto mb-2" />
          <p className="text-slate-400 text-xs">No tuition plan set.</p>
          <Link
            href={`/admin/tuition/${studentId}`}
            className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus size={12} />
            Add plan
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{activePlan.academic_year}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
              activePlan.status === 'active' ? 'bg-blue-100 text-blue-700' :
              activePlan.status === 'completed' ? 'bg-green-100 text-green-700' :
              'bg-slate-100 text-slate-600'
            }`}>{activePlan.status}</span>
          </div>

          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, netTotal > 0 ? (paid / netTotal) * 100 : 0)}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-slate-400">Total</p>
              <p className="text-sm font-semibold text-slate-700">{formatCurrency(netTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Paid</p>
              <p className="text-sm font-semibold text-green-600">{formatCurrency(paid)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Balance</p>
              <p className={`text-sm font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {balance > 0 ? formatCurrency(balance) : '✓ Paid'}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400 capitalize">
            {activePlan.payment_structure} · {formatCurrency(Number(activePlan.payment_amount))} per installment
          </p>

          {plans.length > 1 && (
            <p className="text-xs text-slate-400">{plans.length - 1} previous plan{plans.length > 2 ? 's' : ''}</p>
          )}
        </div>
      )}
    </div>
  )
}
