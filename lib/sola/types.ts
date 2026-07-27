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
