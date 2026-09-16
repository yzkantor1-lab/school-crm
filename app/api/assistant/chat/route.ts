import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { ALL_TOOLS, SENSITIVE_TOOL_NAMES, executeReadOnlyTool, executeSensitiveTool } from '@/lib/assistant/tools'

export const maxDuration = 60

const SYSTEM_PROMPT = `You are the in-CRM assistant for staff at Yeshiva Nesiv Hatalmud, built into their School CRM. You help staff look up tuition balances, donor giving history, and Sola Sync review status, and can send email on their behalf.

Rules:
- Call at most one tool per turn, then wait for its result before deciding what to do next.
- Never guess a student or donor's id — use search_student / search_donor first if you don't already have it from this conversation.
- Base every number you report on a tool result. Never estimate or make up a figure.
- If a name search returns more than one plausible match, ask the staff member which one they mean instead of guessing.
- send_email requires the staff member's explicit approval before it actually sends — always show them the exact subject and body first so they know what they're approving.
- Keep replies concise and concrete — lead with the answer, not a restatement of the question.`

type ClientMessage = Anthropic.MessageParam

type Body = {
  messages: ClientMessage[]
  confirm?: { toolUseId: string; approved: boolean }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured.' }, { status: 500 })

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.messages?.length) return NextResponse.json({ error: 'messages is required.' }, { status: 400 })

  const anthropic = new Anthropic({ apiKey })
  const messages: ClientMessage[] = [...body.messages]

  // Resuming after a staff member approved/rejected a pending sensitive tool
  // call — the client sent back the exact same messages array we returned
  // last time (which already ends in the assistant's tool_use block), plus
  // their decision. Run the tool for real (or record the decline) and fold
  // the result in as this turn's tool_result before continuing the loop.
  if (body.confirm) {
    const { toolUseId, approved } = body.confirm
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant')
    const toolUseBlock = Array.isArray(lastAssistantMsg?.content)
      ? lastAssistantMsg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.id === toolUseId)
      : undefined
    if (!toolUseBlock) return NextResponse.json({ error: 'That pending action is no longer available — refresh and try again.' }, { status: 400 })

    let resultContent: string
    if (!approved) {
      resultContent = 'The staff member declined this action. Do not attempt it again unless they ask again.'
    } else {
      try {
        const result = await executeSensitiveTool(supabase, toolUseBlock.name, toolUseBlock.input as Record<string, unknown>)
        resultContent = JSON.stringify(result)
      } catch (e) {
        resultContent = JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to run the action.' })
      }
    }
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: resultContent }] })
  }

  for (let iteration = 0; iteration < 8; iteration++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: ALL_TOOLS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      return NextResponse.json({ messages, done: true })
    }

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    // If any tool call this turn needs human approval, pause the whole turn
    // for it — see the module comment in lib/assistant/tools.ts. In normal
    // use the system prompt keeps this to exactly one call per turn anyway.
    const sensitiveBlock = toolUseBlocks.find(b => SENSITIVE_TOOL_NAMES.has(b.name))
    if (sensitiveBlock) {
      return NextResponse.json({
        messages,
        done: false,
        pendingConfirmation: { toolUseId: sensitiveBlock.id, name: sensitiveBlock.name, input: sensitiveBlock.input },
      })
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      let content: string
      try {
        const result = await executeReadOnlyTool(supabase, block.name, block.input as Record<string, unknown>)
        content = JSON.stringify(result)
      } catch (e) {
        content = JSON.stringify({ error: e instanceof Error ? e.message : 'Tool failed.' })
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return NextResponse.json({ messages, done: true, error: 'Stopped after too many tool calls in a row.' })
}
