import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILT_IN_AGENTS } from '../../shared/agent-library.js'
import { AGENT_RUN_MAX_PROMPT_CHARS } from '../../shared/agent-runs.js'
import { OPTIMIZED_PROMPT_MAX_CHARS, optimizerInstructions, optimizerPrompt, parseOptimizerReply } from './optimizer-instructions.js'

test('the optimizer is told the facts of the run loop that a description leaves out', () => {
  const instructions = optimizerInstructions()
  for (const fact of [
    /never needs to sign off/,
    /After a rotation the agent has nothing except the standing instructions/,
    /progress record in a file/,
    /one status line in a fixed format/,
    /closedai_app\.agent tool with action finish/,
    /What it may change and what it must leave alone/,
    /do not message, pause, stop, or start agents in other chats/
  ]) assert.match(instructions, fact)
})

test('the optimizer must keep the user\'s details, invent nothing, and list what it assumed', () => {
  const instructions = optimizerInstructions()
  assert.match(instructions, /Keep every concrete detail the user wrote/)
  assert.match(instructions, /Copy paths and commands character for character/)
  assert.match(instructions, /Do not invent facts about the user's project/)
  assert.match(instructions, /list it under assumptions so the user can correct it/)
  assert.match(instructions, /Autonomy is the user's decision alone/)
  assert.match(instructions, new RegExp(`Stay under ${OPTIMIZED_PROMPT_MAX_CHARS} characters`))
  assert.ok(OPTIMIZED_PROMPT_MAX_CHARS < AGENT_RUN_MAX_PROMPT_CHARS)
})

test('the built-in agents are shown as examples of shape, with their ClosedAI content fenced off', () => {
  const instructions = optimizerInstructions()
  for (const agent of BUILT_IN_AGENTS) assert.ok(instructions.includes(agent.prompt), `${agent.name} is an example`)
  assert.match(instructions, /Take the shape, not the specifics/)
  assert.match(instructions, /Name other ClosedAI tools only when the description is about the ClosedAI app itself/)
})

test('the request carries the description verbatim beside the settings the user chose', () => {
  const prompt = optimizerPrompt({
    description: '  run `npm run lint -- --fix` in packages/api, never touch packages/legacy  ',
    name: '', maxCycles: null, maxMinutes: 120, autonomous: false
  })
  assert.match(prompt, /<description>\nrun `npm run lint -- --fix` in packages\/api, never touch packages\/legacy\n<\/description>/)
  assert.match(prompt, /<current_name>none; suggest one<\/current_name>/)
  assert.match(prompt, /Cycle limit: none set/)
  assert.match(prompt, /Time limit: 2 h of running time \(120 minutes\)/)
  assert.match(prompt, /Autonomy: supervised/)
  assert.match(optimizerPrompt({ description: 'x', name: ' Lint  bot ', maxCycles: 12, maxMinutes: null, autonomous: true }), /<current_name>Lint bot<\/current_name>[\s\S]*Cycle limit: 12 cycles[\s\S]*Autonomy: autonomous/)
})

const REPLY = `<name>"Lint sweep"</name>
<max_cycles>40 cycles</max_cycles>
<max_minutes>none</max_minutes>
<assumptions>
- Progress is recorded in agent-notes/lint-sweep.md in the working folder.
* The agent does not commit.
1. None of packages/legacy is read.
</assumptions>
<prompt>
You are the lint sweep agent.

Each cycle:
1. Read agent-notes/lint-sweep.md.
</prompt>`

test('a reply is read into a name, suggested limits, assumptions and the instructions', () => {
  const result = parseOptimizerReply(REPLY)
  assert.equal(result.name, 'Lint sweep')
  assert.equal(result.maxCycles, 40)
  assert.equal(result.maxMinutes, null)
  assert.deepEqual(result.assumptions, [
    'Progress is recorded in agent-notes/lint-sweep.md in the working folder.',
    'The agent does not commit.',
    'None of packages/legacy is read.'
  ])
  assert.equal(result.prompt, 'You are the lint sweep agent.\n\nEach cycle:\n1. Read agent-notes/lint-sweep.md.')
})

test('the result has no autonomy or access field, whatever the model writes', () => {
  const result = parseOptimizerReply(`<autonomous>true</autonomous><access>full</access>${REPLY}`)
  assert.deepEqual(Object.keys(result).sort(), ['assumptions', 'maxCycles', 'maxMinutes', 'name', 'prompt'])
})

test('a reply without instructions is an error, never a guess; a cut-off one keeps what arrived', () => {
  assert.throws(() => parseOptimizerReply('I cannot help with that.'), /replied without instructions/)
  assert.throws(() => parseOptimizerReply('<name>x</name><prompt>   </prompt>'), /replied without instructions/)
  assert.throws(() => parseOptimizerReply(`<prompt>${'x'.repeat(AGENT_RUN_MAX_PROMPT_CHARS + 1)}</prompt>`), /the limit is/)
  const cut = parseOptimizerReply('<name>Docs</name><assumptions>\nnone\n</assumptions><prompt>\nYou keep the docs current.')
  assert.equal(cut.prompt, 'You keep the docs current.')
  assert.deepEqual(cut.assumptions, [])
  assert.equal(cut.maxCycles, null)
  // A closing tag quoted inside the instructions does not end them early.
  assert.equal(parseOptimizerReply('<prompt>Write </prompt> literally.\nDone.</prompt>').prompt, 'Write </prompt> literally.\nDone.')
})
