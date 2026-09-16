import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMailViaGoogle } from '@/lib/email'

type Db = SupabaseClient

// Tools the assistant can call without asking first — all read-only queries
// against data staff already have access to in the CRM itself.
export const READ_ONLY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_student',
    description: 'Search students by name. Returns up to 8 matches with id, name, grade, and status. Use this first whenever you need a student id for another tool.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Full or partial student name' } },
      required: ['query'],
    },
  },
  {
    name: 'get_tuition_status',
    description: "Get a student's tuition plans, payment totals, and outstanding balance for each academic year plan on file.",
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string', description: 'Student id from search_student' } },
      required: ['studentId'],
    },
  },
  {
    name: 'search_donor',
    description: 'Search donors by name. Returns up to 8 matches with id, name, and category.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Full or partial donor name' } },
      required: ['query'],
    },
  },
  {
    name: 'get_donor_summary',
    description: "Get a donor's total giving, giving by year, and most recent donations.",
    input_schema: {
      type: 'object',
      properties: { donorId: { type: 'string', description: 'Donor id from search_donor' } },
      required: ['donorId'],
    },
  },
  {
    name: 'get_sola_sync_overview',
    description: 'Get the current Sola Sync review queue status: how many customers are matched/unmatched/needing review, and how many incoming payments are pending review.',
    input_schema: { type: 'object', properties: {} },
  },
]

// Tools with a real-world effect outside the CRM's own database — never
// executed automatically. The chat route pauses and returns these to the
// client for an explicit staff approve/reject before running them for real.
export const SENSITIVE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'send_email',
    description: 'Send an email from the school\'s connected email account. Always show the staff member the exact subject and body before this is called, since it requires their explicit approval and cannot be undone once sent.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain text body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
]

export const ALL_TOOLS = [...READ_ONLY_TOOLS, ...SENSITIVE_TOOLS]
export const SENSITIVE_TOOL_NAMES = new Set(SENSITIVE_TOOLS.map(t => t.name))

function money(n: number | null | undefined) {
  return `$${Number(n ?? 0).toFixed(2)}`
}

export async function executeReadOnlyTool(db: Db, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_student': {
      const query = String(input.query ?? '')
      const { data, error } = await db.from('students')
        .select('id,first_name,last_name,grade_level,status')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .limit(8)
      if (error) return { error: error.message }
      return { matches: (data ?? []).map(s => ({ id: s.id, name: `${s.first_name} ${s.last_name}`, grade: s.grade_level, status: s.status })) }
    }

    case 'get_tuition_status': {
      const studentId = String(input.studentId ?? '')
      const { data: student, error: studentError } = await db.from('students').select('first_name,last_name').eq('id', studentId).single()
      if (studentError || !student) return { error: 'Student not found.' }
      const { data: plans } = await db.from('tuition_plans')
        .select('id,academic_year,total_amount,yearly_amount,building_fund_amount,status')
        .eq('student_id', studentId).order('academic_year', { ascending: false })
      const { data: payments } = await db.from('tuition_payments')
        .select('tuition_plan_id,amount,payment_type,payment_date').eq('student_id', studentId)

      const plansOut = (plans ?? []).map(plan => {
        const paid = (payments ?? []).filter(p => p.tuition_plan_id === plan.id && p.payment_type !== 'building_fund')
          .reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
        const charged = Number(plan.yearly_amount ?? plan.total_amount ?? 0)
        return {
          academicYear: plan.academic_year, status: plan.status,
          charged: money(charged), paid: money(paid), balance: money(charged - paid),
        }
      })
      const lastPayment = (payments ?? []).sort((a, b) => (b.payment_date ?? '').localeCompare(a.payment_date ?? ''))[0]
      return {
        student: `${student.first_name} ${student.last_name}`,
        plans: plansOut,
        lastPayment: lastPayment ? { date: lastPayment.payment_date, amount: money(lastPayment.amount), type: lastPayment.payment_type } : null,
      }
    }

    case 'search_donor': {
      const query = String(input.query ?? '')
      const { data, error } = await db.from('donors').select('id,name,category').ilike('name', `%${query}%`).limit(8)
      if (error) return { error: error.message }
      return { matches: data ?? [] }
    }

    case 'get_donor_summary': {
      const donorId = String(input.donorId ?? '')
      const { data: donor, error: donorError } = await db.from('donors').select('name').eq('id', donorId).single()
      if (donorError || !donor) return { error: 'Donor not found.' }
      const { data: donations } = await db.from('donations')
        .select('amount,donation_date,category,purpose').eq('donor_id', donorId).order('donation_date', { ascending: false })

      const byYear = new Map<string, number>()
      for (const d of donations ?? []) {
        const year = (d.donation_date ?? '').slice(0, 4) || 'unknown'
        byYear.set(year, (byYear.get(year) ?? 0) + Number(d.amount ?? 0))
      }
      const total = (donations ?? []).reduce((sum, d) => sum + Number(d.amount ?? 0), 0)
      return {
        donor: donor.name,
        totalGiving: money(total),
        givingByYear: Object.fromEntries([...byYear.entries()].map(([y, v]) => [y, money(v)])),
        recentDonations: (donations ?? []).slice(0, 5).map(d => ({ date: d.donation_date, amount: money(d.amount), purpose: d.purpose, category: d.category })),
      }
    }

    case 'get_sola_sync_overview': {
      const { data: customers } = await db.from('sola_sync_customers').select('match_status')
      const { count: pendingPayments } = await db.from('sola_sync_payments').select('id', { count: 'exact', head: true }).in('import_status', ['pending', 'needs_review'])
      const summary = { matched: 0, needs_review: 0, unmatched: 0, not_a_student: 0, merged: 0 }
      for (const c of customers ?? []) if (c.match_status in summary) (summary as Record<string, number>)[c.match_status]++
      return { customerStatus: summary, pendingOrNeedsReviewPayments: pendingPayments ?? 0 }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

export async function executeSensitiveTool(db: Db, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'send_email': {
      const to = Array.isArray(input.to) ? input.to.map(String) : []
      const subject = String(input.subject ?? '')
      const body = String(input.body ?? '')
      if (!to.length || !subject || !body) return { error: 'Missing to, subject, or body.' }
      const result = await sendMailViaGoogle(db, { to, subject, body })
      return { ...result, success: true }
    }
    default:
      return { error: `Unknown sensitive tool: ${name}` }
  }
}
