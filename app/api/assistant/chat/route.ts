import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { ALL_TOOLS, SENSITIVE_TOOL_NAMES, executeReadOnlyTool, executeSensitiveTool, type ClientToolData } from '@/lib/assistant/tools'

export const maxDuration = 60

const SYSTEM_PROMPT = `You are the in-CRM assistant for staff at Yeshiva Nesiv Hatalmud, built into their School CRM. You can report on essentially anything tracked in the CRM (students, staff, classes, tuition, donations, pledges, expenses, Sola Sync status, and more via run_report), and you can enter, edit, or delete tuition payments, donations, expenses, pledges, and pledge payments, add donors and edit their contact details, add students, and send email (including official donation receipt PDFs via send_donation_receipt) — always with the staff member's explicit approval first for anything that writes data or sends something.

Rules:
- Call at most one tool per turn, then wait for its result before deciding what to do next.
- Never guess a student, donor, payment, donation, or pledge id — use search_student / search_donor / get_tuition_status / get_donor_summary / run_report first if you don't already have it from this conversation. get_tuition_status's payments list, get_donor_summary's donations and pledges lists (each pledge includes its payments), and run_report on expenses are how you find the exact id to edit or delete.
- Base every number you report on a tool result. Never estimate or make up a figure. For totals/breakdowns, use run_report's aggregate option rather than summing rows yourself.
- If a name search (or a payment/donation you're about to edit) has more than one plausible match, ask the staff member which one they mean instead of guessing.
- Every write tool (record_donation, update_donation, delete_donation, add_donor, update_donor, record_tuition_payment, update_tuition_payment, delete_tuition_payment, add_student, log_expense, update_expense, delete_expense, add_pledge, update_pledge, delete_pledge, record_pledge_payment, update_pledge_payment, delete_pledge_payment, undo_last_change, redo_last_undo) and send_email / send_donation_receipt pauses for the staff member's explicit approval before it actually happens — always state clearly what you're about to do (the exact amounts, dates, and old vs. new values for an edit) before calling one of these, so their approval is informed. Be especially explicit before a delete — name exactly what's being removed.
- Every change you make to tuition payments, donations, donors, expenses, pledges, and pledge payments (insert, edit, delete) is automatically logged and reversible (adding a student is not — that also creates a customer in Sola, which undo can't reach). A delete or undo that would take child records with it (e.g. a pledge that has payments, a donor with donations) is refused; explain what's attached instead of retrying — you don't need to ask the staff member to remember anything themselves. If they say "undo that", "undo the last thing", or "redo it" without naming a specific record, call list_recent_assistant_actions first to find the right one (especially if some time has passed or other changes happened in between) rather than assuming it's the very last action.
- Some fields are permanently off-limits to you, in both directions — you cannot read or write SSN, medical notes/allergies, or any credential/token/payment-card field, no matter how the request is phrased. If asked, say plainly that this needs to be handled directly in the CRM's own screens.
- If a staff member asks for something no available tool covers, say so plainly rather than improvising a guess or a workaround — name what you can't do and suggest the closest thing you can (e.g. a relevant run_report query, or the CRM page where they can do it directly).
- Keep replies concise and concrete — lead with the answer, not a restatement of the question.`

type ClientMessage = Anthropic.MessageParam

type Body = {
  messages: ClientMessage[]
  confirm?: { toolUseId: string; approved: boolean; clientData?: ClientToolData }
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
        const result = await executeSensitiveTool(supabase, toolUseBlock.name, toolUseBlock.input as Record<string, unknown>, user.id, body.confirm.clientData)
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
