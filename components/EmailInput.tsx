'use client'

import { useState } from 'react'

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'aol.com', 'outlook.com', 'icloud.com', 'msn.com']

export default function EmailInput({
  value, onChange, className, placeholder, required,
}: {
  value: string
  onChange: (v: string) => void
  className: string
  placeholder?: string
  required?: boolean
}) {
  const [focused, setFocused] = useState(false)

  const atIndex = value.indexOf('@')
  const localPart = atIndex === -1 ? '' : value.slice(0, atIndex)
  const domainPart = atIndex === -1 ? '' : value.slice(atIndex + 1).toLowerCase()
  const suggestions = atIndex === -1 ? [] : EMAIL_DOMAINS.filter(d => d.startsWith(domainPart) && d !== domainPart)

  return (
    <div className="relative">
      <input
        type="email"
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className={className}
      />
      {focused && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map(domain => (
            <li key={domain}>
              <button
                type="button"
                // onMouseDown fires before the input's onBlur, so the click
                // registers before the dropdown closes and disappears.
                onMouseDown={e => { e.preventDefault(); onChange(`${localPart}@${domain}`) }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700"
              >
                {localPart}@<span className="font-medium">{domain}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
