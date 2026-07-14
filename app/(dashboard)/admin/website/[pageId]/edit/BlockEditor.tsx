'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { savePage, deletePage } from './actions'
import type { BlockContent, CardItem } from '@/components/website/BlockRenderer'
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, ExternalLink,
  Save, Eye, EyeOff, GripVertical, Loader2, X
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

type BlockType =
  | 'hero' | 'heading' | 'paragraph' | 'image'
  | 'button' | 'divider' | 'card_grid' | 'announcement' | 'two_column'

interface Block {
  id: string
  type: BlockType
  content: BlockContent
  order_index: number
}

interface Page {
  id: string
  title: string
  slug: string
  published: boolean
  is_homepage: boolean
  meta_description: string
  show_in_nav: boolean
  nav_order: number
}

// ── Block catalogue ────────────────────────────────────────────────────────────

const BLOCK_TYPES: { type: BlockType; label: string; description: string; emoji: string }[] = [
  { type: 'hero', label: 'Hero Banner', description: 'Big headline + background', emoji: '🦸' },
  { type: 'heading', label: 'Heading', description: 'Section title (H2 / H3)', emoji: '🔤' },
  { type: 'paragraph', label: 'Text', description: 'Body paragraph', emoji: '¶' },
  { type: 'image', label: 'Image', description: 'Photo or graphic', emoji: '🖼️' },
  { type: 'button', label: 'Button', description: 'Call-to-action link', emoji: '🔘' },
  { type: 'card_grid', label: 'Card Grid', description: '2–4 info cards', emoji: '⊞' },
  { type: 'announcement', label: 'Announcement', description: 'Colored callout box', emoji: '📢' },
  { type: 'two_column', label: 'Two Columns', description: 'Side-by-side text', emoji: '⊟' },
  { type: 'divider', label: 'Divider', description: 'Visual separator / space', emoji: '—' },
]

function defaultContent(type: BlockType): BlockContent {
  switch (type) {
    case 'hero': return { headline: 'Welcome', subheadline: '', buttonLabel: '', buttonLink: '', bgColor: '#1e3a5f', textColor: '#ffffff', imageUrl: '' }
    case 'heading': return { text: 'Section Heading', level: 2, align: 'left', color: '#1e293b' }
    case 'paragraph': return { text: 'Enter your text here.', align: 'left', color: '#475569' }
    case 'image': return { src: '', alt: '', caption: '', width: 'contained', rounded: true }
    case 'button': return { label: 'Learn More', href: '/', style: 'primary', align: 'center' }
    case 'divider': return { style: 'line', color: '#e2e8f0' }
    case 'card_grid': return { columns: 3, cards: [{ title: 'Card Title', description: 'Description here.', image: '', link: '', linkLabel: '' }] }
    case 'announcement': return { text: 'Important message here.', bgColor: '#dbeafe', textColor: '#1e40af' }
    case 'two_column': return { leftText: 'Left column text goes here.', rightText: 'Right column text goes here.' }
  }
}

function blockLabel(type: BlockType) {
  return BLOCK_TYPES.find(b => b.type === type)?.label ?? type
}

function blockPreview(block: Block): string {
  const c = block.content
  switch (block.type) {
    case 'hero': return c.headline || 'Hero'
    case 'heading': return c.text || 'Heading'
    case 'paragraph': return (c.text || '').slice(0, 60)
    case 'image': return c.src ? 'Image: ' + c.src.slice(0, 40) : 'No image set'
    case 'button': return c.label || 'Button'
    case 'divider': return c.style || 'Divider'
    case 'card_grid': return `${c.cards?.length ?? 0} card(s)`
    case 'announcement': return (c.text || '').slice(0, 60)
    case 'two_column': return 'Two columns'
    default: return ''
  }
}

// ── Main editor ────────────────────────────────────────────────────────────────

export default function BlockEditor({ page: initialPage, initialBlocks }: { page: Page; initialBlocks: Block[] }) {
  const router = useRouter()
  const [page, setPage] = useState(initialPage)
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [selectedId, setSelectedId] = useState<string | null>(initialBlocks[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [insertAfterIdx, setInsertAfterIdx] = useState<number | null>(null)

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null

  // ── Block mutations ─────────────────────────────────────────────────────────

  const addBlock = useCallback((type: BlockType) => {
    const newBlock: Block = {
      id: crypto.randomUUID(),
      type,
      content: defaultContent(type),
      order_index: 0,
    }
    setBlocks(prev => {
      const idx = insertAfterIdx ?? prev.length - 1
      const next = [...prev]
      next.splice(idx + 1, 0, newBlock)
      return next
    })
    setSelectedId(newBlock.id)
    setShowAddModal(false)
    setInsertAfterIdx(null)
  }, [insertAfterIdx])

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => {
      const next = prev.filter(b => b.id !== id)
      if (selectedId === id) setSelectedId(next[0]?.id ?? null)
      return next
    })
  }, [selectedId])

  const moveBlock = useCallback((id: string, dir: 'up' | 'down') => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const next = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }, [])

  const updateBlockContent = useCallback((id: string, patch: Partial<BlockContent>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, content: { ...b.content, ...patch } } : b))
    setSavedAt(null)
  }, [])

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    await savePage(
      page.id,
      {
        title: page.title,
        published: page.published,
        meta_description: page.meta_description,
        show_in_nav: page.show_in_nav,
        nav_order: page.nav_order,
      },
      blocks
    )
    setSaving(false)
    setSavedAt(new Date().toLocaleTimeString())
  }

  async function handleDelete() {
    if (!confirm('Delete this page? This cannot be undone.')) return
    await deletePage(page.id)
    router.push('/admin/website')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen -m-8">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin/website" className="text-slate-500 hover:text-slate-700 shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <input
            value={page.title}
            onChange={e => { setPage(p => ({ ...p, title: e.target.value })); setSavedAt(null) }}
            className="font-semibold text-slate-900 border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 text-base min-w-0 w-48"
          />
          <a
            href={page.is_homepage ? '/' : `/${page.slug}`}
            target="_blank" rel="noreferrer"
            className="text-slate-400 hover:text-slate-600 shrink-0"
          >
            <ExternalLink size={14} />
          </a>
        </div>

        <div className="flex items-center gap-3">
          {savedAt && <span className="text-xs text-slate-400">Saved at {savedAt}</span>}

          <button
            onClick={() => { setPage(p => ({ ...p, published: !p.published })); setSavedAt(null) }}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
              page.published
                ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                : 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {page.published ? <Eye size={13} /> : <EyeOff size={13} />}
            {page.published ? 'Published' : 'Draft'}
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>

      {/* Body: block list + edit panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: block list */}
        <div className="w-72 bg-slate-50 border-r border-slate-200 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Blocks</span>
            <button
              onClick={() => { setInsertAfterIdx(null); setShowAddModal(true) }}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {blocks.map((block, idx) => (
              <div key={block.id}>
                <button
                  onClick={() => setSelectedId(block.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition group relative ${
                    selectedId === block.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical size={14} className={`mt-0.5 shrink-0 ${selectedId === block.id ? 'text-blue-200' : 'text-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-semibold mb-0.5 ${selectedId === block.id ? 'text-blue-100' : 'text-slate-400'}`}>
                        {blockLabel(block.type)}
                      </p>
                      <p className={`text-sm truncate ${selectedId === block.id ? 'text-white' : 'text-slate-700'}`}>
                        {blockPreview(block)}
                      </p>
                    </div>
                  </div>
                  <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition ${selectedId === block.id ? 'opacity-100' : ''}`}>
                    <button
                      onClick={e => { e.stopPropagation(); moveBlock(block.id, 'up') }}
                      disabled={idx === 0}
                      className={`p-1 rounded hover:bg-black/10 disabled:opacity-30 ${selectedId === block.id ? 'text-white' : 'text-slate-500'}`}
                    ><ChevronUp size={13} /></button>
                    <button
                      onClick={e => { e.stopPropagation(); moveBlock(block.id, 'down') }}
                      disabled={idx === blocks.length - 1}
                      className={`p-1 rounded hover:bg-black/10 disabled:opacity-30 ${selectedId === block.id ? 'text-white' : 'text-slate-500'}`}
                    ><ChevronDown size={13} /></button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteBlock(block.id) }}
                      className={`p-1 rounded hover:bg-red-500 hover:text-white ${selectedId === block.id ? 'text-red-200' : 'text-slate-400'}`}
                    ><Trash2 size={13} /></button>
                  </div>
                </button>

                {/* Insert after button */}
                <div className="flex items-center gap-2 px-2 my-0.5 opacity-0 hover:opacity-100 transition group/add">
                  <div className="flex-1 h-px bg-slate-300" />
                  <button
                    onClick={() => { setInsertAfterIdx(idx); setShowAddModal(true) }}
                    className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full p-0.5 transition"
                  ><Plus size={12} /></button>
                  <div className="flex-1 h-px bg-slate-300" />
                </div>
              </div>
            ))}
            {blocks.length === 0 && (
              <button
                onClick={() => { setInsertAfterIdx(null); setShowAddModal(true) }}
                className="w-full border-2 border-dashed border-slate-300 rounded-xl p-8 text-slate-400 hover:text-blue-600 hover:border-blue-400 transition text-sm"
              >
                <Plus size={20} className="mx-auto mb-2" />
                Add your first block
              </button>
            )}
          </div>

          {/* Page settings */}
          <div className="border-t border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Page Settings</p>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Meta Description</label>
              <textarea
                value={page.meta_description}
                onChange={e => { setPage(p => ({ ...p, meta_description: e.target.value })); setSavedAt(null) }}
                rows={2}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>
            {!page.is_homepage && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={page.show_in_nav}
                  onChange={e => { setPage(p => ({ ...p, show_in_nav: e.target.checked })); setSavedAt(null) }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-600">Show in navigation</span>
              </label>
            )}
            {!page.is_homepage && (
              <button
                onClick={handleDelete}
                className="text-xs text-red-500 hover:text-red-700 hover:underline"
              >
                Delete this page
              </button>
            )}
          </div>
        </div>

        {/* Right: block edit panel */}
        <div className="flex-1 overflow-y-auto p-8 bg-white">
          {selectedBlock ? (
            <BlockEditPanel
              block={selectedBlock}
              onChange={(patch) => updateBlockContent(selectedBlock.id, patch)}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <div className="text-5xl mb-4">←</div>
              <p className="text-lg font-medium">Select a block to edit it</p>
              <p className="text-sm mt-1">or add a new block from the left panel</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Block Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-900 text-lg">Add a Block</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {BLOCK_TYPES.map(bt => (
                <button
                  key={bt.type}
                  onClick={() => addBlock(bt.type)}
                  className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition"
                >
                  <span className="text-2xl leading-none">{bt.emoji}</span>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{bt.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{bt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Block Edit Panel ───────────────────────────────────────────────────────────

function BlockEditPanel({ block, onChange }: { block: Block; onChange: (patch: Partial<BlockContent>) => void }) {
  const label = blockLabel(block.type)
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-2xl">{BLOCK_TYPES.find(b => b.type === block.type)?.emoji}</span>
        <h2 className="text-xl font-bold text-slate-900">{label}</h2>
      </div>
      <div className="space-y-5">
        <BlockFields block={block} onChange={onChange} />
      </div>
    </div>
  )
}

function BlockFields({ block, onChange }: { block: Block; onChange: (p: Partial<BlockContent>) => void }) {
  const c = block.content
  function set<K extends keyof BlockContent>(key: K, value: BlockContent[K]) {
    onChange({ [key]: value } as Partial<BlockContent>)
  }

  switch (block.type) {
    case 'hero':
      return <>
        <Field label="Headline" value={c.headline} onChange={v => set('headline', v)} placeholder="Welcome to Our School" />
        <Field label="Subheadline" value={c.subheadline} onChange={v => set('subheadline', v)} placeholder="Short description..." textarea />
        <div className="grid grid-cols-2 gap-4">
          <ColorField label="Background Color" value={c.bgColor} onChange={v => set('bgColor', v)} />
          <ColorField label="Text Color" value={c.textColor} onChange={v => set('textColor', v)} />
        </div>
        <Field label="Background Image URL" value={c.imageUrl} onChange={v => set('imageUrl', v)} placeholder="https://..." />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Button Label" value={c.buttonLabel} onChange={v => set('buttonLabel', v)} placeholder="Learn More" />
          <Field label="Button Link" value={c.buttonLink} onChange={v => set('buttonLink', v)} placeholder="/about" />
        </div>
      </>

    case 'heading':
      return <>
        <Field label="Heading Text" value={c.text} onChange={v => set('text', v)} placeholder="Section Title" />
        <div className="grid grid-cols-3 gap-4">
          <SelectField label="Level" value={String(c.level)} onChange={v => set('level', Number(v))} options={[{ value: '2', label: 'H2 – Large' }, { value: '3', label: 'H3 – Medium' }]} />
          <SelectField label="Alignment" value={c.align} onChange={v => set('align', v)} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
          <ColorField label="Color" value={c.color} onChange={v => set('color', v)} />
        </div>
      </>

    case 'paragraph':
      return <>
        <Field label="Text" value={c.text} onChange={v => set('text', v)} placeholder="Enter your text…" textarea rows={6} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Alignment" value={c.align} onChange={v => set('align', v)} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }]} />
          <ColorField label="Text Color" value={c.color} onChange={v => set('color', v)} />
        </div>
      </>

    case 'image':
      return <>
        <Field label="Image URL" value={c.src} onChange={v => set('src', v)} placeholder="https://..." />
        {c.src && <img src={c.src} alt="preview" className="w-full max-h-48 object-cover rounded-xl border border-slate-200" />}
        <Field label="Alt Text" value={c.alt} onChange={v => set('alt', v)} placeholder="Describe the image..." />
        <Field label="Caption" value={c.caption} onChange={v => set('caption', v)} placeholder="Optional caption" />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Width" value={c.width} onChange={v => set('width', v)} options={[{ value: 'contained', label: 'Contained' }, { value: 'full', label: 'Full Width' }]} />
          <ToggleField label="Rounded Corners" value={c.rounded} onChange={v => set('rounded', v)} />
        </div>
      </>

    case 'button':
      return <>
        <Field label="Button Label" value={c.label} onChange={v => set('label', v)} placeholder="Click Here" />
        <Field label="Link URL" value={c.href} onChange={v => set('href', v)} placeholder="/about or https://..." />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Style" value={c.style} onChange={v => set('style', v)} options={[{ value: 'primary', label: 'Primary (Blue)' }, { value: 'secondary', label: 'Secondary (Dark)' }, { value: 'outline', label: 'Outline' }]} />
          <SelectField label="Alignment" value={c.align} onChange={v => set('align', v)} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
        </div>
        <div className="pt-2">
          <p className="text-xs text-slate-500 mb-2">Preview</p>
          <div className={`flex ${c.align === 'center' ? 'justify-center' : c.align === 'right' ? 'justify-end' : 'justify-start'}`}>
            <span className={`inline-block font-semibold px-6 py-2.5 rounded-xl text-sm ${
              c.style === 'secondary' ? 'bg-slate-700 text-white' :
              c.style === 'outline' ? 'border-2 border-blue-700 text-blue-700' :
              'bg-blue-700 text-white'
            }`}>{c.label || 'Button'}</span>
          </div>
        </div>
      </>

    case 'divider':
      return <div className="grid grid-cols-2 gap-4">
        <SelectField label="Style" value={c.style} onChange={v => set('style', v)} options={[{ value: 'line', label: 'Line' }, { value: 'dots', label: 'Dots' }, { value: 'space', label: 'Space only' }]} />
        {c.style !== 'space' && <ColorField label="Color" value={c.color} onChange={v => set('color', v)} />}
      </div>

    case 'card_grid':
      return <>
        <SelectField label="Columns" value={String(c.columns)} onChange={v => set('columns', Number(v))} options={[{ value: '2', label: '2 Columns' }, { value: '3', label: '3 Columns' }, { value: '4', label: '4 Columns' }]} />
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Cards</p>
            <button
              onClick={() => set('cards', [...(c.cards || []), { title: 'New Card', description: '', image: '', link: '', linkLabel: '' }])}
              className="text-xs text-blue-600 hover:underline font-medium"
            >+ Add Card</button>
          </div>
          {(c.cards || []).map((card: CardItem, idx: number) => (
            <div key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-slate-500">Card {idx + 1}</p>
                <button
                  onClick={() => set('cards', (c.cards || []).filter((_: CardItem, i: number) => i !== idx))}
                  className="text-red-400 hover:text-red-600 text-xs"
                >Remove</button>
              </div>
              <Field label="Title" value={card.title} onChange={v => { const cards = [...(c.cards || [])]; cards[idx] = { ...cards[idx], title: v }; set('cards', cards) }} placeholder="Card Title" />
              <Field label="Description" value={card.description} onChange={v => { const cards = [...(c.cards || [])]; cards[idx] = { ...cards[idx], description: v }; set('cards', cards) }} placeholder="Short description" textarea rows={2} />
              <Field label="Image URL" value={card.image} onChange={v => { const cards = [...(c.cards || [])]; cards[idx] = { ...cards[idx], image: v }; set('cards', cards) }} placeholder="https://..." />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Link URL" value={card.link} onChange={v => { const cards = [...(c.cards || [])]; cards[idx] = { ...cards[idx], link: v }; set('cards', cards) }} placeholder="/page" />
                <Field label="Link Label" value={card.linkLabel} onChange={v => { const cards = [...(c.cards || [])]; cards[idx] = { ...cards[idx], linkLabel: v }; set('cards', cards) }} placeholder="Read more" />
              </div>
            </div>
          ))}
        </div>
      </>

    case 'announcement':
      return <>
        <Field label="Message" value={c.text} onChange={v => set('text', v)} placeholder="Important announcement…" textarea rows={3} />
        <div className="grid grid-cols-2 gap-4">
          <ColorField label="Background Color" value={c.bgColor} onChange={v => set('bgColor', v)} />
          <ColorField label="Text Color" value={c.textColor} onChange={v => set('textColor', v)} />
        </div>
        <div className="rounded-xl px-6 py-4 text-sm font-medium mt-2" style={{ backgroundColor: c.bgColor, color: c.textColor }}>
          {c.text || 'Preview'}
        </div>
      </>

    case 'two_column':
      return <div className="grid grid-cols-2 gap-6">
        <Field label="Left Column" value={c.leftText} onChange={v => set('leftText', v)} placeholder="Left column content…" textarea rows={8} />
        <Field label="Right Column" value={c.rightText} onChange={v => set('rightText', v)} placeholder="Right column content…" textarea rows={8} />
      </div>

    default:
      return null
  }
}

// ── Form primitives ────────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, textarea, rows }: {
  label: string
  value?: string
  onChange: (v: string) => void
  placeholder?: string
  textarea?: boolean
  rows?: number
}) {
  const cls = 'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {textarea
        ? <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows ?? 3} className={`${cls} resize-none`} />
        : <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string
  value?: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)}
          className="w-10 h-10 border border-slate-200 rounded-lg cursor-pointer p-0.5" />
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
      </div>
    </div>
  )
}

function ToggleField({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <label className="flex items-center gap-2 cursor-pointer mt-3">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4" />
        <span className="text-sm text-slate-600">{value ? 'Yes' : 'No'}</span>
      </label>
    </div>
  )
}
