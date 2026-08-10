// Shared types for the Sola Payments (Cardknox) integration. Field names on
// the *Input types are our own; the client module maps them onto Sola's
// documented request bodies (docs.solapayments.com/api/recurring).

export type SolaCustomerInput = {
  customerNumber?: string
  email?: string
  billFirstName?: string
  billLastName?: string
  billCompany?: string
}

export type SolaCreateCustomerResult =
  | { ok: true; customerId: string }
  | { ok: false; error: string }

// TokenType is Sola's own enum for what kind of SUT this is. We only ever
// pass a token minted client-side by iFields — raw card/account numbers
// never reach this module.
export type SolaTokenType = 'cc' | 'ach'

export type SolaPaymentMethodInput = {
  customerId: string
  token: string
  tokenType: SolaTokenType
  exp?: string                 // MMYY — card only
  routing?: string              // ACH only
  accountType?: 'checking' | 'savings'  // ACH only
  name?: string
  setAsDefault?: boolean
}

export type SolaCreatePaymentMethodResult =
  | { ok: true; paymentMethodId: string }
  | { ok: false; error: string }

export type SolaChargeInput = {
  paymentMethodId: string
  amount: number
  description?: string
  invoice?: string
}

export type SolaChargeResult =
  | { ok: true; approved: true; refNum: string; raw: unknown }
  | { ok: true; approved: false; error: string; raw: unknown }
  | { ok: false; error: string }

export type SolaScheduleInput = {
  customerId: string
  paymentMethodId: string
  amount: number
  intervalType: 'day' | 'week' | 'month' | 'year'
  intervalCount: number
  totalPayments?: number       // omit = open-ended recurring; set = payment plan/installments
  startDate: string             // YYYY-MM-DD
  scheduleName?: string
  custom01?: string             // used to correlate webhook events back to a CRM record
  daysBetweenRetries?: number
  failedTransactionRetryTimes?: number
}

export type SolaCreateScheduleResult =
  | { ok: true; scheduleId: string }
  | { ok: false; error: string }

export type SolaUpdateScheduleResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Sola Sync (read-only history pull) ──────────────────────────────────────
// These three come from the List*/Get* endpoints under docs.solapayments.com/
// api/recurring, which (unlike the write endpoints above) require the
// X-Recurring-Api-Version header. Confirmed empirically against the live
// account: ListTransactions/GetTransaction never return a dollar Amount —
// only a schedule's Amount is ever exposed, so a transaction's amount has to
// be inferred from its parent schedule.

export type SolaCustomer = {
  customerId: string
  customerNumber?: string
  billFirstName?: string
  billLastName?: string
  email?: string
}

export type SolaSchedule = {
  scheduleId: string
  customerId: string
  description?: string
  amount?: number
  intervalType?: string
  intervalCount?: number
  totalPayments?: number
  paymentsProcessed?: number
  nextScheduledRunTime?: string
}

export type SolaTransaction = {
  transactionId: string
  scheduleId?: string
  customerId: string
  transactionDate: string
  gatewayStatus?: string
}

// Full contact detail for one customer — GetCustomer returns more than
// ListCustomers does (confirmed empirically: address fields only ever show
// up here, never in the list response). There is no phone field on Sola
// customers at all, at any endpoint.
export type SolaCustomerDetail = {
  customerId: string
  billFirstName?: string
  billLastName?: string
  email?: string
  billStreet?: string
  billCity?: string
  billState?: string
  billZip?: string
}
