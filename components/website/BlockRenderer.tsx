export type CardItem = { image?: string; title?: string; description?: string; link?: string; linkLabel?: string }

export type BlockContent = {
  bgColor?: string
  textColor?: string
  imageUrl?: string
  headline?: string
  subheadline?: string
  buttonLabel?: string
  buttonLink?: string
  level?: number
  align?: string
  color?: string
  text?: string
  src?: string
  alt?: string
  width?: string
  rounded?: boolean
  caption?: string
  href?: string
  label?: string
  style?: string
  columns?: number
  cards?: CardItem[]
  leftText?: string
  rightText?: string
}

interface Block {
  id: string
  type: string
  content: BlockContent
}

export default function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map(block => (
        <BlockSwitch key={block.id} block={block} />
      ))}
    </>
  )
}

function BlockSwitch({ block }: { block: Block }) {
  const c = block.content
  switch (block.type) {
    case 'hero': return <HeroBlock c={c} />
    case 'heading': return <HeadingBlock c={c} />
    case 'paragraph': return <ParagraphBlock c={c} />
    case 'image': return <ImageBlock c={c} />
    case 'button': return <ButtonBlock c={c} />
    case 'divider': return <DividerBlock c={c} />
    case 'card_grid': return <CardGridBlock c={c} />
    case 'announcement': return <AnnouncementBlock c={c} />
    case 'two_column': return <TwoColumnBlock c={c} />
    default: return null
  }
}

function HeroBlock({ c }: { c: BlockContent }) {
  const style: React.CSSProperties = {
    backgroundColor: c.bgColor || '#1e3a5f',
    color: c.textColor || '#ffffff',
  }
  if (c.imageUrl) {
    style.backgroundImage = `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${c.imageUrl})`
    style.backgroundSize = 'cover'
    style.backgroundPosition = 'center'
  }
  return (
    <div style={style} className="py-24 px-6 text-center">
      <div className="max-w-3xl mx-auto">
        {c.headline && <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">{c.headline}</h1>}
        {c.subheadline && <p className="text-lg md:text-xl opacity-90 mb-8 max-w-2xl mx-auto">{c.subheadline}</p>}
        {c.buttonLabel && c.buttonLink && (
          <a
            href={c.buttonLink}
            className="inline-block bg-white text-slate-900 font-semibold px-8 py-3 rounded-xl hover:opacity-90 transition text-base"
          >
            {c.buttonLabel}
          </a>
        )}
      </div>
    </div>
  )
}

function HeadingBlock({ c }: { c: BlockContent }) {
  const Tag = (c.level === 3 ? 'h3' : 'h2') as 'h2' | 'h3'
  const align = c.align === 'center' ? 'text-center' : c.align === 'right' ? 'text-right' : 'text-left'
  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <Tag
        className={`font-bold ${align} ${Tag === 'h2' ? 'text-3xl' : 'text-2xl'}`}
        style={{ color: c.color || '#1e293b' }}
      >
        {c.text}
      </Tag>
    </div>
  )
}

function ParagraphBlock({ c }: { c: BlockContent }) {
  const align = c.align === 'center' ? 'text-center' : 'text-left'
  return (
    <div className="max-w-6xl mx-auto px-6 py-4">
      <p
        className={`text-base leading-relaxed whitespace-pre-wrap ${align} max-w-3xl ${c.align === 'center' ? 'mx-auto' : ''}`}
        style={{ color: c.color || '#475569' }}
      >
        {c.text}
      </p>
    </div>
  )
}

function ImageBlock({ c }: { c: BlockContent }) {
  if (!c.src) return null
  const isContained = c.width !== 'full'
  return (
    <div className={`py-6 ${isContained ? 'max-w-6xl mx-auto px-6' : ''}`}>
      <figure>
        <img
          src={c.src}
          alt={c.alt || ''}
          className={`w-full object-cover ${c.rounded ? 'rounded-2xl' : ''} ${isContained ? 'max-h-[500px]' : 'max-h-[600px]'}`}
        />
        {c.caption && (
          <figcaption className="text-sm text-slate-500 mt-3 text-center">{c.caption}</figcaption>
        )}
      </figure>
    </div>
  )
}

function ButtonBlock({ c }: { c: BlockContent }) {
  const alignClass = c.align === 'center' ? 'justify-center' : c.align === 'right' ? 'justify-end' : 'justify-start'
  const styleClass =
    c.style === 'secondary' ? 'bg-slate-700 hover:bg-slate-800 text-white' :
    c.style === 'outline' ? 'border-2 border-blue-700 text-blue-700 hover:bg-blue-50' :
    'bg-blue-700 hover:bg-blue-800 text-white'
  return (
    <div className="max-w-6xl mx-auto px-6 py-4">
      <div className={`flex ${alignClass}`}>
        <a href={c.href || '#'} className={`inline-block font-semibold px-8 py-3 rounded-xl transition text-base ${styleClass}`}>
          {c.label || 'Click Here'}
        </a>
      </div>
    </div>
  )
}

function DividerBlock({ c }: { c: BlockContent }) {
  if (c.style === 'space') return <div className="py-8" />
  if (c.style === 'dots') {
    return (
      <div className="max-w-6xl mx-auto px-6 py-6 text-center text-2xl tracking-widest" style={{ color: c.color || '#cbd5e1' }}>
        ···
      </div>
    )
  }
  return (
    <div className="max-w-6xl mx-auto px-6 py-4">
      <hr style={{ borderColor: c.color || '#e2e8f0' }} />
    </div>
  )
}

function CardGridBlock({ c }: { c: BlockContent }) {
  const cols = c.columns === 2 ? 'grid-cols-1 md:grid-cols-2' : c.columns === 4 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-3'
  const cards: CardItem[] = c.cards || []
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className={`grid ${cols} gap-6`}>
        {cards.map((card: CardItem, i: number) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition">
            {card.image && (
              <img src={card.image} alt={card.title || ''} className="w-full h-48 object-cover" />
            )}
            <div className="p-6">
              {card.title && <h3 className="font-bold text-slate-900 text-lg mb-2">{card.title}</h3>}
              {card.description && <p className="text-slate-600 text-sm leading-relaxed">{card.description}</p>}
              {card.link && card.linkLabel && (
                <a href={card.link} className="inline-block mt-4 text-sm font-semibold text-blue-700 hover:underline">
                  {card.linkLabel} →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnnouncementBlock({ c }: { c: BlockContent }) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-4">
      <div
        className="rounded-2xl px-8 py-6 text-base font-medium"
        style={{ backgroundColor: c.bgColor || '#dbeafe', color: c.textColor || '#1e40af' }}
      >
        {c.text}
      </div>
    </div>
  )
}

function TwoColumnBlock({ c }: { c: BlockContent }) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{c.leftText}</p>
        <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{c.rightText}</p>
      </div>
    </div>
  )
}
