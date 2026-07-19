import { describe,expect,it } from 'vitest';
import { assertTerminalMutationAllowed,completionReplay,deliveryLegTransition,expiredDeliveryDisposition } from './attempt_lifecycle.js';

describe('attempt, completion, and delivery lifecycle',()=>{
 it('accepts exact response-loss replay and rejects a conflicting result',()=>{expect(completionReplay(undefined,'a')).toBe('first');expect(completionReplay('a','a')).toBe('replay');expect(()=>completionReplay('a','b')).toThrow('Conflicting');});
 it('keeps every terminal state monotonic',()=>{for(const status of ['audit_only','partial','completed','cancelled','blocked','failed'])expect(()=>assertTerminalMutationAllowed(status)).toThrow('immutable');expect(()=>assertTerminalMutationAllowed('queued','digest')).toThrow('immutable');expect(()=>assertTerminalMutationAllowed('queued')).not.toThrow();});
 it('does not resend an ambiguous expired delivery leg',()=>{expect(expiredDeliveryDisposition('sending','pending')).toEqual({reclaim:false,terminal:true,code:'ambiguous_send'});expect(expiredDeliveryDisposition('delivered','pending')).toEqual({reclaim:true,terminal:false});});
 it('makes leg receipts replay-safe and conflict-closed',()=>{expect(deliveryLegTransition('pending','sending',undefined)).toBe('sending');expect(deliveryLegTransition('sending','delivered',undefined,'42')).toBe('delivered');expect(deliveryLegTransition('delivered','delivered','42','42')).toBe('replay');expect(()=>deliveryLegTransition('delivered','delivered','42','43')).toThrow('Conflicting');});
});
