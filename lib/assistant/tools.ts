import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMailViaGoogle } from '@/lib/email'

type Db = SupabaseClient

// Every table run_report is allowed to query. Deliberately broad ("reports
// on everything") — safety here comes from column-level redaction below,
// not from hiding whole tables, so a table only needs to be left off this
// list if reporting on it wouldn't mean anything to staff (e.g. it's pure
// internal plumbing with no reportable columns at all).
const REPORTABLE_TABLES = new Set([
  'students', 'guardians', 'student_guardians', 'staff', 'classes', 'class_enrollments', 'class_staff',
  'academic_terms', 'lunch_menus', 'lunch_accounts', 'lunch_transactions', 'books', 'book_loans',
  'tuition_plans', 'tuition_payments', 'tuition_documents', 'tuition_document_plans',
  'custom_payment_calendars', 'custom_payment_calendar_entries',
  'payment_methods', 'payment_schedules', 'payment_transactions', 'payments',
  'invoices', 'invoice_items', 'fee_categories',
  'ledger_accounts', 'ledger_entries', 'ledger_lines', 'expenses',
  'donors', 'donations', 'donor_students', 'donor_documents', 'pledges', 'pledge_payments', 'recurring_donations',
  'events', 'communications', 'email_accounts', 'site_settings', 'site_pages', 'site_blocks',
  'document_templates', 'merge_documents',
  'sola_sync_customers', 'sola_sync_schedules', 'sola_sync_payments',
])

// Column names redacted from every run_report result no matter which table
// they came from — defense in depth beyond REPORTABLE_TABLES, since a
// column can carry a secret or protected-health/PII value on a table that's
// otherwise perfectly fine to report on (e.g. students.ssn).
const ALWAYS_REDACT_COLUMNS = new Set(['ssn', 'medical_notes', 'allergies', 'raw_response'])
const SENSITIVE_COLUMN_PATTERN = /token|secret|password|client_secret|card[_ ]?number|cvv|routing|account_number/i

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (ALWAYS_REDACT_COLUMNS.has(key) || SENSITIVE_COLUMN_PATTERN.test(key)) continue
    out[key] = value
  }
  // Generic key/value settings tables (e.g. site_settings) don't carry the
  // secret in the column name — it's in a `value` cell next to a `key` cell
  // like "google_client_secret" — so redact by key name in that shape too.
  if (typeof out.key === 'string' && SENSITIVE_COLUMN_PATTERN.test(out.key)) out.value = '[redacted]'
  return out
}

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
  {
    name: 'run_report',
    description: `Run a read-only report against any table in the CRM: students, staff, classes, academic_terms, lunch_menus/accounts/transactions, books, book_loans, tuition_plans, tuition_payments, tuition_documents, custom_payment_calendars(+entries), payment_methods/schedules/transactions, payments, invoices(+items), fee_categories, ledger_accounts/entries/lines, expenses, donors, donations, pledges, pledge_payments, recurring_donations, events, communications, email_accounts, site_settings/pages/blocks, document_templates, merge_documents, sola_sync_customers/schedules/payments, guardians, student_guardians, donor_students, donor_documents. This is the general tool for "how many / how much / list / total" questions that aren't already covered by a more specific tool (prefer get_tuition_status / get_donor_summary for those). Sensitive columns (SSN, medical notes, credentials, payment tokens) are always stripped from results and can't be requested.`,
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Exact table name from the list in this tool\'s description' },
        filters: {
          type: 'array',
          description: 'AND-combined filters',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is_null', 'not_null'] },
              value: { type: 'string', description: 'Not needed for is_null / not_null' },
            },
            required: ['column', 'op'],
          },
        },
        orderBy: {
          type: 'object',
          properties: { column: { type: 'string' }, ascending: { type: 'boolean' } },
        },
        limit: { type: 'number', description: 'Max rows to return when not aggregating (default 25, max 200)' },
        aggregate: {
          type: 'object',
          description: 'Optional rollup computed over every matching row (not just the returned page) — use for totals/counts/breakdowns instead of eyeballing a row list.',
          properties: {
            groupBy: { type: 'string', description: 'Column to group by, e.g. category or academic_year' },
            sumColumn: { type: 'string', description: 'Numeric column to sum per group, e.g. amount' },
            count: { type: 'boolean', description: 'Include a row count per group' },
          },
        },
      },
      required: ['table'],
    },
  },
]

// Tools with a real-world effect or a permanent database write — never
// executed automatically. The chat route pauses and returns these to the
// client for an explicit staff approve/reject before running them for real.
// Each mirrors the exact insert the corresponding CRM page itself performs
// (same fields, same defaults) rather than writing to arbitrary columns, so
// a chat-entered record looks identical to one entered through the normal
// form and doesn't skip whatever business logic that form relies on.
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
  {
    name: 'record_donation',
    description: 'Record a donation for an existing donor (look the donor up with search_donor first).',
    input_schema: {
      type: 'object',
      properties: {
        donorId: { type: 'string' },
        amount: { type: 'number' },
        donationDate: { type: 'string', description: 'YYYY-MM-DD' },
        donationMethod: { type: 'string', description: 'e.g. Check, Cash, Credit Card' },
        purpose: { type: 'string', description: 'e.g. General Fund' },
        category: { type: 'string', enum: ['one_time', 'monthly_recurring', 'event'] },
        eventId: { type: 'string', description: 'Required only when category is "event"' },
        notes: { type: 'string' },
      },
      required: ['donorId', 'amount', 'donationDate', 'donationMethod', 'purpose', 'category'],
    },
  },
  {
    name: 'add_donor',
    description: 'Create a new donor record.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phoneNumber: { type: 'string' },
        address: { type: 'string' },
        category: { type: 'string' },
        relationship: { type: 'string', description: 'e.g. Parent, Grandparent, Community' },
        title: { type: 'string', description: 'e.g. Mr. & Mrs.' },
      },
      required: ['name', 'category', 'relationship'],
    },
  },
  {
    name: 'record_tuition_payment',
    description: 'Record a tuition, building fund, phone charge, or registration fee payment for an existing student (look the student up with search_student first, and use get_tuition_status to find the right tuition plan id for tuition/building-fund payments).',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        tuitionPlanId: { type: 'string', description: 'Required for payment_type tuition or building_fund; omit for registration_fee or phone_charge' },
        amount: { type: 'number' },
        paymentDate: { type: 'string', description: 'YYYY-MM-DD' },
        paymentType: { type: 'string', enum: ['tuition', 'building_fund', 'registration_fee', 'phone_charge'] },
        paymentMethod: { type: 'string', description: 'e.g. Check, Cash, Credit Card' },
        notes: { type: 'string' },
      },
      required: ['studentId', 'amount', 'paymentDate', 'paymentType'],
    },
  },
  {
    name: 'add_student',
    description: 'Create a new student record with the common fields staff typically know at intake. This covers the fields most requests need — for anything beyond these (e.g. detailed family/grandparent info), tell the staff member to fill that in on the student\'s own page after creation.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        gradeLevel: { type: 'string' },
        status: { type: 'string', enum: ['active', 'inactive', 'graduated', 'withdrawn'] },
        enrollmentDate: { type: 'string', description: 'YYYY-MM-DD' },
        cameSemester: { type: 'string' },
        address: { type: 'string' },
        fatherName: { type: 'string' },
        motherName: { type: 'string' },
        fatherEmail: { type: 'string' },
        motherEmail: { type: 'string' },
        fatherCell: { type: 'string' },
        motherCell: { type: 'string' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'log_expense',
    description: 'Log a school expense.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        category: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number' },
        vendor: { type: 'string' },
        paymentMethod: { type: 'string', description: 'e.g. Cash, Check, Credit Card — defaults to Cash' },
        notes: { type: 'string' },
      },
      required: ['date', 'category', 'description', 'amount'],
    },
  },
  {
    name: 'add_pledge',
    description: 'Create a new pledge for an existing donor (look the donor up with search_donor first).',
    input_schema: {
      type: 'object',
      properties: {
        donorId: { type: 'string' },
        amount: { type: 'number' },
        pledgeDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        purpose: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['donorId', 'amount'],
    },
  },
  {
    name: 'record_pledge_payment',
    description: 'Record a payment against an existing pledge.',
    input_schema: {
      type: 'object',
      properties: {
        pledgeId: { type: 'string' },
        amount: { type: 'number' },
        paymentDate: { type: 'string', description: 'YYYY-MM-DD' },
        paymentMethod: { type: 'string', description: 'e.g. Check, Cash, Credit Card — defaults to Cash' },
        notes: { type: 'string' },
      },
      required: ['pledgeId', 'amount'],
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
          id: plan.id, academicYear: plan.academic_year, status: plan.status,
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

    case 'run_report': {
      const table = String(input.table ?? '')
      if (!REPORTABLE_TABLES.has(table)) return { error: `"${table}" isn't available for reporting. See this tool's description for the list of valid table names.` }

      const aggregate = input.aggregate as { groupBy?: string; sumColumn?: string; count?: boolean } | undefined
      const requestedLimit = Math.max(1, Math.min(Number(input.limit ?? 25) || 25, 200))

      let query = db.from(table).select('*')
      for (const raw of (input.filters as Array<Record<string, unknown>> | undefined) ?? []) {
        const column = String(raw.column ?? '')
        const op = String(raw.op ?? '')
        const value = raw.value
        if (!column) continue
        switch (op) {
          case 'eq': query = query.eq(column, value as string); break
          case 'neq': query = query.neq(column, value as string); break
          case 'gt': query = query.gt(column, value as string); break
          case 'gte': query = query.gte(column, value as string); break
          case 'lt': query = query.lt(column, value as string); break
          case 'lte': query = query.lte(column, value as string); break
          case 'ilike': query = query.ilike(column, `%${value}%`); break
          case 'is_null': query = query.is(column, null); break
          case 'not_null': query = query.not(column, 'is', null); break
        }
      }
      const orderBy = input.orderBy as { column?: string; ascending?: boolean } | undefined
      if (orderBy?.column) query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true })
      query = query.limit(aggregate ? 5000 : requestedLimit)

      const { data, error } = await query
      if (error) return { error: error.message }
      const rows = (data ?? []).map(redactRow)

      if (aggregate) {
        const groups = new Map<string, { count: number; sum: number }>()
        for (const row of rows) {
          const key = aggregate.groupBy ? String(row[aggregate.groupBy] ?? '(none)') : 'all'
          const g = groups.get(key) ?? { count: 0, sum: 0 }
          g.count++
          if (aggregate.sumColumn) g.sum += Number(row[aggregate.sumColumn] ?? 0)
          groups.set(key, g)
        }
        return {
          table, matchingRowCount: rows.length,
          groups: Object.fromEntries([...groups.entries()].map(([k, v]) => [
            k, { ...(aggregate.count !== false ? { count: v.count } : {}), ...(aggregate.sumColumn ? { sum: money(v.sum) } : {}) },
          ])),
        }
      }

      return { table, rowCount: rows.length, rows }
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

    case 'record_donation': {
      const { data, error } = await db.from('donations').insert([{
        donor_id: input.donorId, amount: Number(input.amount ?? 0), donation_method: input.donationMethod ?? null,
        donation_date: input.donationDate ?? null, purpose: input.purpose ?? null, notes: input.notes ?? null,
        category: input.category ?? 'one_time', event_id: input.category === 'event' ? (input.eventId ?? null) : null,
        source: 'manual',
      }]).select('id').single()
      if (error) return { error: error.message }
      return { success: true, donationId: data.id }
    }

    case 'add_donor': {
      const { data, error } = await db.from('donors').insert([{
        name: input.name, email: input.email ?? null, address: input.address ?? null,
        phone_number: input.phoneNumber ?? null, category: input.category, relationship: input.relationship,
        title: input.title ?? null,
      }]).select('id').single()
      if (error) return { error: error.message }
      return { success: true, donorId: data.id }
    }

    case 'record_tuition_payment': {
      const paymentType = String(input.paymentType ?? 'tuition')
      const perPlan = paymentType === 'tuition' || paymentType === 'building_fund'
      if (perPlan && !input.tuitionPlanId) return { error: 'tuitionPlanId is required for tuition and building_fund payments — use get_tuition_status to find it.' }
      const { data, error } = await db.from('tuition_payments').insert([{
        tuition_plan_id: perPlan ? input.tuitionPlanId : null, student_id: input.studentId,
        amount: Number(input.amount ?? 0), payment_date: input.paymentDate ?? null, status: 'paid',
        payment_type: paymentType, payment_method: input.paymentMethod ?? null, notes: input.notes ?? null,
      }]).select('id').single()
      if (error) return { error: error.message }
      return { success: true, tuitionPaymentId: data.id }
    }

    case 'add_student': {
      const { data, error } = await db.from('students').insert([{
        first_name: input.firstName, last_name: input.lastName, grade_level: input.gradeLevel ?? null,
        status: input.status ?? 'active', enrollment_date: input.enrollmentDate ?? null, came_semester: input.cameSemester ?? null,
        address: input.address ?? null, father_name: input.fatherName ?? null, mother_name: input.motherName ?? null,
        father_email: input.fatherEmail ?? null, mother_email: input.motherEmail ?? null,
        father_cell: input.fatherCell ?? null, mother_cell: input.motherCell ?? null,
      }]).select('id').single()
      if (error) return { error: error.message }
      // Best-effort, mirrors the student page's own create flow — a Sola
      // sync hiccup shouldn't undo an otherwise-successful student record.
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/sola/customers`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'student', id: data.id }),
        })
      } catch { /* best-effort */ }
      return { success: true, studentId: data.id }
    }

    case 'log_expense': {
      const { data, error } = await db.from('expenses').insert([{
        date: input.date, category: input.category, description: input.description, amount: Number(input.amount ?? 0),
        vendor: input.vendor ?? null, payment_method: input.paymentMethod ?? 'Cash', notes: input.notes ?? null,
      }]).select('id').single()
      if (error) return { error: error.message }
      return { success: true, expenseId: data.id }
    }

    case 'add_pledge': {
      const { data, error } = await db.from('pledges').insert([{
        donor_id: input.donorId, amount: Number(input.amount ?? 0), pledge_date: input.pledgeDate ?? undefined,
        due_date: input.dueDate ?? null, purpose: input.purpose ?? null, notes: input.notes ?? null,
      }]).select('id').single()
      if (error) return { error: error.message }
      return { success: true, pledgeId: data.id }
    }

    case 'record_pledge_payment': {
      const { data, error } = await db.from('pledge_payments').insert([{
        pledge_id: input.pledgeId, amount: Number(input.amount ?? 0), payment_date: input.paymentDate ?? undefined,
        payment_method: input.paymentMethod ?? 'Cash', notes: input.notes ?? null,
      }]).select('id').single()
      if (error) return { error: error.message }
      return { success: true, pledgePaymentId: data.id }
    }

    default:
      return { error: `Unknown sensitive tool: ${name}` }
  }
}
