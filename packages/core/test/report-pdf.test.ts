import { describe, expect, it } from 'vitest';
import { createPdfReport } from '../src/report-pdf.js';

describe('Telegram PDF report', () => {
  it('creates a valid multi-section PDF from report lines', () => {
    const pdf = createPdfReport(['WHITEBOX REPORT', 'Repository: owner/repo', 'Evals: 4/4 passed', ...Array.from({ length: 60 }, (_, i) => `Evidence ${i + 1}`)]);
    expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('WHITEBOX REPORT');
    expect(pdf.toString('latin1')).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(500);
  });
});
