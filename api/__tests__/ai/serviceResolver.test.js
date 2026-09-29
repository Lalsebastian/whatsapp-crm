import { describe, it, expect, vi, beforeEach } from 'vitest';

const intentService = require('../../ai/intentService');
intentService.matchServiceToCatalog = vi.fn();
const { resolveService } = require('../../ai/serviceResolver');

const services = [
  { id: 'plumbing', name: 'Plumbing', category: 'plumbing', description: 'Pipe and drain repairs' },
  { id: 'electrical', name: 'Electrical', category: 'electrical', description: 'Lights and wiring' },
  { id: 'ac', name: 'AC Service & Repair', category: 'ac', description: 'Air-conditioning repairs' },
  { id: 'pest', name: 'Pest Control', category: 'pest_control', description: 'Household pest treatment' },
  { id: 'cleaning', name: 'Home Cleaning', category: 'cleaning', description: 'Home and deep cleaning' },
];

describe('hybrid service resolver', () => {
  beforeEach(() => {
    intentService.matchServiceToCatalog.mockReset().mockResolvedValue({ serviceId: null, confidence: 0 });
  });

  it.each([
    ['my kitchen pipe got broken', 'Plumbing'],
    ['ente kitchen pipe potti', 'Plumbing'],
    ['nale plumber venam', 'Plumbing'],
    ['Nale Kakkanad plumber venam', 'Plumbing'],
    ['bedroom light not working', 'Electrical'],
    ['light work aakunnilla', 'Electrical'],
    ['kal electrician chahiye', 'Electrical'],
    ['AC cooling illa', 'AC Service & Repair'],
    ['cockroaches in kitchen', 'Pest Control'],
    ['need deep cleaning for my house', 'Home Cleaning'],
    ['deep cleaning house', 'Home Cleaning'],
  ])('maps "%s" to %s using catalog-validated hints', async (text, expectedName) => {
    const result = await resolveService(text, services);
    expect(result.service.name).toBe(expectedName);
    expect(['deterministic', 'semantic_hint']).toContain(result.source);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(intentService.matchServiceToCatalog).not.toHaveBeenCalled();
  });

  it('uses an exact catalog name before hints or Gemini', async () => {
    const result = await resolveService('Electrical', services);
    expect(result).toMatchObject({ service: { id: 'electrical' }, source: 'deterministic', confidence: 1 });
    expect(intentService.matchServiceToCatalog).not.toHaveBeenCalled();
  });

  it('falls back to Gemini and accepts only the returned live-catalog ID', async () => {
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'electrical', confidence: 0.91 });
    const result = await resolveService('the machine makes a strange buzzing sound', services);
    expect(result).toMatchObject({ service: { id: 'electrical' }, source: 'ai', confidence: 0.91 });
    expect(intentService.matchServiceToCatalog).toHaveBeenCalledWith(
      'the machine makes a strange buzzing sound', services, expect.any(Object)
    );
  });

  it('rejects a Gemini service ID outside the supplied catalog', async () => {
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'invented', confidence: 0.99 });
    await expect(resolveService('something unusual', services)).resolves.toBeNull();
  });
});
