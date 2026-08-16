'use client'

import { formatPhoneNumber } from '@/lib/textFormat'

export default function PhoneInput({
  value, onChange, className, placeholder, required,
}: {
  value: string
  onChange: (v: string) => void
  className: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <input
      type="tel"
      required={required}
      value={value}
      onChange={e => onChange(formatPhoneNumber(e.target.value))}
      placeholder={placeholder}
      className={className}
    />
  )
}
