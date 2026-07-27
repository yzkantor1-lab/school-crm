import { createAdminClient } from '@/lib/supabase/admin'
import type {
  SolaCustomerInput, SolaCreateCustomerResult,
  SolaPaymentMethodInput, SolaCreatePaymentMethodResult,
  SolaChargeInput, SolaChargeResult,
  SolaScheduleInput, SolaCreateScheduleResult, SolaUpdateScheduleResult,
} from './types'

// Sola's newer customer/recurring-centric REST API (as opposed to the older
// xCommand-based gatewayjson API, which we don't use here). Server-only —
// SOLA_API_KEY must never reach the browser.
const V2_BASE = 'https://api.cardknox.com/v2'
const SOFTWARE_NAME = 'SchoolCRM'
const SOFTWARE_VERSION = '1.0'

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
    headers: { 'Content-Type': 'application/json', Authorization: apiKey() },
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
    Custom01: input.custom01,
    DaysBetweenRetries: input.daysBetweenRetries,
    FailedTransactionRetryTimes: input.failedTransactionRetryTimes,
  })
  if (json.Result === 'S' && json.ScheduleId) return { ok: true, scheduleId: json.ScheduleId }
  return { ok: false, error: json.Error || 'Failed to create schedule' }
}

// Stops future occurrences of a schedule. Not gated by test mode itself —
// callers only ever cancel schedules that exist (either a real one from live
// mode, or one that was never actually created in Sola because it was
// simulated — see the schedule cancellation route for that distinction).
export async function cancelSchedule(scheduleId: string): Promise<SolaUpdateScheduleResult> {
  const json = await solaRequest('/UpdateSchedule', {
    ScheduleId: scheduleId,
    EndDate: new Date().toISOString().slice(0, 10),
  })
  if (json.Result === 'S') return { ok: true }
  return { ok: false, error: json.Error || 'Failed to cancel schedule' }
}
