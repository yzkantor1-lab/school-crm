import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMailViaGoogle } from '@/lib/email'
import { recomputePledgeTotals } from '@/lib/pledges'
import { archiveDonorDocument } from '@/lib/documentArchive'

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
    description: "Get a donor's contact email, total giving, giving by year, most recent donations, and pledges (each with its payments).",
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
    name: 'list_recent_assistant_actions',
    description: 'List the assistant\'s own recent logged changes (inserts, edits, deletes of tuition payments, donations, donors, expenses, pledges, pledge payments) with their ids, most recent first, including which are already undone. Use this when the staff member asks "what did you just do", "undo that", or "redo it" without naming a specific record — it tells you which action id to pass to undo_last_change / redo_last_undo.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'default 10, max 50' } },
    },
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
        donorId: { type: 'string', description: 'Optional — the donor this email is about, so it shows in their Communications history' },
        studentId: { type: 'string', description: 'Optional — the student this email is about, so it shows in their Communications history' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_donation_receipt',
    description: 'Email the official donation receipt PDF (letterhead, amount, date, method, purpose, tax ID) for one donation — the same receipt the donor page\'s "Email receipt" button sends. Find the donation id and the donor\'s email with get_donor_summary first; if the donor has no email on file, offer to add one with update_donor. The send is logged in Communications and the PDF is saved to the donor\'s Documents. Cannot be undone once sent.',
    input_schema: {
      type: 'object',
      properties: {
        donationId: { type: 'string' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses — normally the donor\'s own email' },
        note: { type: 'string', description: 'Optional note printed on the receipt itself' },
        subject: { type: 'string', description: 'Optional — defaults to "Donation Receipt — <donor name>"' },
        body: { type: 'string', description: 'Optional plain text email body — defaults to a short thank-you mentioning the amount and date' },
      },
      required: ['donationId', 'to'],
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
    name: 'update_donor',
    description: 'Edit an existing donor\'s name, title, or contact details (email, phone, address) or their category/relationship. Look up the donor id first with search_donor. Only the fields passed are changed. Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        donorId: { type: 'string' },
        name: { type: 'string' },
        title: { type: 'string', description: 'e.g. Mr. & Mrs.' },
        email: { type: 'string' },
        phoneNumber: { type: 'string' },
        address: { type: 'string' },
        category: { type: 'string' },
        relationship: { type: 'string' },
      },
      required: ['donorId'],
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
  {
    name: 'update_tuition_payment',
    description: 'Edit an existing tuition, building fund, registration fee, or phone charge payment. Look up the payment id first via get_tuition_status (its payments list). Only the fields passed are changed. Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string' },
        amount: { type: 'number' },
        paymentDate: { type: 'string', description: 'YYYY-MM-DD' },
        paymentType: { type: 'string', enum: ['tuition', 'building_fund', 'registration_fee', 'phone_charge'] },
        paymentMethod: { type: 'string', description: 'e.g. Check, Cash, Credit Card' },
        status: { type: 'string', enum: ['paid', 'partial', 'forgiven', 'pending', 'overdue', 'waived'] },
        notes: { type: 'string' },
      },
      required: ['paymentId'],
    },
  },
  {
    name: 'delete_tuition_payment',
    description: 'Permanently delete a tuition, building fund, registration fee, or phone charge payment. Look up the payment id first via get_tuition_status (its payments list). Logged — can be undone with undo_last_change, which brings the exact same record back.',
    input_schema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string' },
        reason: { type: 'string', description: 'Why this is being deleted — kept in the audit note' },
      },
      required: ['paymentId'],
    },
  },
  {
    name: 'update_donation',
    description: 'Edit an existing donation. Look up the donation id first via get_donor_summary (its donations list). Only the fields passed are changed. Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        donationId: { type: 'string' },
        amount: { type: 'number' },
        donationDate: { type: 'string', description: 'YYYY-MM-DD' },
        donationMethod: { type: 'string' },
        purpose: { type: 'string' },
        category: { type: 'string', enum: ['one_time', 'monthly_recurring', 'event'] },
        eventId: { type: 'string', description: 'Only relevant when category is "event"' },
        notes: { type: 'string' },
      },
      required: ['donationId'],
    },
  },
  {
    name: 'delete_donation',
    description: 'Permanently delete a donation. Look up the donation id first via get_donor_summary (its donations list). Logged — can be undone with undo_last_change, which brings the exact same record back.',
    input_schema: {
      type: 'object',
      properties: {
        donationId: { type: 'string' },
        reason: { type: 'string', description: 'Why this is being deleted — kept in the audit note' },
      },
      required: ['donationId'],
    },
  },
  {
    name: 'update_expense',
    description: 'Edit an existing expense. Look up the expense id first via run_report on the expenses table. Only the fields passed are changed. Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        expenseId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        category: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number' },
        vendor: { type: 'string' },
        paymentMethod: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['expenseId'],
    },
  },
  {
    name: 'delete_expense',
    description: 'Permanently delete an expense. Look up the expense id first via run_report on the expenses table. Logged — can be undone with undo_last_change, which brings the exact same record back.',
    input_schema: {
      type: 'object',
      properties: {
        expenseId: { type: 'string' },
        reason: { type: 'string', description: 'Why this is being deleted — kept in the audit note' },
      },
      required: ['expenseId'],
    },
  },
  {
    name: 'update_pledge',
    description: 'Edit an existing pledge\'s terms. Look up the pledge id first via get_donor_summary (its pledges list). Only the fields passed are changed; the amount paid is always derived from the pledge\'s payments and can\'t be set directly. Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        pledgeId: { type: 'string' },
        amount: { type: 'number' },
        pledgeDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        purpose: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['pledgeId'],
    },
  },
  {
    name: 'delete_pledge',
    description: 'Permanently delete a pledge. Only allowed once it has no payments recorded against it — delete those first with delete_pledge_payment. Look up the pledge id first via get_donor_summary (its pledges list). Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        pledgeId: { type: 'string' },
        reason: { type: 'string', description: 'Why this is being deleted — kept in the audit note' },
      },
      required: ['pledgeId'],
    },
  },
  {
    name: 'update_pledge_payment',
    description: 'Edit an existing pledge payment. Look up the payment id first via get_donor_summary (each pledge\'s payments list). Only the fields passed are changed. Logged — can be undone with undo_last_change.',
    input_schema: {
      type: 'object',
      properties: {
        pledgePaymentId: { type: 'string' },
        amount: { type: 'number' },
        paymentDate: { type: 'string', description: 'YYYY-MM-DD' },
        paymentMethod: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['pledgePaymentId'],
    },
  },
  {
    name: 'delete_pledge_payment',
    description: 'Permanently delete a pledge payment. Look up the payment id first via get_donor_summary (each pledge\'s payments list). Logged — can be undone with undo_last_change, which brings the exact same record back.',
    input_schema: {
      type: 'object',
      properties: {
        pledgePaymentId: { type: 'string' },
        reason: { type: 'string', description: 'Why this is being deleted — kept in the audit note' },
      },
      required: ['pledgePaymentId'],
    },
  },
  {
    name: 'undo_last_change',
    description: 'Reverses the assistant\'s most recent not-yet-undone change to a tuition payment, donation, donor, expense, pledge, or pledge payment — restores a just-deleted record, reverts an edit to its prior values, or removes a record that was just added. Pass actionId (from list_recent_assistant_actions) to undo a specific earlier change instead of the most recent one.',
    input_schema: {
      type: 'object',
      properties: { actionId: { type: 'string', description: 'Optional — omit to undo the most recent undoable change' } },
    },
  },
  {
    name: 'redo_last_undo',
    description: 'Re-applies the assistant\'s most recently undone change — only works on something that was just undone. Pass actionId (from list_recent_assistant_actions) to redo a specific earlier undo instead of the most recent one.',
    input_schema: {
      type: 'object',
      properties: { actionId: { type: 'string', description: 'Optional — omit to redo the most recently undone change' } },
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
        .select('id,tuition_plan_id,amount,payment_type,payment_date,payment_method,status,notes')
        .eq('student_id', studentId).order('payment_date', { ascending: false })

      const plansOut = (plans ?? []).map(plan => {
        const paid = (payments ?? []).filter(p => p.tuition_plan_id === plan.id && p.payment_type !== 'building_fund')
          .reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
        const charged = Number(plan.yearly_amount ?? plan.total_amount ?? 0)
        return {
          id: plan.id, academicYear: plan.academic_year, status: plan.status,
          charged: money(charged), paid: money(paid), balance: money(charged - paid),
        }
      })
      // Includes each payment's own id — required to target update_tuition_payment /
      // delete_tuition_payment at a specific record rather than guessing.
      return {
        student: `${student.first_name} ${student.last_name}`,
        plans: plansOut,
        payments: (payments ?? []).map(p => ({
          id: p.id, tuitionPlanId: p.tuition_plan_id, date: p.payment_date, amount: money(p.amount),
          type: p.payment_type, method: p.payment_method, status: p.status, notes: p.notes,
        })),
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
      const { data: donor, error: donorError } = await db.from('donors').select('name,email').eq('id', donorId).single()
      if (donorError || !donor) return { error: 'Donor not found.' }
      const { data: donations } = await db.from('donations')
        .select('id,amount,donation_date,category,purpose,notes,donation_method').eq('donor_id', donorId)
        .order('donation_date', { ascending: false }).limit(500)

      const byYear = new Map<string, number>()
      for (const d of donations ?? []) {
        const year = (d.donation_date ?? '').slice(0, 4) || 'unknown'
        byYear.set(year, (byYear.get(year) ?? 0) + Number(d.amount ?? 0))
      }
      const { data: pledges } = await db.from('pledges')
        .select('id,amount,amount_paid,pledge_date,due_date,purpose,fulfilled,notes,pledge_payments(id,amount,payment_date,payment_method,notes)')
        .eq('donor_id', donorId).order('pledge_date', { ascending: false })
      const total = (donations ?? []).reduce((sum, d) => sum + Number(d.amount ?? 0), 0)
      // Includes each donation's own id — required to target update_donation /
      // delete_donation at a specific record rather than guessing. Capped to
      // the 30 most recent to keep the response compact; totalGiving/
      // givingByYear above still reflect the full history.
      return {
        donor: donor.name,
        email: donor.email,
        totalGiving: money(total),
        givingByYear: Object.fromEntries([...byYear.entries()].map(([y, v]) => [y, money(v)])),
        donations: (donations ?? []).slice(0, 30).map(d => ({
          id: d.id, date: d.donation_date, amount: money(d.amount), purpose: d.purpose,
          category: d.category, method: d.donation_method, notes: d.notes,
        })),
        // Ids here are what update_pledge / delete_pledge / update_pledge_payment /
        // delete_pledge_payment target.
        pledges: (pledges ?? []).map(p => ({
          id: p.id, pledgeDate: p.pledge_date, dueDate: p.due_date, purpose: p.purpose, notes: p.notes,
          amount: money(p.amount), paid: money(p.amount_paid), balance: money(Number(p.amount) - Number(p.amount_paid)),
          fulfilled: p.fulfilled,
          payments: (p.pledge_payments ?? []).map(pp => ({
            id: pp.id, date: pp.payment_date, amount: money(pp.amount), method: pp.payment_method, notes: pp.notes,
          })),
        })),
      }
    }

    case 'list_recent_assistant_actions': {
      const limit = Math.max(1, Math.min(Number(input.limit ?? 10) || 10, 50))
      const { data, error } = await db.from('assistant_actions')
        .select('id,action_type,table_name,description,created_at,undone_at')
        .order('created_at', { ascending: false }).limit(limit)
      if (error) return { error: error.message }
      return { actions: data }
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

// One row per assistant-caused insert/update/delete on tuition_payments or
// donations — see the assistant_actions migration. before_data/after_data
// are full-row snapshots (not diffs) so undo/redo can restore or reapply a
// record exactly, including bringing a deleted row back with its original id.
async function logAction(db: Db, params: {
  performedBy: string | null
  actionType: 'insert' | 'update' | 'delete'
  table: string
  recordId: string
  beforeData: Record<string, unknown> | null
  afterData: Record<string, unknown> | null
  description: string
}) {
  await db.from('assistant_actions').insert([{
    performed_by: params.performedBy, action_type: params.actionType, table_name: params.table,
    record_id: params.recordId, before_data: params.beforeData, after_data: params.afterData,
    description: params.description,
  }])
}

type ActionRow = {
  id: string
  action_type: 'insert' | 'update' | 'delete'
  table_name: string
  record_id: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  description: string
}

// Child rows that would be cascade-deleted along with a parent record (or
// that would make the delete fail outright). Removing a parent that has any
// is refused — both for a direct delete tool and for an undo/redo that
// amounts to a delete — because the undo log only snapshots the parent row
// itself, so those children could never be brought back.
const DEPENDENTS: Record<string, [table: string, column: string][]> = {
  pledges: [['pledge_payments', 'pledge_id']],
  donors: [
    ['donations', 'donor_id'], ['pledges', 'donor_id'], ['recurring_donations', 'donor_id'],
    ['donor_students', 'donor_id'], ['donor_documents', 'donor_id'], ['custom_payment_calendars', 'donor_id'],
    ['merge_documents', 'donor_id'], ['payment_methods', 'donor_id'], ['payment_schedules', 'donor_id'],
    ['payment_transactions', 'donor_id'], ['communications', 'donor_id'],
  ],
}

async function dependentsBlockingRemoval(db: Db, table: string, id: string): Promise<string | null> {
  const found: string[] = []
  for (const [child, column] of DEPENDENTS[table] ?? []) {
    const { count, error } = await db.from(child).select(column, { count: 'exact', head: true }).eq(column, id)
    if (error) return `Couldn't check ${child} before removing this record: ${error.message}`
    if (count) found.push(`${count} ${child.replace(/_/g, ' ')}`)
  }
  return found.length ? `This record still has ${found.join(', ')} attached, which would be permanently lost along with it. Remove or reassign those first.` : null
}

// Undo/redo can change either side of the pledge <-> payments relationship,
// so re-derive the pledge's totals afterward (see recomputePledgeTotals).
async function afterRestore(db: Db, action: ActionRow) {
  if (action.table_name === 'pledge_payments') {
    const pledgeId = (action.after_data ?? action.before_data)?.pledge_id
    if (typeof pledgeId === 'string') await recomputePledgeTotals(db, pledgeId)
  } else if (action.table_name === 'pledges') {
    await recomputePledgeTotals(db, action.record_id)
  }
}

async function applyUndo(db: Db, action: ActionRow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (action.action_type === 'insert') {
    const blocked = await dependentsBlockingRemoval(db, action.table_name, action.record_id)
    if (blocked) return { ok: false, error: blocked }
    const { error } = await db.from(action.table_name).delete().eq('id', action.record_id)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  if (action.action_type === 'update') {
    if (!action.before_data) return { ok: false, error: 'No prior state recorded for this change.' }
    const { error } = await db.from(action.table_name).update(action.before_data).eq('id', action.record_id)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  // delete — bring the exact row back, original id included.
  if (!action.before_data) return { ok: false, error: 'No prior state recorded for this deletion.' }
  const { error } = await db.from(action.table_name).insert([action.before_data])
  return error ? { ok: false, error: error.message } : { ok: true }
}

async function applyRedo(db: Db, action: ActionRow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (action.action_type === 'insert') {
    if (!action.after_data) return { ok: false, error: 'No recorded data to re-insert.' }
    const { error } = await db.from(action.table_name).insert([action.after_data])
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  if (action.action_type === 'update') {
    if (!action.after_data) return { ok: false, error: 'No recorded data to re-apply.' }
    const { error } = await db.from(action.table_name).update(action.after_data).eq('id', action.record_id)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  // delete
  const blocked = await dependentsBlockingRemoval(db, action.table_name, action.record_id)
  if (blocked) return { ok: false, error: blocked }
  const { error } = await db.from(action.table_name).delete().eq('id', action.record_id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Shared body of the update_* / delete_* tools below: snapshot the row,
// apply the change, and log it so undo_last_change can reverse it.
async function updateLogged(db: Db, userId: string | null, table: string, id: string, patch: Record<string, unknown>,
  describe: (before: Record<string, unknown>) => string): Promise<{ ok: true; before: Record<string, unknown> } | { ok: false; error: string }> {
  const { data: before, error: fetchError } = await db.from(table).select('*').eq('id', id).single()
  if (fetchError || !before) return { ok: false, error: 'Record not found.' }
  if (!Object.keys(patch).length) return { ok: false, error: 'No changes provided.' }
  const { data: after, error } = await db.from(table).update(patch).eq('id', id).select('*').single()
  if (error) return { ok: false, error: error.message }
  await logAction(db, { performedBy: userId, actionType: 'update', table, recordId: id, beforeData: before, afterData: after, description: describe(before) })
  return { ok: true, before }
}

async function deleteLogged(db: Db, userId: string | null, table: string, id: string, reason: unknown,
  describe: (before: Record<string, unknown>) => string): Promise<{ ok: true; before: Record<string, unknown> } | { ok: false; error: string }> {
  const { data: before, error: fetchError } = await db.from(table).select('*').eq('id', id).single()
  if (fetchError || !before) return { ok: false, error: 'Record not found.' }
  const blocked = await dependentsBlockingRemoval(db, table, id)
  if (blocked) return { ok: false, error: blocked }
  const { error } = await db.from(table).delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  await logAction(db, {
    performedBy: userId, actionType: 'delete', table, recordId: id, beforeData: before, afterData: null,
    description: `${describe(before)}${reason ? ` — ${reason}` : ''}`,
  })
  return { ok: true, before }
}

function pick(input: Record<string, unknown>, mapping: [inputKey: string, column: string, numeric?: boolean][]) {
  const patch: Record<string, unknown> = {}
  for (const [key, column, numeric] of mapping) if (input[key] !== undefined) patch[column] = numeric ? Number(input[key]) : input[key]
  return patch
}

// Things only the browser can supply for a tool run, sent along with the
// staff member's approval. The donation receipt PDF is drawn with a canvas-
// rendered Hebrew letterhead (see lib/letterhead.ts), so it can only be
// generated client-side — the widget builds it after approval and the
// server attaches it; recipients/subject/body still come from the approved
// tool input, never from here.
export type ClientToolData = { receiptPdfBase64?: string }

const MAX_RECEIPT_PDF_BASE64 = 7_000_000 // ~5 MB of PDF

export async function executeSensitiveTool(db: Db, name: string, input: Record<string, unknown>, userId: string | null,
  clientData: ClientToolData = {}): Promise<unknown> {
  switch (name) {
    case 'send_email': {
      const to = Array.isArray(input.to) ? input.to.map(String) : []
      const subject = String(input.subject ?? '')
      const body = String(input.body ?? '')
      if (!to.length || !subject || !body) return { error: 'Missing to, subject, or body.' }
      const result = await sendMailViaGoogle(db, { to, subject, body })
      // Best-effort, same as EmailPdfModal — the email already went out.
      await db.from('communications').insert([{
        type: 'email', subject, body, recipients: to.join(', '), sent_from_email: result.fromEmail,
        donor_id: input.donorId ?? null, student_id: input.studentId ?? null,
      }])
      return { ...result, success: true }
    }

    case 'send_donation_receipt': {
      const to = Array.isArray(input.to) ? input.to.map(String).filter(Boolean) : []
      if (!to.length) return { error: 'No recipient given — the donor may not have an email on file.' }
      const pdf = clientData.receiptPdfBase64 ?? ''
      // "JVBER" is base64 for "%PDF" — cheap sanity check that the browser
      // actually sent a PDF and not something else.
      if (!pdf.startsWith('JVBER') || pdf.length > MAX_RECEIPT_PDF_BASE64) return { error: 'The receipt PDF couldn\'t be generated in the browser, so nothing was sent. Try again, or use Email receipt on the donor\'s page.' }
      const { data: donation, error: donationError } = await db.from('donations')
        .select('id,amount,donation_date,donor_id,donors(name)').eq('id', String(input.donationId ?? '')).single()
      if (donationError || !donation) return { error: 'Donation not found.' }
      const donorName = (donation.donors as unknown as { name: string } | null)?.name ?? 'Donor'
      const filename = `donation-receipt-${donorName.replace(/\s+/g, '-').toLowerCase()}-${donation.donation_date}.pdf`
      const subject = String(input.subject || `Donation Receipt — ${donorName}`)
      const body = String(input.body || `Hi,\n\nPlease find attached your receipt for your generous donation of ${money(donation.amount)} on ${new Date(donation.donation_date + 'T00:00:00').toLocaleDateString('en-US')}.\n\nThank you for your support.`)
      const result = await sendMailViaGoogle(db, { to, subject, body, attachments: [{ filename, content: pdf }] })
      // Both best-effort, mirroring EmailPdfModal's receipt send.
      await db.from('communications').insert([{
        type: 'email', subject, body, donor_id: donation.donor_id, recipients: to.join(', '),
        attachment_filename: filename, pdf_base64: pdf, sent_from_email: result.fromEmail,
      }])
      await archiveDonorDocument(db as Parameters<typeof archiveDonorDocument>[0], {
        donorId: donation.donor_id, fileName: filename, base64: pdf,
        notes: `Emailed to ${to.join(', ')} on ${new Date().toLocaleDateString('en-US')}${input.note ? ` — note: ${input.note}` : ''}`,
      })
      return { success: true, sent: result.sent, fromEmail: result.fromEmail, attachment: filename }
    }

    case 'record_donation': {
      const { data, error } = await db.from('donations').insert([{
        donor_id: input.donorId, amount: Number(input.amount ?? 0), donation_method: input.donationMethod ?? null,
        donation_date: input.donationDate ?? null, purpose: input.purpose ?? null, notes: input.notes ?? null,
        category: input.category ?? 'one_time', event_id: input.category === 'event' ? (input.eventId ?? null) : null,
        source: 'manual',
      }]).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'insert', table: 'donations', recordId: data.id,
        beforeData: null, afterData: data, description: `Recorded a ${money(data.amount)} donation (${data.donation_date})`,
      })
      return { success: true, donationId: data.id }
    }

    case 'update_donation': {
      const donationId = String(input.donationId ?? '')
      const { data: before, error: fetchError } = await db.from('donations').select('*').eq('id', donationId).single()
      if (fetchError || !before) return { error: 'Donation not found.' }
      const patch: Record<string, unknown> = {}
      if (input.amount !== undefined) patch.amount = Number(input.amount)
      if (input.donationDate !== undefined) patch.donation_date = input.donationDate
      if (input.donationMethod !== undefined) patch.donation_method = input.donationMethod
      if (input.purpose !== undefined) patch.purpose = input.purpose
      if (input.category !== undefined) {
        patch.category = input.category
        patch.event_id = input.category === 'event' ? (input.eventId ?? before.event_id ?? null) : null
      }
      if (input.notes !== undefined) patch.notes = input.notes
      if (!Object.keys(patch).length) return { error: 'No changes provided.' }
      const { data: after, error } = await db.from('donations').update(patch).eq('id', donationId).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'update', table: 'donations', recordId: donationId,
        beforeData: before, afterData: after, description: `Edited a ${money(before.amount)} donation (${before.donation_date})`,
      })
      return { success: true, donationId }
    }

    case 'delete_donation': {
      const donationId = String(input.donationId ?? '')
      const { data: before, error: fetchError } = await db.from('donations').select('*').eq('id', donationId).single()
      if (fetchError || !before) return { error: 'Donation not found.' }
      const { error } = await db.from('donations').delete().eq('id', donationId)
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'delete', table: 'donations', recordId: donationId,
        beforeData: before, afterData: null,
        description: `Deleted a ${money(before.amount)} donation (${before.donation_date})${input.reason ? ` — ${input.reason}` : ''}`,
      })
      return { success: true, deleted: true }
    }

    case 'add_donor': {
      const { data, error } = await db.from('donors').insert([{
        name: input.name, email: input.email ?? null, address: input.address ?? null,
        phone_number: input.phoneNumber ?? null, category: input.category, relationship: input.relationship,
        title: input.title ?? null,
      }]).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'insert', table: 'donors', recordId: data.id,
        beforeData: null, afterData: data, description: `Added donor ${data.name}`,
      })
      return { success: true, donorId: data.id }
    }

    case 'update_donor': {
      const result = await updateLogged(db, userId, 'donors', String(input.donorId ?? ''),
        pick(input, [['name', 'name'], ['title', 'title'], ['email', 'email'], ['phoneNumber', 'phone_number'],
          ['address', 'address'], ['category', 'category'], ['relationship', 'relationship']]),
        b => `Edited donor ${b.name}`)
      return result.ok ? { success: true, donorId: input.donorId } : { error: result.error }
    }

    case 'record_tuition_payment': {
      const paymentType = String(input.paymentType ?? 'tuition')
      const perPlan = paymentType === 'tuition' || paymentType === 'building_fund'
      if (perPlan && !input.tuitionPlanId) return { error: 'tuitionPlanId is required for tuition and building_fund payments — use get_tuition_status to find it.' }
      const { data, error } = await db.from('tuition_payments').insert([{
        tuition_plan_id: perPlan ? input.tuitionPlanId : null, student_id: input.studentId,
        amount: Number(input.amount ?? 0), payment_date: input.paymentDate ?? null, status: 'paid',
        payment_type: paymentType, payment_method: input.paymentMethod ?? null, notes: input.notes ?? null,
      }]).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'insert', table: 'tuition_payments', recordId: data.id,
        beforeData: null, afterData: data, description: `Recorded a ${money(data.amount)} ${paymentType} payment (${data.payment_date})`,
      })
      return { success: true, tuitionPaymentId: data.id }
    }

    case 'update_tuition_payment': {
      const paymentId = String(input.paymentId ?? '')
      const { data: before, error: fetchError } = await db.from('tuition_payments').select('*').eq('id', paymentId).single()
      if (fetchError || !before) return { error: 'Tuition payment not found.' }
      const patch: Record<string, unknown> = {}
      if (input.amount !== undefined) patch.amount = Number(input.amount)
      if (input.paymentDate !== undefined) patch.payment_date = input.paymentDate
      if (input.paymentType !== undefined) patch.payment_type = input.paymentType
      if (input.paymentMethod !== undefined) patch.payment_method = input.paymentMethod
      if (input.status !== undefined) patch.status = input.status
      if (input.notes !== undefined) patch.notes = input.notes
      if (!Object.keys(patch).length) return { error: 'No changes provided.' }
      const { data: after, error } = await db.from('tuition_payments').update(patch).eq('id', paymentId).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'update', table: 'tuition_payments', recordId: paymentId,
        beforeData: before, afterData: after,
        description: `Edited a ${money(before.amount)} ${before.payment_type} payment (${before.payment_date})`,
      })
      return { success: true, tuitionPaymentId: paymentId }
    }

    case 'delete_tuition_payment': {
      const paymentId = String(input.paymentId ?? '')
      const { data: before, error: fetchError } = await db.from('tuition_payments').select('*').eq('id', paymentId).single()
      if (fetchError || !before) return { error: 'Tuition payment not found.' }
      const { error } = await db.from('tuition_payments').delete().eq('id', paymentId)
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'delete', table: 'tuition_payments', recordId: paymentId,
        beforeData: before, afterData: null,
        description: `Deleted a ${money(before.amount)} ${before.payment_type} payment (${before.payment_date})${input.reason ? ` — ${input.reason}` : ''}`,
      })
      return { success: true, deleted: true }
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
        created_by: userId,
      }]).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'insert', table: 'expenses', recordId: data.id,
        beforeData: null, afterData: data, description: `Logged a ${money(data.amount)} expense — ${data.description} (${data.date})`,
      })
      return { success: true, expenseId: data.id }
    }

    case 'update_expense': {
      const result = await updateLogged(db, userId, 'expenses', String(input.expenseId ?? ''), {
        ...pick(input, [['date', 'date'], ['category', 'category'], ['description', 'description'], ['amount', 'amount', true],
          ['vendor', 'vendor'], ['paymentMethod', 'payment_method'], ['notes', 'notes']]),
        updated_at: new Date().toISOString(),
      }, b => `Edited a ${money(b.amount as number)} expense — ${b.description} (${b.date})`)
      return result.ok ? { success: true, expenseId: input.expenseId } : { error: result.error }
    }

    case 'delete_expense': {
      const result = await deleteLogged(db, userId, 'expenses', String(input.expenseId ?? ''), input.reason,
        b => `Deleted a ${money(b.amount as number)} expense — ${b.description} (${b.date})`)
      return result.ok ? { success: true, deleted: true } : { error: result.error }
    }

    case 'add_pledge': {
      // Single-object insert (not an array) so an omitted pledge_date is left
      // out entirely and gets the column default — in an array insert an
      // undefined key becomes an explicit null and violates NOT NULL.
      const { data, error } = await db.from('pledges').insert({
        donor_id: input.donorId, amount: Number(input.amount ?? 0), pledge_date: input.pledgeDate ?? undefined,
        due_date: input.dueDate ?? null, purpose: input.purpose ?? null, notes: input.notes ?? null,
      }).select('*').single()
      if (error) return { error: error.message }
      await logAction(db, {
        performedBy: userId, actionType: 'insert', table: 'pledges', recordId: data.id,
        beforeData: null, afterData: data, description: `Added a ${money(data.amount)} pledge (${data.pledge_date})`,
      })
      return { success: true, pledgeId: data.id }
    }

    case 'update_pledge': {
      const pledgeId = String(input.pledgeId ?? '')
      const patch = pick(input, [['amount', 'amount', true], ['pledgeDate', 'pledge_date'], ['dueDate', 'due_date'], ['purpose', 'purpose'], ['notes', 'notes']])
      const result = await updateLogged(db, userId, 'pledges', pledgeId,
        Object.keys(patch).length ? { ...patch, updated_at: new Date().toISOString() } : patch,
        b => `Edited a ${money(b.amount as number)} pledge (${b.pledge_date})`)
      if (!result.ok) return { error: result.error }
      await recomputePledgeTotals(db, pledgeId)
      return { success: true, pledgeId }
    }

    case 'delete_pledge': {
      const result = await deleteLogged(db, userId, 'pledges', String(input.pledgeId ?? ''), input.reason,
        b => `Deleted a ${money(b.amount as number)} pledge (${b.pledge_date})`)
      return result.ok ? { success: true, deleted: true } : { error: result.error }
    }

    case 'record_pledge_payment': {
      // Single-object insert for the same omitted-date reason as add_pledge.
      const { data, error } = await db.from('pledge_payments').insert({
        pledge_id: input.pledgeId, amount: Number(input.amount ?? 0), payment_date: input.paymentDate ?? undefined,
        payment_method: input.paymentMethod ?? 'Cash', notes: input.notes ?? null,
      }).select('*').single()
      if (error) return { error: error.message }
      await recomputePledgeTotals(db, data.pledge_id)
      await logAction(db, {
        performedBy: userId, actionType: 'insert', table: 'pledge_payments', recordId: data.id,
        beforeData: null, afterData: data, description: `Recorded a ${money(data.amount)} pledge payment (${data.payment_date})`,
      })
      return { success: true, pledgePaymentId: data.id }
    }

    case 'update_pledge_payment': {
      const result = await updateLogged(db, userId, 'pledge_payments', String(input.pledgePaymentId ?? ''),
        pick(input, [['amount', 'amount', true], ['paymentDate', 'payment_date'], ['paymentMethod', 'payment_method'], ['notes', 'notes']]),
        b => `Edited a ${money(b.amount as number)} pledge payment (${b.payment_date})`)
      if (!result.ok) return { error: result.error }
      await recomputePledgeTotals(db, String(result.before.pledge_id))
      return { success: true, pledgePaymentId: input.pledgePaymentId }
    }

    case 'delete_pledge_payment': {
      const result = await deleteLogged(db, userId, 'pledge_payments', String(input.pledgePaymentId ?? ''), input.reason,
        b => `Deleted a ${money(b.amount as number)} pledge payment (${b.payment_date})`)
      if (!result.ok) return { error: result.error }
      await recomputePledgeTotals(db, String(result.before.pledge_id))
      return { success: true, deleted: true }
    }

    case 'undo_last_change': {
      let query = db.from('assistant_actions').select('*').is('undone_at', null)
      if (input.actionId) query = query.eq('id', String(input.actionId))
      const { data: action, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) return { error: error.message }
      if (!action) return { error: 'Nothing to undo.' }
      const result = await applyUndo(db, action as ActionRow)
      if (!result.ok) return { error: result.error }
      await afterRestore(db, action as ActionRow)
      await db.from('assistant_actions').update({ undone_at: new Date().toISOString() }).eq('id', action.id)
      return { success: true, undone: action.description }
    }

    case 'redo_last_undo': {
      let query = db.from('assistant_actions').select('*').not('undone_at', 'is', null)
      if (input.actionId) query = query.eq('id', String(input.actionId))
      const { data: action, error } = await query.order('undone_at', { ascending: false }).limit(1).maybeSingle()
      if (error) return { error: error.message }
      if (!action) return { error: 'Nothing to redo.' }
      const result = await applyRedo(db, action as ActionRow)
      if (!result.ok) return { error: result.error }
      await afterRestore(db, action as ActionRow)
      await db.from('assistant_actions').update({ undone_at: null }).eq('id', action.id)
      return { success: true, redone: action.description }
    }

    default:
      return { error: `Unknown sensitive tool: ${name}` }
  }
}
