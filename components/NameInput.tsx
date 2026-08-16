'use client'

import { capitalizeFirstLetter } from '@/lib/textFormat'

export default function NameInput({
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
      type="text"
      required={required}
      value={value}
      onChange={e => onChange(capitalizeFirstLetter(e.target.value))}
      placeholder={placeholder}
      className={className}
    />
  )
}
