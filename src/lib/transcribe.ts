// Speech → text for the development-mode goal field.
//
// Deliberately a RAW fetch instead of the langchain client the rest of huu
// uses: the chat wrapper models text (and structured output), while this needs
// OpenRouter's multimodal `input_audio` content part, which the wrapper does
// not expose. One endpoint, one shape, no abstraction worth building.
//
// Format constraints are OpenRouter's, verified against the live API:
//   - the audio must be BASE64 in the content part; URLs are not accepted
//   - accepted `format` values are wav/mp3/aiff/aac/ogg/flac/m4a/pcm16/pcm24 —
//     notably NOT webm, which is what a browser's MediaRecorder produces by
//     default. The client therefore decodes whatever it captured and re-encodes
//     16 kHz mono WAV before posting here (see `captureGoalAudio` in app.js).

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Default transcription model. `google/gemini-3.1-flash-lite` is the 3.1-flash
 * variant that actually accepts audio — a plain `google/gemini-3.1-flash` with
 * an audio input modality does not exist on OpenRouter. Cheap enough to be
 * uninteresting (~US$0.00007 for a 4-second clip).
 */
export const DEFAULT_TRANSCRIBE_MODEL = 'google/gemini-3.1-flash-lite';

/** Audio container formats OpenRouter accepts for `input_audio`. */
export const TRANSCRIBE_FORMATS = [
  'wav',
  'mp3',
  'aiff',
  'aac',
  'ogg',
  'flac',
  'm4a',
  'pcm16',
  'pcm24',
] as const;
export type TranscribeFormat = (typeof TRANSCRIBE_FORMATS)[number];

/**
 * Upper bound on the base64 payload (~8 MiB ≈ 3 min of 16 kHz mono WAV).
 * Guards the server against an unbounded body, and the user against a clip
 * whose token cost dwarfs the feature's point.
 */
export const MAX_AUDIO_BASE64_CHARS = 8 * 1024 * 1024;

/**
 * The instruction is deliberately narrow. This is a dictation field, not an
 * assistant: expanding, translating or "improving" what the user said would
 * silently rewrite the one input the whole run is underwritten by.
 */
const TRANSCRIBE_PROMPT = `Transcribe the speech in this audio VERBATIM.

Rules:
- Output ONLY the transcription. No preamble, no quotes, no commentary, no translation.
- Keep the speaker's own language and wording. Do not summarize, expand or correct their intent.
- Fix only obvious dictation artifacts: filler words, false starts, and stutters.
- Render spoken punctuation naturally; keep code identifiers and file paths as spoken.
- If the audio contains no intelligible speech, output an empty string and nothing else.`;

export interface TranscribeOptions {
  /** Base64 audio, no `data:` URI prefix. */
  audioBase64: string;
  format: TranscribeFormat;
  apiKey: string;
  /** Defaults to {@link DEFAULT_TRANSCRIBE_MODEL}. */
  modelId?: string;
  /** Test seam: replaces the network call. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  modelId: string;
  /** USD, when OpenRouter reports it. */
  cost?: number;
}

export class TranscribeError extends Error {
  constructor(
    message: string,
    /** HTTP status when the failure came from the provider. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TranscribeError';
  }
}

export function isTranscribeFormat(value: unknown): value is TranscribeFormat {
  return typeof value === 'string' && (TRANSCRIBE_FORMATS as readonly string[]).includes(value);
}

/**
 * Transcribe one audio clip. Throws {@link TranscribeError} for every expected
 * failure (missing key, oversized clip, provider error, empty completion) so
 * the caller maps one error type onto an HTTP status.
 */
export async function transcribeAudio(opts: TranscribeOptions): Promise<TranscribeResult> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    throw new TranscribeError('no OpenRouter API key available for transcription', 401);
  }
  const audio = opts.audioBase64?.trim();
  if (!audio) throw new TranscribeError('no audio data', 400);
  if (audio.length > MAX_AUDIO_BASE64_CHARS) {
    throw new TranscribeError(
      `audio is too large (${Math.round(audio.length / 1024)} KiB base64; cap ${Math.round(MAX_AUDIO_BASE64_CHARS / 1024)} KiB) — record a shorter clip`,
      413,
    );
  }

  const modelId = opts.modelId?.trim() || DEFAULT_TRANSCRIBE_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
        'X-Title': 'huu',
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: TRANSCRIBE_PROMPT },
              { type: 'input_audio', input_audio: { data: audio, format: opts.format } },
            ],
          },
        ],
      }),
      signal: opts.signal,
    });
  } catch (err) {
    throw new TranscribeError(
      `could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TranscribeError(
      `OpenRouter returned ${res.status}: ${extractProviderError(body) || res.statusText}`,
      res.status,
    );
  }

  const parsed = (await res.json().catch(() => null)) as unknown;
  const text = extractContent(parsed);
  if (text === null) {
    throw new TranscribeError('OpenRouter returned no usable completion', 502);
  }

  return { text: text.trim(), modelId, cost: extractCost(parsed) };
}

/** Pull the assistant text out of a chat completion, tolerating both the
 *  string and the content-parts array shapes. */
function extractContent(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (message === null || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('');
    return joined;
  }
  return null;
}

function extractCost(payload: unknown): number | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const usage = (payload as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== 'object') return undefined;
  const cost = (usage as { cost?: unknown }).cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
}

/** OpenRouter error bodies are `{error:{message}}`; fall back to raw text. */
function extractProviderError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    /* not JSON — fall through */
  }
  return body.slice(0, 300);
}
