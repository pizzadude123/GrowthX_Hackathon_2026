export async function call(url: string) { return fetch(url, { signal: AbortSignal.timeout(5000) }); }
