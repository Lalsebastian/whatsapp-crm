import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const express = require('express');
const env = require('../../config/env');
const dashboardService = require('../../analytics/dashboardService');
dashboardService.getChatbotAnalytics = vi.fn();
const analyticsRoute = require('../../routes/chatbotAnalytics');

const originalEnabled = env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD;
const originalSecret = env.CHATBOT_ANALYTICS_SECRET;
let server;
let baseUrl;

describe('chatbot analytics API security', () => {
  beforeAll(async () => {
    const app = express();
    app.use('/api/analytics/chatbot', analyticsRoute);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD = originalEnabled;
    env.CHATBOT_ANALYTICS_SECRET = originalSecret;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD = false;
    env.CHATBOT_ANALYTICS_SECRET = 'management-secret';
    dashboardService.getChatbotAnalytics.mockReset();
  });

  afterEach(() => {
    env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD = originalEnabled;
    env.CHATBOT_ANALYTICS_SECRET = originalSecret;
  });

  it('fails closed when the analytics feature is disabled', async () => {
    const response = await fetch(`${baseUrl}/api/analytics/chatbot?range=7d`, {
      headers: { 'x-chatbot-analytics-secret': 'management-secret' },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('CHATBOT_ANALYTICS_DISABLED');
    expect(dashboardService.getChatbotAnalytics).not.toHaveBeenCalled();
  });

  it('rejects a request without the management secret', async () => {
    env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD = true;
    const response = await fetch(`${baseUrl}/api/analytics/chatbot?range=7d`);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('CHATBOT_ANALYTICS_UNAUTHORIZED');
  });

  it('rejects unsupported ranges before querying analytics', async () => {
    env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD = true;
    const response = await fetch(`${baseUrl}/api/analytics/chatbot?range=all`, {
      headers: { 'x-chatbot-analytics-secret': 'management-secret' },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('CHATBOT_ANALYTICS_INVALID_RANGE');
    expect(dashboardService.getChatbotAnalytics).not.toHaveBeenCalled();
  });

  it('returns only the prepared aggregate payload to an authorized request', async () => {
    env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD = true;
    dashboardService.getChatbotAnalytics.mockResolvedValue({
      range: '30d', totals: { events: 42 }, kpis: { conversations: 10 }, services: [],
    });
    const response = await fetch(`${baseUrl}/api/analytics/chatbot?range=30d`, {
      headers: { 'x-chatbot-analytics-secret': 'management-secret' },
    });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(dashboardService.getChatbotAnalytics).toHaveBeenCalledWith('30d');
    expect(payload).toEqual({ range: '30d', totals: { events: 42 }, kpis: { conversations: 10 }, services: [] });
    expect(JSON.stringify(payload)).not.toMatch(/phone_hash|customer_id|session_id|correlation_id|metadata/);
  });
});
