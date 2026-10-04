import { ephemeralModelRequest } from '../ephemeral-model/ephemeral-request.js'
import { TITLE_INSTRUCTIONS, type TitleGenerator } from './title-policy.js'

/** A title is the smallest ephemeral request: low effort, and a prompt that already states its instructions. */
export const generateChatTitle: TitleGenerator = (request, signal) => ephemeralModelRequest({
  modelId: request.modelId, instructions: TITLE_INSTRUCTIONS, prompt: request.prompt, promptCarriesInstructions: true,
  effort: 'low', label: 'Title generation'
}, signal)
