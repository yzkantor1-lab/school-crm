import { createClient } from '@/lib/supabase/server'
import { createCustomer, createPaymentMethod } from './client'
import type { SolaTokenType } from './types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type OwnerType = 'student' | 'donor'

export type NewPaymentMethodInput = {
  tokenType: SolaTokenType
  token: string
  label: string
  exp?: string
  routing?: string
  accountType?: 'checking' | 'savings'
  name?: string
}

// Shared by the charge and schedule routes: looks up the student/donor,
// syncing a Sola customer profile on the fly if one doesn't exist yet
// (fallback for records that predate this feature or whose earlier sync
// attempt failed silently).
export async function resolveSolaCustomer(supabase: SupabaseServerClient, type: OwnerType, id: string) {
  const table = type === 'student' ? 'students' : 'donors'
  const { data: owner, error } = await supabase.from(table).select('*').eq('id', id).single()
  if (error || !owner) return { ok: false as const, error: error?.message || 'Record not found' }

  let solaCustomerId: string = owner.sola_customer_id
  if (!solaCustomerId) {
    const result = await createCustomer(
      type === 'student'
        ? { customerNumber: owner.id, email: owner.father_email || owner.mother_email || undefined, billFirstName: owner.first_name, billLastName: owner.last_name }
        : { customerNumber: owner.id, email: owner.email || undefined, billCompany: owner.name }
    )
    if (!result.ok) return { ok: false as const, error: `Could not create Sola customer: ${result.error}` }
    solaCustomerId = result.customerId
    await supabase.from(table).update({ sola_customer_id: solaCustomerId }).eq('id', id)
  }

  return { ok: true as const, owner, solaCustomerId, table }
}

// Resolves an existing saved payment_methods row, or tokenizes+saves a new
// one, to a Sola PaymentMethodId ready to charge/schedule against.
export async function resolvePaymentMethod(
  supabase: SupabaseServerClient,
  opts: {
    type: OwnerType
    id: string
    solaCustomerId: string
    paymentMethodId?: string
    newPaymentMethod?: NewPaymentMethodInput
    save?: boolean
  }
) {
  if (opts.paymentMethodId) {
    const { data: pm, error } = await supabase
      .from('payment_methods').select('sola_payment_method_id,method_type').eq('id', opts.paymentMethodId).single()
    if (error || !pm) return { ok: false as const, error: 'Saved payment method not found.' }
    return {
      ok: true as const,
      solaPaymentMethodId: pm.sola_payment_method_id as string,
      localPaymentMethodId: opts.paymentMethodId,
      methodType: pm.method_type as 'card' | 'ach',
    }
  }

  const npm = opts.newPaymentMethod
  if (!npm) return { ok: false as const, error: 'paymentMethodId or newPaymentMethod is required.' }

  const created = await createPaymentMethod({
    customerId: opts.solaCustomerId,
    token: npm.token,
    tokenType: npm.tokenType,
    exp: npm.exp,
    routing: npm.routing,
    accountType: npm.accountType,
    name: npm.name,
  })
  if (!created.ok) return { ok: false as const, error: `Could not save payment method: ${created.error}` }

  const methodType: 'card' | 'ach' = npm.tokenType === 'ach' ? 'ach' : 'card'
  let localPaymentMethodId: string | null = null
  if (opts.save) {
    const { data: savedRow, error: saveError } = await supabase
      .from('payment_methods')
      .insert([{
        student_id: opts.type === 'student' ? opts.id : null,
        donor_id: opts.type === 'donor' ? opts.id : null,
        sola_payment_method_id: created.paymentMethodId,
        method_type: methodType,
        label: npm.label,
      }])
      .select('id')
      .single()
    if (!saveError && savedRow) localPaymentMethodId = savedRow.id
  }

  return { ok: true as const, solaPaymentMethodId: created.paymentMethodId, localPaymentMethodId, methodType }
}

export function methodLabel(methodType: 'card' | 'ach') {
  return methodType === 'ach' ? 'bank_transfer' : 'credit_card'
}
