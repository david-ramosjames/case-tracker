const QUO_MIN_REQUEST_INTERVAL_MS = 120;
const QUO_MAX_RETRIES = 6;

let lastQuoRequestAt = 0;
let quoRequestChain: Promise<void> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(response: Response) {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

async function waitForQuoSlot() {
  quoRequestChain = quoRequestChain.then(async () => {
    const waitMs = Math.max(0, QUO_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastQuoRequestAt));
    if (waitMs > 0) await sleep(waitMs);
    lastQuoRequestAt = Date.now();
  });
  await quoRequestChain;
}

/** Throttled Quo API fetch with retry on 429 and 5xx. */
export async function quoApiFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= QUO_MAX_RETRIES; attempt += 1) {
    await waitForQuoSlot();

    const response = await fetch(url, { ...init, cache: "no-store" });
    if (response.ok) return response;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === QUO_MAX_RETRIES) return response;

    const retryAfterMs = parseRetryAfterMs(response);
    const backoffMs = retryAfterMs ?? Math.min(30_000, 1_000 * 2 ** attempt);
    const jitterMs = Math.floor(Math.random() * 250);
    await sleep(backoffMs + jitterMs);
  }

  throw new Error("Quo API request failed after retries.");
}
