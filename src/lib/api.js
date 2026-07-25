const params = new URLSearchParams(location.search);
export const SLUG = params.get('slug') || 'default';

export async function loadBoard() {
  const r = await fetch(`/api/board?slug=${encodeURIComponent(SLUG)}`);
  if (!r.ok) throw new Error(`board load failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function saveFeedback(feedback) {
  const r = await fetch(`/api/feedback?slug=${encodeURIComponent(SLUG)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(feedback),
  });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
  return r.json();
}
