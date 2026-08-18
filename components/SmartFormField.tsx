'use client'

import PhoneInput from './PhoneInput'
import NameInput from './NameInput'
import TitleSelect from './TitleSelect'
import EmailInput from './EmailInput'

// Every phone/name/title/email field across Students, Donors, Staff, and
// Guardians follows a consistent naming convention (confirmed across the
// whole app): phone fields always contain "cell" or "phone"
// (father_cell, home_phone, phone_primary...), name fields always contain
// "name" (first_name, grandfather_name, stepmother_last_name...), title
// fields always contain "title" (parents_title, inlaw_parents_title), and
// email fields always contain "email" (father_email, spouse_email...).
// That lets one dispatcher drive every field array/map in every form
// without restructuring them — just swap the rendered <input> for this
// component.
function fieldKind(key: string): 'name' | 'phone' | 'title' | 'email' | 'text' {
  const k = key.toLowerCase()
  if (k.includes('title')) return 'title'
  if (k.includes('cell') || k.includes('phone')) return 'phone'
  if (k.includes('email')) return 'email'
  if (k.includes('name')) return 'name'
  return 'text'
}

export default function SmartFormField({
  fieldKey, type, value, onChange, className, required, placeholder,
}: {
  fieldKey: string
  type?: string
  value: string
  onChange: (v: string) => void
  className: string
  required?: boolean
  placeholder?: string
}) {
  const kind = fieldKind(fieldKey)
  if (kind === 'phone') return <PhoneInput value={value} onChange={onChange} className={className} required={required} placeholder={placeholder} />
  if (kind === 'name') return <NameInput value={value} onChange={onChange} className={className} required={required} placeholder={placeholder} />
  if (kind === 'title') return <TitleSelect value={value} onChange={onChange} className={className} />
  if (kind === 'email') return <EmailInput value={value} onChange={onChange} className={className} required={required} placeholder={placeholder} />
  return (
    <input
      type={type || 'text'}
      required={required}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  )
}
