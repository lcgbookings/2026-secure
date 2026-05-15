'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Events Hub</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Leadership Communication Group
          </p>
        </div>

        {status === 'sent' ? (
          <div className="p-6 border border-green-200 bg-green-50 rounded-lg text-center">
            <p className="font-semibold text-green-800">Check your email</p>
            <p className="text-sm text-green-700 mt-2">
              We sent a magic link to {email}. Click it to log in.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@leadershipcommunicationgroup.com"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-2 px-4 bg-neutral-900 text-white rounded-md disabled:opacity-50 hover:bg-neutral-800"
            >
              {status === 'sending' ? 'Sending...' : 'Send magic link'}
            </button>

            {status === 'error' && (
              <p className="text-sm text-red-600">{errorMessage}</p>
            )}
          </form>
        )}

        <p className="text-xs text-center text-neutral-500">
          Internal tool. Access by invitation only.
        </p>
      </div>
    </main>
  );
}
