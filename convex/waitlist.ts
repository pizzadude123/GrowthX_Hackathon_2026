import { ConvexError, v } from 'convex/values';
import { mutation } from './_generated/server';
import { normalizeWaitlistEmail } from '../packages/core/src/waitlist.js';

export const join = mutation({
  args: { email: v.string(), website: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.website) throw new ConvexError('Unable to join the waitlist.');
    let email: string;
    try {
      email = normalizeWaitlistEmail(args.email);
    } catch {
      throw new ConvexError('Enter a valid email address.');
    }
    const existing = await ctx.db
      .query('waitlist')
      .withIndex('by_email', (query) => query.eq('email', email))
      .unique();
    if (existing) return { created: false };
    await ctx.db.insert('waitlist', {
      email,
      source: 'cloudflare-homepage',
      joinedAt: Date.now(),
    });
    return { created: true };
  },
});
