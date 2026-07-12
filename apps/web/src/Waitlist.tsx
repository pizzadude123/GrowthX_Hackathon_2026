import { FormEvent, useState } from 'react';
import { makeFunctionReference } from 'convex/server';
import { useMutation } from 'convex/react';
import './waitlist.css';

const joinWaitlist = makeFunctionReference<'mutation'>('waitlist:join');

type JoinResult = { created: boolean };

function LogicLens() {
  return (
    <div className="waitlist-visual" aria-label="Whitebox mapping a code logic break">
      <div className="waitlist-code-window">
        <div className="waitlist-code-top">
          <span><i /><i /><i /></span><b>workspace-sync.ts</b><em>WHITEBOX ACTIVE</em>
        </div>
        <div className="waitlist-code-body">
          <div className="waitlist-scan-line" />
          <p><small>01</small><span><u>async function</u> syncWorkspace(user) {'{'}</span></p>
          <p><small>02</small><span>&nbsp;&nbsp;<u>const</u> policy = <b>await</b> getPolicy(user);</span></p>
          <p><small>03</small><span>&nbsp;&nbsp;<u>if</u> (!policy) {'{'}</span></p>
          <p className="flagged"><small>04</small><span>&nbsp;&nbsp;&nbsp;&nbsp;<mark>return queue.push(user.id);</mark></span><strong>LOGIC BREAK</strong></p>
          <p><small>05</small><span>&nbsp;&nbsp;{'}'}</span></p>
          <p className="resolved"><small>06</small><span>&nbsp;&nbsp;<u>return</u> sync(user, policy);</span><strong>CONTEXT LINKED</strong></p>
          <p><small>07</small><span>{'}'}</span></p>
        </div>
        <div className="waitlist-code-status"><span><i /> FULL CONTEXT LOADED</span><b>FALLACY 04 RESOLVED</b></div>
      </div>
    </div>
  );
}

export default function WaitlistLanding() {
  const join = useMutation(joinWaitlist);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await join({ email, website }) as JoinResult;
      setDone(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('valid email') ? 'Enter a valid email address.' : 'Could not join right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="waitlist-page" id="top">
      <nav className="waitlist-nav">
        <a className="waitlist-wordmark" href="#top">WHITEBOX<span>®</span></a>
        <p>LOGIC FOR CODEBASES</p>
        <button onClick={() => setOpen(true)}>JOIN WAITLIST <i>↗</i></button>
      </nav>

      <section className="waitlist-hero">
        <div className="waitlist-copy">
          <p className="waitlist-index">01 / THE LOGIC LAYER</p>
          <h1><span>MAKE CODE</span><span>MAKE SENSE.</span></h1>
          <p className="waitlist-description">A living logic layer that understands your codebase, exposes hidden fallacies, and keeps every agent working from the same truth.</p>
          <div className="waitlist-proof"><span><b>01</b> Full context</span><span><b>02</b> Living schema</span><span><b>03</b> Agent native</span></div>
          <button className="waitlist-action" onClick={() => setOpen(true)}><span>REQUEST EARLY ACCESS</span><b>→</b></button>
        </div>
        <div className="waitlist-stage"><LogicLens /></div>
      </section>

      <footer className="waitlist-footer"><span>DETECT</span><i /><span>MAP</span><i /><span>GOVERN</span><p>PRIVATE ALPHA · 2026</p></footer>

      <section className={`waitlist-panel ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Join the Whitebox waitlist">
        <button className="waitlist-close" onClick={() => setOpen(false)} aria-label="Close waitlist">×</button>
        <div><p>EARLY ACCESS / 01</p><h2>{done ? "YOU'RE IN." : 'BUILD WHAT\nKEEPS WORKING.'}</h2></div>
        {done ? (
          <p className="waitlist-confirmation" role="status">We’ll be in touch when Whitebox is ready for your codebase.</p>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="waitlist-email">WORK EMAIL</label>
            <input className="waitlist-honeypot" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(event) => setWebsite(event.target.value)} />
            <div><input id="waitlist-email" type="email" required disabled={submitting} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="YOU@COMPANY.COM" /><button disabled={submitting}>{submitting ? 'JOINING…' : 'JOIN'} <span>→</span></button></div>
            {error && <p className="waitlist-error" role="alert">{error}</p>}
            <small>FOUNDING ENGINEERING TEAMS FIRST. NO SPAM.</small>
          </form>
        )}
      </section>
    </div>
  );
}
