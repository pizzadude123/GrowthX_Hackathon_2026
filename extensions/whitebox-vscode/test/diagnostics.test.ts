import { describe, expect, it } from 'vitest';
import { activeDiagnostics } from '../src/diagnostics.js';

describe('Whitebox Blocks diagnostics', () => {
  it('renders only verified or human-review, high-confidence medium+ findings', () => {
    const rows = [
      { status: 'verified', confidence: .9, severity: 'error' },
      { status: 'rejected', confidence: .99, severity: 'error' },
      { status: 'proposed', confidence: .4, severity: 'warning' }
    ];
    expect(activeDiagnostics(rows)).toEqual([rows[0]]);
  });
});
