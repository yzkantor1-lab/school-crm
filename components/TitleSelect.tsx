'use client'

import { useState } from 'react'

const TITLE_PRESETS = ['Rabbi & Mrs.', 'Mr. & Mrs.', 'Dr. & Mrs.', 'Mr. & Dr.', 'Rabbi', 'Dr.', 'Mr.', 'Mrs.', 'Ms.']

export default function TitleSelect({
  value, onChange, className,
}: {
  value: string
  onChange: (v: string) => void
  className: string
}) {
  // Starts in custom mode if the stored value is already something outside
  // the preset list (e.g. a legacy free-typed title) — shown as editable
  // text immediately rather than silently discarded/blanked.
  const [customMode, setCustomMode] = useState(() => !!value && !TITLE_PRESETS.includes(value))

  return (
    <div className="space-y-1.5">
      <select
        value={customMode ? '__other__' : value || ''}
        onChange={e => {
          if (e.target.value === '__other__') { setCustomMode(true); onChange(''); return }
          setCustomMode(false)
          onChange(e.target.value)
        }}
        className={className}
      >
        <option value="">— Select —</option>
        {TITLE_PRESETS.map(t => <option key={t} value={t}>{t}</option>)}
        <option value="__other__">Other (type your own)</option>
      </select>
      {customMode && (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Custom title"
          className={className}
        />
      )}
    </div>
  )
}
