import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { authenticateRequest } from '../lib/policy-auth.mts'

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await authenticateRequest(req)
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'No file was provided.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'The AI service is not configured. Please contact support.' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const isPdf = file.type === 'application/pdf' ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    const isImage = file.type.startsWith('image/')

    const prompt = `Analyse this insurance policy document and extract the following information as strict JSON, with no additional text and no markdown fences:
{
  "name": "Policyholder, insured person, or main policy name in English",
  "type": "insurance type: auto | health | property | life | liability | workers_comp | cyber | directors_officers | business_interruption | other",
  "insurer": "Insurer name",
  "policyNumber": "Policy number",
  "startDate": "Start date (YYYY-MM-DD)",
  "endDate": "End date (YYYY-MM-DD)",
  "annualPremium": 0,
  "insuredValue": 0,
  "deductible": 0,
  "coverages": ["Coverage 1 (Limit: X euros, Deductible: Y euros)", "Coverage 2"],
  "exclusions": ["Exclusion 1", "Exclusion 2"]
}
Translate every extracted free-text value into clear English, including the name, coverages, and exclusions, even when the source document is in Portuguese or another language. Preserve company names and policy numbers exactly. If a field cannot be extracted, use null for strings, an empty array for lists, and 0 for numbers. Reply ONLY with the JSON.`

    let messageParts: Anthropic.MessageParam['content']

    if (isPdf && bytes.length > 100) {
      messageParts = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as any,
        { type: 'text', text: prompt },
      ]
    } else if (isImage && bytes.length > 100) {
      const mimeType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      messageParts = [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: prompt },
      ]
    } else {
      const text = Buffer.from(arrayBuffer).toString('utf-8')
      const cleanText = text.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\r\t]/g, ' ').substring(0, 30000)
      messageParts = [
        { type: 'text', text: `${prompt}\n\nDocument content:\n${cleanText}` },
      ]
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: messageParts }],
    })

    const contentText = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from the response.
    const jsonMatch = contentText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('The document data could not be extracted as JSON.')
    }

    const extractedData = JSON.parse(jsonMatch[0])
    const typeAliases: Record<string, string> = {
      car: 'auto', carro: 'auto', automovel: 'auto', automóvel: 'auto',
      health: 'health', saude: 'health', saúde: 'health',
      home: 'property', house: 'property', casa: 'property', habitation: 'property', habitação: 'property', property: 'property',
      life: 'life', vida: 'life', liability: 'liability', responsabilidade: 'liability',
    }
    const rawType = String(extractedData.type || 'other').trim().toLowerCase()
    extractedData.type = typeAliases[rawType] || rawType || 'other'

    const translationResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: 'You are a specialist insurance translator. Return strict JSON only. Every value must be in natural English. Never return Portuguese text. Preserve proper names, insurer names, amounts, policy numbers, and coverage limits exactly.',
      messages: [{
        role: 'user',
        content: `Translate the following extracted insurance fields into English. Return exactly this JSON shape with no additional text:\n${JSON.stringify({
          name: extractedData.name ?? null,
          coverages: Array.isArray(extractedData.coverages) ? extractedData.coverages : [],
          exclusions: Array.isArray(extractedData.exclusions) ? extractedData.exclusions : [],
        })}`,
      }],
    })
    const translationText = translationResponse.content[0]?.type === 'text'
      ? translationResponse.content[0].text
      : ''
    const translationMatch = translationText.match(/\{[\s\S]*\}/)
    if (!translationMatch) {
      throw new Error('The extracted policy clauses could not be translated into English.')
    }
    const translated = JSON.parse(translationMatch[0])
    extractedData.name = translated.name ?? extractedData.name ?? null
    extractedData.coverages = Array.isArray(translated.coverages) ? translated.coverages : []
    extractedData.exclusions = Array.isArray(translated.exclusions) ? translated.exclusions : []
    return Response.json(extractedData)

  } catch (error: any) {
    const errMsg = error?.error?.message ?? error?.message ?? String(error)
    const errStatus = error?.status ?? 500
    console.error('[extract-policy] status:', errStatus, '| detalhe:', errMsg, '| raw:', error)
    let userMessage = 'The document could not be processed. Please check that it is a valid insurance policy.'

    if (errMsg.includes('no pages') || errMsg.includes('No pages')) {
      userMessage = 'The PDF appears to be empty or corrupted. Please check the file.'
    } else if (/rate.?limit|overloaded|50[,.]?000/i.test(errMsg)) {
      userMessage = 'The AI service is temporarily busy. Please wait a moment and try again.'
    } else if (errMsg.includes('too large') || errMsg.includes('size')) {
      userMessage = 'The file is too large. Please reduce its size and try again.'
    } else if (errMsg.includes('JSON')) {
      userMessage = 'The policy details could not be extracted. The document may not be in a recognised format.'
    }

    return Response.json(
      { error: userMessage, details: errMsg, status: errStatus },
      { status: 500 }
    )
  }
}

export const config: Config = {
  path: '/api/extract-policy',
}
