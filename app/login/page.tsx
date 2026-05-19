'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const INPUT_CLASSES =
  'mt-1 w-full border border-lcg-deep-teal/15 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:border-lcg-teal focus:ring-1 focus:ring-lcg-teal/20';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMessage('');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-lcg-cream">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="lcg-eyebrow mb-3">Leadership Communication Group</span>
          <h1 className="font-serif text-3xl text-lcg-deep-teal">Events Hub</h1>
          <p className="text-sm text-lcg-body-muted mt-2">Sign in to continue</p>
        </div>

        <div className="lcg-card p-8">
          {status === 'sent' ? (
            <div className="text-center">
              <p className="font-serif text-lg text-lcg-deep-teal">Check your email</p>
              <p className="text-sm text-lcg-body-muted mt-2">
                We sent a magic link to{' '}
                <span className="text-lcg-deep-teal font-medium">{email}</span>. Click it
                to log in.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-xs text-lcg-deep-teal/60 uppercase tracking-wide">
                  Email
                </span>
                <input
                  type="email"
                  required
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@leadershipcommunicationgroup.com"
                  className={INPUT_CLASSES}
                />
              </label>

              <button
                type="submit"
                disabled={status === 'sending'}
                className={`lcg-btn-primary w-full mt-6 ${
                  status === 'sending' ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                {status === 'sending' ? 'Sending...' : 'Send magic link'}
              </button>

              {status === 'error' && (
                <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {errorMessage}
                </p>
              )}
            </form>
          )}
        </div>

        <p className="text-xs text-lcg-body-muted text-center mt-6">
          Authorised admins only. Magic link will be emailed to you.
        </p>
      </div>
    </main>
  );
}
