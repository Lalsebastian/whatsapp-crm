let runtimeAccessKey = '';

function apiBaseUrl() {
  return String(import.meta.env.VITE_CHATBOT_API_BASE_URL || '').replace(/\/$/, '');
}

export function getChatbotAnalyticsAccessKey() {
  return runtimeAccessKey;
}

export function setChatbotAnalyticsAccessKey(value) {
  runtimeAccessKey = String(value || '').trim();
}

export function clearChatbotAnalyticsAccessKey() {
  runtimeAccessKey = '';
}

export async function fetchChatbotAnalytics({ range = '7d', accessKey = runtimeAccessKey } = {}) {
  if (!accessKey) {
    const error = new Error('Enter the analytics access key to continue.');
    error.code = 'CHATBOT_ANALYTICS_UNAUTHORIZED';
    throw error;
  }

  const response = await fetch(`${apiBaseUrl()}/api/analytics/chatbot?range=${encodeURIComponent(range)}`, {
    headers: { 'x-chatbot-analytics-secret': accessKey },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Unable to load chatbot analytics.');
    error.code = payload.code || 'CHATBOT_ANALYTICS_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}
