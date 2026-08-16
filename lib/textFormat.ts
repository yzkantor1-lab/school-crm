// US-style phone formatting, applied live as digits are typed — matches how
// every phone number elsewhere in this app is already written
// ("(555) 123-4567"), so a number typed/pasted without punctuation comes out
// consistent without staff needing to remember to add it themselves.
export function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// Only the first character — deliberately not a full title-case pass, which
// would mangle real names with lowercase particles ("van der berg", "de la
// Cruz"). Fixes the common case (a name typed all-lowercase in a hurry)
// without guessing at the rest of the string.
export function capitalizeFirstLetter(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
