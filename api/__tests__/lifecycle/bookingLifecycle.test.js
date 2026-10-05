import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const request = require('supertest');
const env = require('../../config/env');
const { computeSignature } = require('../../utils/signature');

const db = require('../../db/supabaseClient');
db.insert = vi.fn();
db.patch = vi.fn();
db.remove = vi.fn();
db.get = vi.fn();

const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.getBookingById = vi.fn();
fakeCrm.getBookingStatus = vi.fn();
fakeCrm.getCustomerById = vi.fn();
fakeCrm.getServiceDetails = vi.fn();
fakeCrm.getFeedbackForBooking = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendTemplate = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.getOrCreateSession = vi.fn();
sessionStore.setFlow = vi.fn();

const serviceWindow = require('../../whatsapp/serviceWindow');
serviceWindow.isWithinServiceWindow = vi.fn();

const lifecycle = require('../../lifecycle/bookingLifecycle');
const { parseCrmEventBody } = require('../../lifecycle/eventNormalizer');
const { createApp } = require('../../app');

const SECRET = 'crm-webhook-secret';
const originalEnv = {
  secret: env.CRM_WEBHOOK_SECRET,
  assigned: env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED,
  onTheWay: env.WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY,
  feedback: env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST,
};

const booking = (overrides = {}) => ({
  id: 'bk-1', reference: 'BK-ABC234', customerId: 'cust-1', serviceId: 'svc-1',
  scheduledDate: '2026-10-12', scheduledTime: '09:00:00', status: 'confirmed', ...overrides,
});
const customer = { id: 'cust-1', phone: '971500000001', name: 'Aisha Khan' };
const idleSession = (overrides = {}) => ({
  phone: customer.phone, currentFlow: null, currentStep: null, context: {}, humanTakeover: false,
  lastActivityAt: new Date().toISOString(), ...overrides,
});

function event(overrides = {}) {
  return { id: 'evt-1', type: 'booking.assigned', bookingId: 'bk-1', technicianName: 'Ravi', ...overrides };
}

describe('booking lifecycle events', () => {
  beforeEach(() => {
    [db.insert, db.patch, db.remove, db.get, fakeCrm.getBookingById, fakeCrm.getBookingStatus, fakeCrm.getCustomerById,
      fakeCrm.getServiceDetails, fakeCrm.getFeedbackForBooking, whatsapp.sendText, whatsapp.sendButtons,
      whatsapp.sendTemplate, sessionStore.getOrCreateSession, sessionStore.setFlow, serviceWindow.isWithinServiceWindow]
      .forEach((fn) => fn.mockReset());
    lifecycle.clearForTests();
    db.insert.mockResolvedValue(null);
    db.patch.mockResolvedValue([]);
    fakeCrm.getBookingById.mockResolvedValue(booking());
    fakeCrm.getCustomerById.mockResolvedValue(customer);
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc-1', name: 'AC Service' });
    fakeCrm.getFeedbackForBooking.mockResolvedValue(null);
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession());
    serviceWindow.isWithinServiceWindow.mockResolvedValue(true);
    env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED = '';
    env.WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY = '';
    env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST = '';
  });

  afterAll(() => {
    env.CRM_WEBHOOK_SECRET = originalEnv.secret;
    env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED = originalEnv.assigned;
    env.WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY = originalEnv.onTheWay;
    env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST = originalEnv.feedback;
  });

  describe('technician assigned', () => {
    it('tells the customer who was assigned, using CRM booking data, inside the service window', async () => {
      const outcome = await lifecycle.processLifecycleEvent(event());

      expect(outcome).toEqual({ status: 'processed' });
      const [phone, text] = whatsapp.sendText.mock.calls[0];
      expect(phone).toBe('971500000001');
      expect(text).toContain('Good news, Aisha!');
      expect(text).toContain('Ravi has been assigned');
      expect(text).toContain('AC Service booking (BK-ABC234)');
      expect(text).toContain('Monday, 12 October at 9:00 AM');
      expect(db.patch).toHaveBeenCalledWith('chatbot_crm_events', 'event_id=eq.evt-1', expect.objectContaining({ status: 'processed' }));
    });

    it('never invents a technician name the CRM did not send', async () => {
      await lifecycle.processLifecycleEvent(event({ technicianName: null }));
      expect(whatsapp.sendText.mock.calls[0][1]).toContain('A technician has been assigned');
    });

    it('uses the approved template outside the 24-hour window', async () => {
      serviceWindow.isWithinServiceWindow.mockResolvedValue(false);
      env.WHATSAPP_TEMPLATE_BOOKING_ASSIGNED = 'booking_assigned_v1';

      const outcome = await lifecycle.processLifecycleEvent(event());

      expect(outcome.status).toBe('processed');
      expect(whatsapp.sendText).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).toHaveBeenCalledWith('971500000001', expect.objectContaining({
        name: 'booking_assigned_v1',
        bodyParams: ['Aisha', 'Ravi', 'AC Service', 'Monday, 12 October', '9:00 AM', 'BK-ABC234'],
      }));
    });

    it('skips (rather than sending a message WhatsApp would drop) outside the window with no template', async () => {
      serviceWindow.isWithinServiceWindow.mockResolvedValue(false);

      const outcome = await lifecycle.processLifecycleEvent(event());

      expect(outcome).toEqual({ status: 'skipped', reason: 'outside_service_window_no_template' });
      expect(whatsapp.sendText).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });
  });

  describe('technician on the way', () => {
    it('includes the CRM ETA in business time', async () => {
      await lifecycle.processLifecycleEvent(event({
        id: 'evt-otw', type: 'booking.on_the_way', eta: '2026-10-12T05:45:00.000Z',
      }));
      expect(whatsapp.sendText.mock.calls[0][1]).toBe(
        'Ravi is on the way for your AC Service booking (BK-ABC234). Estimated arrival: around 9:45 AM.'
      );
    });

    it('states minutes when the CRM sends a relative ETA, and nothing when it sends none', async () => {
      await lifecycle.processLifecycleEvent(event({ id: 'evt-otw-2', type: 'booking.on_the_way', etaMinutes: 20 }));
      await lifecycle.processLifecycleEvent(event({ id: 'evt-otw-3', type: 'booking.on_the_way' }));
      expect(whatsapp.sendText.mock.calls[0][1]).toContain('in about 20 minutes');
      expect(whatsapp.sendText.mock.calls[1][1]).not.toContain('Estimated arrival');
    });
  });

  describe('job completed', () => {
    beforeEach(() => {
      fakeCrm.getBookingById.mockResolvedValue(booking({ status: 'completed' }));
    });

    it('starts the existing feedback flow with an extended reply window', async () => {
      const outcome = await lifecycle.processLifecycleEvent(event({ id: 'evt-done', type: 'booking.completed' }));

      expect(outcome).toEqual({ status: 'processed' });
      expect(whatsapp.sendButtons).toHaveBeenCalledWith(
        '971500000001',
        expect.stringContaining('How would you rate your experience?'),
        expect.arrayContaining([expect.objectContaining({ id: 'RATING_5' })])
      );
      expect(sessionStore.setFlow).toHaveBeenCalledWith('971500000001', 'feedback', 'select_rating', expect.objectContaining({
        flowTtlMinutes: env.FEEDBACK_REQUEST_TTL_HOURS * 60,
      }));
    });

    it('sends the feedback template with rating quick replies outside the window', async () => {
      serviceWindow.isWithinServiceWindow.mockResolvedValue(false);
      env.WHATSAPP_TEMPLATE_FEEDBACK_REQUEST = 'feedback_request_v1';

      await lifecycle.processLifecycleEvent(event({ id: 'evt-done-tpl', type: 'booking.completed' }));

      expect(whatsapp.sendTemplate).toHaveBeenCalledWith('971500000001', expect.objectContaining({
        name: 'feedback_request_v1',
        bodyParams: ['Aisha Khan', 'AC Service'],
        quickReplyPayloads: ['RATING_5', 'RATING_4', 'RATING_MORE'],
      }));
      expect(sessionStore.setFlow).toHaveBeenCalledWith('971500000001', 'feedback', 'select_rating', expect.anything());
    });

    it('does not start feedback when the CRM booking itself is not completed', async () => {
      fakeCrm.getBookingById.mockResolvedValue(booking({ status: 'in_progress' }));

      const outcome = await lifecycle.processLifecycleEvent(event({ id: 'evt-early', type: 'booking.completed' }));

      expect(outcome).toEqual({ status: 'skipped', reason: 'crm_booking_not_completed' });
      expect(whatsapp.sendButtons).not.toHaveBeenCalled();
    });

    it('does not interrupt a customer who is in the middle of another flow', async () => {
      sessionStore.getOrCreateSession.mockResolvedValue(idleSession({ currentFlow: 'booking', currentStep: 'select_date' }));

      const outcome = await lifecycle.processLifecycleEvent(event({ id: 'evt-busy', type: 'booking.completed' }));

      expect(outcome).toEqual({ status: 'skipped', reason: 'customer_in_active_flow' });
      expect(sessionStore.setFlow).not.toHaveBeenCalled();
    });

    it('stays silent while a human agent has taken over the conversation', async () => {
      sessionStore.getOrCreateSession.mockResolvedValue(idleSession({ humanTakeover: true }));
      const outcome = await lifecycle.processLifecycleEvent(event({ id: 'evt-human', type: 'booking.completed' }));
      expect(outcome).toEqual({ status: 'skipped', reason: 'human_takeover_active' });
    });
  });

  describe('safety and idempotency', () => {
    it('processes a redelivered event id only once', async () => {
      db.insert.mockResolvedValueOnce(null)
        .mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409, data: { code: '23505' } } }));

      const first = await lifecycle.processLifecycleEvent(event());
      const second = await lifecycle.processLifecycleEvent(event());

      expect(first.status).toBe('processed');
      expect(second).toEqual({ status: 'duplicate' });
      expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    });

    it('falls back to process-local dedupe when the events table is missing', async () => {
      db.insert.mockRejectedValue(Object.assign(new Error('missing'), { response: { status: 404, data: { code: '42P01' } } }));

      await lifecycle.processLifecycleEvent(event({ id: 'evt-local' }));
      const second = await lifecycle.processLifecycleEvent(event({ id: 'evt-local' }));

      expect(second).toEqual({ status: 'duplicate' });
      expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    });

    it('releases the claim on a transient failure so the CRM retry is processed', async () => {
      whatsapp.sendText.mockRejectedValueOnce(Object.assign(new Error('Meta 503'), { response: { status: 503 } }));

      await expect(lifecycle.processLifecycleEvent(event({ id: 'evt-retry' }))).rejects.toThrow('Meta 503');
      expect(db.remove).toHaveBeenCalledWith('chatbot_crm_events', 'event_id=eq.evt-retry');
    });

    it('ignores events for unknown or cancelled bookings', async () => {
      fakeCrm.getBookingById.mockResolvedValueOnce(null).mockResolvedValueOnce(booking({ status: 'cancelled' }));

      expect(await lifecycle.processLifecycleEvent(event({ id: 'evt-unknown' }))).toEqual({ status: 'skipped', reason: 'booking_not_found' });
      expect(await lifecycle.processLifecycleEvent(event({ id: 'evt-cancelled' }))).toEqual({ status: 'skipped', reason: 'booking_cancelled' });
      expect(whatsapp.sendText).not.toHaveBeenCalled();
    });

    it('looks a booking up by reference when the CRM sends no id', async () => {
      fakeCrm.getBookingStatus.mockResolvedValue(booking());
      await lifecycle.processLifecycleEvent(event({ id: 'evt-ref', bookingId: null, bookingReference: 'BK-ABC234' }));
      expect(fakeCrm.getBookingStatus).toHaveBeenCalledWith('BK-ABC234');
    });
  });
});

describe('CRM event normalization', () => {
  it('accepts the documented event shape and aliases', () => {
    const { events, rejected } = parseCrmEventBody({
      events: [
        { id: 'e1', type: 'booking.assigned', booking: { id: 'b1', reference: 'BK-1' }, technician: { name: 'Ravi' } },
        { eventId: 'e2', event: 'technician_on_the_way', bookingId: 'b1', etaMinutes: '15' },
        { id: 'e3', status: 'completed', booking_id: 'b1' },
        { id: 'e4', type: 'booking.invoiced', bookingId: 'b1' },
        { id: 'e5', type: 'booking.completed' },
      ],
    });
    expect(events.map((item) => [item.id, item.type])).toEqual([
      ['e1', 'booking.assigned'], ['e2', 'booking.on_the_way'], ['e3', 'booking.completed'],
    ]);
    expect(events[0].technicianName).toBe('Ravi');
    expect(events[1].etaMinutes).toBe(15);
    expect(rejected).toEqual([
      { index: 3, error: 'unsupported_event_type' },
      { index: 4, error: 'booking_identifier_missing' },
    ]);
  });

  it('derives a stable id when the CRM sends none, so retries still dedupe', () => {
    const body = { type: 'booking.completed', bookingId: 'b1', occurredAt: '2026-10-12T10:00:00Z' };
    expect(parseCrmEventBody(body).events[0].id).toBe(parseCrmEventBody({ ...body }).events[0].id);
  });

  it('translates Supabase database webhooks for the bundled dashboard', () => {
    const { events } = parseCrmEventBody({
      type: 'UPDATE',
      table: 'bookings',
      record: { id: 'b1', technician_id: 't1', status: 'completed', updated_at: '2026-10-12T10:00:00Z' },
      old_record: { id: 'b1', technician_id: null, status: 'in_progress' },
    });
    expect(events.map((item) => item.type)).toEqual(['booking.assigned', 'booking.completed']);
    expect(events[0].technicianId).toBe('t1');
  });

  it('produces no events for unrelated booking updates', () => {
    const { events, rejected } = parseCrmEventBody({
      type: 'UPDATE', table: 'bookings',
      record: { id: 'b1', status: 'confirmed', agent_notes: 'call first' },
      old_record: { id: 'b1', status: 'confirmed' },
    });
    expect(events).toEqual([]);
    expect(rejected).toEqual([]);
  });
});

describe('POST /api/crm/events', () => {
  const app = createApp();
  const processSpy = vi.spyOn(lifecycle, 'processLifecycleEvent');

  beforeEach(() => {
    env.CRM_WEBHOOK_SECRET = SECRET;
    processSpy.mockReset();
    processSpy.mockResolvedValue({ status: 'processed' });
  });

  function signed(body, secret = SECRET) {
    const raw = JSON.stringify(body);
    return request(app)
      .post('/api/crm/events')
      .set('Content-Type', 'application/json')
      .set('X-CRM-Signature', `sha256=${computeSignature(secret, Buffer.from(raw))}`)
      .send(raw);
  }

  it('is disabled (404) until a webhook secret is configured', async () => {
    env.CRM_WEBHOOK_SECRET = '';
    const response = await request(app).post('/api/crm/events').send({ type: 'booking.completed', bookingId: 'b1' });
    expect(response.status).toBe(404);
  });

  it('accepts an HMAC-signed event and reports its outcome', async () => {
    const response = await signed({ id: 'e1', type: 'booking.completed', bookingId: 'b1' });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ id: 'e1', type: 'booking.completed', status: 'processed' }]);
  });

  it('accepts a bearer secret for senders that cannot sign', async () => {
    const response = await request(app)
      .post('/api/crm/events')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ id: 'e2', type: 'booking.assigned', bookingId: 'b1' });
    expect(response.status).toBe(200);
  });

  it('rejects a wrong signature or token without processing', async () => {
    const badSignature = await signed({ id: 'e3', type: 'booking.completed', bookingId: 'b1' }, 'wrong');
    const badToken = await request(app).post('/api/crm/events').set('Authorization', 'Bearer wrong')
      .send({ id: 'e3', type: 'booking.completed', bookingId: 'b1' });
    const none = await request(app).post('/api/crm/events').send({ id: 'e3', type: 'booking.completed', bookingId: 'b1' });
    expect([badSignature.status, badToken.status, none.status]).toEqual([401, 401, 401]);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when nothing in the body is a supported event', async () => {
    const response = await signed({ id: 'e4', type: 'booking.invoiced', bookingId: 'b1' });
    expect(response.status).toBe(400);
  });

  it('returns 503 so the CRM retries when processing fails transiently', async () => {
    processSpy.mockRejectedValueOnce(new Error('timeout'));
    const response = await signed({ id: 'e5', type: 'booking.completed', bookingId: 'b1' });
    expect(response.status).toBe(503);
    expect(response.body.results[0].status).toBe('failed');
  });
});
