import { createAdminClient } from '@/lib/supabase/admin'
import type {
  SolaCustomerInput, SolaCreateCustomerResult,
  SolaPaymentMethodInput, SolaCreatePaymentMethodResult,
  SolaChargeInput, SolaChargeResult,
  SolaScheduleInput, SolaCreateScheduleResult, SolaUpdateScheduleResult,
  SolaCustomer, SolaSchedule, SolaTransaction, SolaCustomerDetail,
} from './types'

// Sola's newer customer/recurring-centric REST API (as opposed to the older
// xCommand-based gatewayjson API, which we don't use here). Server-only —
// SOLA_API_KEY must never reach the browser.
const V2_BASE = 'https://api.cardknox.com/v2'
const SOFTWARE_NAME = 'SchoolCRM'
const SOFTWARE_VERSION = '1.0'

// Previously believed to be required only on List*/Get* endpoints (see
// solaListRequest below) — a live "Missing: X-Recurring-Api-Version header"
// error on /CreateCustomer proved that assumption wrong. Sola's v2 API
// requires this on every call, so it's sent uniformly now.
const RECURRING_API_VERSION = '2.1'

function apiKey(): string {
  const key = process.env.SOLA_API_KEY
  if (!key) throw new Error('SOLA_API_KEY is not configured — add it in Settings > Payment Settings.')
  return key
}

// Loose shape covering every field we read across the different Sola
// endpoints — the actual response only ever populates a subset of these.
type SolaApiResponse = {
  Result?: string
  Error?: string
  CustomerId?: string
  PaymentMethodId?: string
  ScheduleId?: string
  GatewayStatus?: string
  GatewayRefnum?: string
  GatewayErrorMessage?: string
}

async function solaRequest(endpoint: string, body: Record<string, unknown>): Promise<SolaApiResponse> {
  const res = await fetch(`${V2_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey(), 'X-Recurring-Api-Version': RECURRING_API_VERSION },
    body: JSON.stringify({ SoftwareName: SOFTWARE_NAME, SoftwareVersion: SOFTWARE_VERSION, ...body }),
  })
  return (await res.json()) as SolaApiResponse
}

// Reads payment_settings (provider='sola', key_name='test_mode') via the
// service-role admin client. Defaults to true (test) if never set, so the
// integration ships safe-by-default. Only gates money-moving calls
// (processTransaction/createSchedule) — customer/payment-method creation
// always hits the real Sola account, since it can't move money.
export async function isTestMode(): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('payment_settings')
    .select('key_value')
    .eq('provider', 'sola')
    .eq('key_name', 'test_mode')
    .maybeSingle()
  return data?.key_value !== 'false'
}

export async function createCustomer(input: SolaCustomerInput): Promise<SolaCreateCustomerResult> {
  const json = await solaRequest('/CreateCustomer', {
    CustomerNumber: input.customerNumber,
    Email: input.email,
    BillFirstName: input.billFirstName,
    BillLastName: input.billLastName,
    BillCompany: input.billCompany,
  })
  if (json.Result === 'S' && json.CustomerId) return { ok: true, customerId: json.CustomerId }
  return { ok: false, error: json.Error || 'Failed to create Sola customer' }
}

export async function createPaymentMethod(input: SolaPaymentMethodInput): Promise<SolaCreatePaymentMethodResult> {
  const json = await solaRequest('/CreatePaymentMethod', {
    CustomerId: input.customerId,
    Token: input.token,
    // NOTE: 'cc' is confirmed by Sola's docs example; 'check' for ACH follows
    // Cardknox's cc:sale/check:sale naming convention but isn't confirmed by
    // a documented example — verify with Sola support before enabling live
    // mode if the first real ACH save fails.
    TokenType: input.tokenType === 'ach' ? 'check' : 'cc',
    Exp: input.exp,
    Routing: input.routing,
    AccountType: input.accountType,
    Name: input.name,
    SetAsDefault: input.setAsDefault ?? false,
  })
  if (json.Result === 'S' && json.PaymentMethodId) return { ok: true, paymentMethodId: json.PaymentMethodId }
  return { ok: false, error: json.Error || 'Failed to save payment method' }
}

export async function processTransaction(
  input: SolaChargeInput,
  opts: { simulate?: 'approved' | 'declined' } = {}
): Promise<SolaChargeResult> {
  if (await isTestMode()) {
    const approved = opts.simulate !== 'declined'
    return approved
      ? { ok: true, approved: true, refNum: `TEST-${Date.now()}`, raw: { simulated: true, testMode: true } }
      : { ok: true, approved: false, error: 'Simulated decline (test mode)', raw: { simulated: true, testMode: true } }
  }

  const json = await solaRequest('/ProcessTransaction', {
    PaymentMethodId: input.paymentMethodId,
    Amount: input.amount,
    Description: input.description,
    Invoice: input.invoice,
  })
  if (json.Result === 'S' && json.GatewayStatus === 'Approved') {
    return { ok: true, approved: true, refNum: json.GatewayRefnum ?? '', raw: json }
  }
  if (json.Result === 'S') {
    return { ok: true, approved: false, error: json.GatewayErrorMessage || json.GatewayStatus || 'Declined', raw: json }
  }
  return { ok: false, error: json.Error || 'Failed to process transaction' }
}

export async function createSchedule(input: SolaScheduleInput): Promise<SolaCreateScheduleResult> {
  if (await isTestMode()) {
    return { ok: true, scheduleId: `TEST-SCHED-${Date.now()}` }
  }

  const json = await solaRequest('/CreateSchedule', {
    CustomerId: input.customerId,
    PaymentMethodId: input.paymentMethodId,
    Amount: input.amount,
    IntervalType: input.intervalType,
    IntervalCount: input.intervalCount,
    TotalPayments: input.totalPayments,
    StartDate: input.startDate,
    ScheduleName: input.scheduleName,
    Custom02: input.custom02,
    DaysBetweenRetries: input.daysBetweenRetries,
    FailedTransactionRetryTimes: input.failedTransactionRetryTimes,
  })
  if (json.Result === 'S' && json.ScheduleId) return { ok: true, scheduleId: json.ScheduleId }
  return { ok: false, error: json.Error || 'Failed to create schedule' }
}

// UpdateSchedule is a full-replace API — per docs.solapayments.com/api/recurring,
// "any fields that are not set will use the default values (or if no default
// is indicated, they will be removed)." Revision, StartDate, and
// CalendarCulture in particular have no usable default and are rejected as
// "Missing"/"Invalid" if omitted, even though the docs list them as optional.
// So cancelling has to round-trip the schedule's own current field values
// (fetched fresh, since Revision is optimistic-concurrency-checked) rather
// than just sending ScheduleId + EndDate.
type SolaRawSchedule = {
  ScheduleId: string
  Revision: number
  StartDate: string
  CalendarCulture: string
  Amount: number
  IntervalType: string
  IntervalCount: number
  TotalPayments?: number
  PaymentMethodId?: string
  FailedTransactionRetryTimes?: number
  DaysBetweenRetries?: number
  Custom02?: string
}

// Exported so callers that need to read a live schedule's own fields (e.g.
// the Sola Sync "promote to recurring" route, which builds a local
// payment_schedules row from them) don't have to duplicate this pagination.
export async function getScheduleRaw(scheduleId: string): Promise<SolaRawSchedule | null> {
  type Raw = SolaListResponse & { Schedules?: SolaRawSchedule[] }
  let nextToken = ''
  do {
    const json = await solaListRequest<Raw>('/ListSchedules', { NextToken: nextToken })
    if (json.Result !== 'S') throw new Error(json.Error || 'Failed to list Sola schedules')
    const match = (json.Schedules ?? []).find(s => s.ScheduleId === scheduleId)
    if (match) return match
    nextToken = json.NextToken ?? ''
  } while (nextToken)
  return null
}

// Shared by cancelSchedule/tagScheduleCustom02 below: fetches the schedule's
// current field values and resends them alongside whatever's overridden, so
// a single-purpose update (stop it / tag it) can't accidentally blank out
// every other field via UpdateSchedule's full-replace semantics.
async function replaceSchedule(scheduleId: string, overrides: Record<string, unknown>): Promise<SolaUpdateScheduleResult> {
  const current = await getScheduleRaw(scheduleId)
  if (!current) return { ok: false, error: 'Schedule not found in Sola' }

  const json = await solaRequest('/UpdateSchedule', {
    ScheduleId: scheduleId,
    Revision: current.Revision,
    StartDate: current.StartDate,
    CalendarCulture: current.CalendarCulture,
    Amount: current.Amount,
    IntervalType: current.IntervalType,
    IntervalCount: current.IntervalCount,
    TotalPayments: current.TotalPayments,
    PaymentMethodId: current.PaymentMethodId,
    FailedTransactionRetryTimes: current.FailedTransactionRetryTimes,
    DaysBetweenRetries: current.DaysBetweenRetries,
    Custom02: current.Custom02,
    ...overrides,
  })
  if (json.Result === 'S') return { ok: true }
  return { ok: false, error: json.Error || 'Failed to update schedule' }
}

// Stops future occurrences of a schedule. Not gated by test mode itself —
// callers only ever cancel schedules that exist (either a real one from live
// mode, or one that was never actually created in Sola because it was
// simulated — see the schedule cancellation route for that distinction).
export async function cancelSchedule(scheduleId: string): Promise<SolaUpdateScheduleResult> {
  // EndDate must be strictly in the future ("xExpireDate must be in the
  // future") — today is rejected even for a schedule that already ran today,
  // so tomorrow is the earliest valid stop point. Today's already-processed
  // charge (if any) is unaffected either way.
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return replaceSchedule(scheduleId, { EndDate: tomorrow.toISOString().slice(0, 10) })
}

// Stamps Custom02 onto a Sola-native schedule — one created directly in
// Sola's own dashboard, outside the CRM, so it never got the {type,id,purpose}
// tag CreateSchedule attaches (app/api/sola/schedule/route.ts). Lets a
// schedule staff link after the fact via Sola Sync still get real-time
// webhook attribution for future charges. See promote-schedule/route.ts.
export async function tagScheduleCustom02(scheduleId: string, custom02: string): Promise<SolaUpdateScheduleResult> {
  return replaceSchedule(scheduleId, { Custom02: custom02 })
}

// ── Sola Sync (read-only history pull) ──────────────────────────────────────
const LIST_PAGE_SIZE = 500

type SolaListResponse = { Result?: string; Error?: string; NextToken?: string }

async function solaListRequest<T extends SolaListResponse>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${V2_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey(),
      'X-Recurring-Api-Version': RECURRING_API_VERSION,
    },
    body: JSON.stringify({ SoftwareName: SOFTWARE_NAME, SoftwareVersion: SOFTWARE_VERSION, PageSize: LIST_PAGE_SIZE, ...body }),
  })
  return (await res.json()) as T
}

// Fetches every page. Safe at this account's scale (tens to low hundreds of
// records) — would need a real pagination story in the API/UI if the Sola
// account ever grows past a few thousand customers/schedules/transactions.
export async function listAllCustomers(): Promise<SolaCustomer[]> {
  type Raw = SolaListResponse & { Customers?: Array<{ CustomerId: string; CustomerNumber?: string; BillFirstName?: string; BillLastName?: string; Email?: string }> }
  const all: SolaCustomer[] = []
  let nextToken = ''
  do {
    const json = await solaListRequest<Raw>('/ListCustomers', { NextToken: nextToken })
    if (json.Result !== 'S') throw new Error(json.Error || 'Failed to list Sola customers')
    for (const c of json.Customers ?? []) {
      all.push({ customerId: c.CustomerId, customerNumber: c.CustomerNumber, billFirstName: c.BillFirstName, billLastName: c.BillLastName, email: c.Email })
    }
    nextToken = json.NextToken ?? ''
  } while (nextToken)
  return all
}

export async function listAllSchedules(): Promise<SolaSchedule[]> {
  type Raw = SolaListResponse & {
    Schedules?: Array<{
      ScheduleId: string; CustomerId: string; Description?: string; Amount?: number
      IntervalType?: string; IntervalCount?: number; TotalPayments?: number
      PaymentsProcessed?: number; LastProjectedPaymentDate?: string
    }>
  }
  const all: SolaSchedule[] = []
  let nextToken = ''
  do {
    const json = await solaListRequest<Raw>('/ListSchedules', { NextToken: nextToken })
    if (json.Result !== 'S') throw new Error(json.Error || 'Failed to list Sola schedules')
    for (const s of json.Schedules ?? []) {
      all.push({
        scheduleId: s.ScheduleId, customerId: s.CustomerId, description: s.Description, amount: s.Amount,
        intervalType: s.IntervalType, intervalCount: s.IntervalCount, totalPayments: s.TotalPayments,
        paymentsProcessed: s.PaymentsProcessed, nextScheduledRunTime: s.LastProjectedPaymentDate,
      })
    }
    nextToken = json.NextToken ?? ''
  } while (nextToken)
  return all
}

// Card expiration (Exp) is sent to Sola at CreatePaymentMethod time but was
// never stored locally — this is the only source of truth for it, including
// for cards saved before that mattered. Returns every saved payment method
// account-wide; callers match by paymentMethodId against payment_methods.
export async function listAllPaymentMethods(): Promise<{ paymentMethodId: string; exp?: string; tokenType?: string }[]> {
  type Raw = SolaListResponse & {
    PaymentMethods?: Array<{ PaymentMethodId: string; TokenType?: string; Exp?: string }>
  }
  const all: { paymentMethodId: string; exp?: string; tokenType?: string }[] = []
  let nextToken = ''
  do {
    const json = await solaListRequest<Raw>('/ListPaymentMethods', { NextToken: nextToken })
    if (json.Result !== 'S') throw new Error(json.Error || 'Failed to list Sola payment methods')
    for (const p of json.PaymentMethods ?? []) {
      all.push({ paymentMethodId: p.PaymentMethodId, exp: p.Exp, tokenType: p.TokenType })
    }
    nextToken = json.NextToken ?? ''
  } while (nextToken)
  return all
}

// Fetches full contact detail for one customer — used only at the moment a
// staff member actually creates a new donor from a Sola customer, not during
// the bulk sync (ListCustomers is enough for matching; this is the one place
// address fields are ever populated).
export async function getCustomerDetail(customerId: string): Promise<SolaCustomerDetail | null> {
  type Raw = SolaListResponse & {
    CustomerId?: string; BillFirstName?: string; BillLastName?: string; Email?: string
    BillStreet?: string; BillCity?: string; BillState?: string; BillZip?: string
  }
  const json = await solaListRequest<Raw>('/GetCustomer', { CustomerId: customerId })
  if (json.Result !== 'S' || !json.CustomerId) return null
  return {
    customerId: json.CustomerId, billFirstName: json.BillFirstName, billLastName: json.BillLastName,
    email: json.Email, billStreet: json.BillStreet, billCity: json.BillCity, billState: json.BillState, billZip: json.BillZip,
  }
}

// Only returns transactions tied to a recurring schedule — Sola's own docs
// describe this endpoint as excluding standalone/one-off transactions, and
// there's no separate "all transactions" endpoint. One-off charges made
// directly in Sola's portal won't appear here; the sync UI flags this as a
// known gap rather than silently claiming complete history.
export async function listAllTransactions(): Promise<SolaTransaction[]> {
  type Raw = SolaListResponse & {
    Transactions?: Array<{ TransactionId: string; ScheduleId?: string; CustomerId: string; TransactionDate: string; GatewayStatus?: string }>
  }
  const all: SolaTransaction[] = []
  let nextToken = ''
  do {
    const json = await solaListRequest<Raw>('/ListTransactions', { NextToken: nextToken })
    if (json.Result !== 'S') throw new Error(json.Error || 'Failed to list Sola transactions')
    for (const t of json.Transactions ?? []) {
      all.push({ transactionId: t.TransactionId, scheduleId: t.ScheduleId, customerId: t.CustomerId, transactionDate: t.TransactionDate, gatewayStatus: t.GatewayStatus })
    }
    nextToken = json.NextToken ?? ''
  } while (nextToken)
  return all
}
