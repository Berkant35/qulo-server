import Replicate from 'replicate';

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
if (!REPLICATE_TOKEN) {
  throw new Error('REPLICATE_API_TOKEN missing in env');
}

const client = new Replicate({ auth: REPLICATE_TOKEN });

const MODEL = 'bytedance/seedream-4';

/**
 * Generate one image. Returns the temporary Replicate URL.
 * Caller MUST download and rehost — URL expires within ~1 hour.
 */
export async function generateImage(prompt: string): Promise<string> {
  const output = (await client.run(MODEL, {
    input: {
      prompt,
      size: '1K',
      aspect_ratio: '3:4',
    },
  })) as unknown;

  // SDK returns either string[] of URLs or FileOutput[] depending on version
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (first && typeof (first as { url?: () => URL }).url === 'function') {
      return (first as { url: () => URL }).url().toString();
    }
  }
  throw new Error(`Unexpected Replicate output shape: ${JSON.stringify(output).slice(0, 200)}`);
}
