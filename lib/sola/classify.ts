import type { SolaSchedule } from './types'

export function normalizeName(s: string | null | undefined) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}
export function normalizeEmail(s: string | null | undefined) {
  return (s || '').trim().toLowerCase()
}

export function suggestFeeType(amount: number | null): 'tuition' | 'building_fund' | 'registration_fee' | null {
  if (amount == null) return null
  if (amount === 250) return 'registration_fee'
  if (amount === 750) return 'building_fund'
  return 'tuition'
}

// Real schedule descriptions in this account already say things like
// "Tuition 24-25", "Tuition ", "Donation", "Donation x6", "Parlor Meeting
// 2024" — keyword matching on the schedule's own Description is a cheap,
// evidence-backed way to tell a tuition-shaped charge from a donation-shaped
// one, with anything that matches neither (or has no schedule at all,
// e.g. a description-less one-off) left 'ambiguous' for a human to decide.
export const TUITION_KEYWORDS = /tuition|registration|building\s*fund|bldg\s*fund/i
export const DONATION_KEYWORDS = /donation|parlor|dinner|gala|journal|campaign|gift|pledge|fundraiser|fundraising|event|appeal/i
export const EVENT_KEYWORDS = /parlor|dinner|gala|journal/i

export type ChargeClassification = {
  chargeKind: 'tuition' | 'donation' | 'ambiguous'
  suggestedFeeType: 'tuition' | 'building_fund' | 'registration_fee' | null
  suggestedDonationCategory: 'monthly_recurring' | 'one_time' | 'event' | null
}

export function classifyCharge(schedule: SolaSchedule | undefined, amount: number | null): ChargeClassification {
  const desc = schedule?.description ?? ''
  const isTuition = TUITION_KEYWORDS.test(desc)
  const isDonation = DONATION_KEYWORDS.test(desc)

  if (isTuition && !isDonation) {
    return { chargeKind: 'tuition', suggestedFeeType: suggestFeeType(amount), suggestedDonationCategory: null }
  }
  if (isDonation && !isTuition) {
    let category: 'monthly_recurring' | 'one_time' | 'event' = 'one_time'
    if (EVENT_KEYWORDS.test(desc)) category = 'event'
    else if (schedule?.intervalType && (schedule.totalPayments == null || schedule.totalPayments > 1)) category = 'monthly_recurring'
    return { chargeKind: 'donation', suggestedFeeType: null, suggestedDonationCategory: category }
  }
  return { chargeKind: 'ambiguous', suggestedFeeType: null, suggestedDonationCategory: null }
}
