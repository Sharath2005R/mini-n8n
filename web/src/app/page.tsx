// web/src/app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSignInEmailPassword, useSignUpEmailPassword, useAuthenticationStatus } from '@nhost/nextjs';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); // User's name for sign up
  const [message, setMessage] = useState('');
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const { signInEmailPassword, isLoading: signInLoading, error: signInError, isSuccess: signInSuccess } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signUpLoading, error: signUpError, isSuccess: signUpSuccess } = useSignUpEmailPassword();
  const { isAuthenticated, isLoading: authCheckLoading } = useAuthenticationStatus();

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated && hasMounted) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, hasMounted, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    if (!email || !password) {
      setMessage('Please fill in all fields.');
      return;
    }

    if (isSignUp) {
      const res = await signUpEmailPassword(email, password, {
        displayName: name || email.split('@')[0],
        metadata: {}
      });
      if (res.error) {
        setMessage(res.error.message);
      } else {
        setMessage('Sign up successful! You can now sign in.');
        setIsSignUp(false);
      }
    } else {
      const res = await signInEmailPassword(email, password);
      if (res.error) {
        setMessage(res.error.message);
      }
    }
  };

  if (!hasMounted || authCheckLoading) {
    return (
      <div className="flex flex-col align-center justify-between p-24 text-center" style={{ margin: 'auto' }}>
        <div className="brand" style={{ fontSize: '2rem', marginBottom: '24px' }}>
          AI Agent<span>Workflow</span>
        </div>
        <p className="text-muted">Loading authentication status...</p>
      </div>
    );
  }

  const isLoading = signInLoading || signUpLoading;
  const errorMsg = isSignUp ? signUpError?.message : signInError?.message;

  return (
    <div className="auth-layout">
      {/* Floating Glowing Orbs */}
      <div className="glow-orb" style={{ top: '10%', left: '10%', width: '300px', height: '300px', background: 'var(--primary)' }} />
      <div className="glow-orb" style={{ bottom: '15%', right: '10%', width: '350px', height: '350px', background: '#06b6d4' }} />

      {/* Left Panel: Branding & Visuals */}
      <div className="auth-hero-panel">
        <div style={{ maxWidth: '520px' }}>
          <div className="brand" style={{ fontSize: '2.2rem', marginBottom: '16px' }}>
            AI Agent<span>Workflow</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.15, marginBottom: '24px', background: 'linear-gradient(135deg, #fff 0%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Build AI-driven automations in seconds.
          </h1>
          <p className="text-muted" style={{ fontSize: '1.05rem', lineHeight: 1.6, marginBottom: '32px' }}>
            Connect Gemini AI, APIs, database actions, and manual approval gates in a unified drag-and-drop workflow canvas.
          </p>

          {/* Interactive Visual Node Diagram Demo */}
          <div className="hero-visual-container">
            <div className="hero-node-row" style={{ borderLeft: '3px solid #8b5cf6' }}>
              <div className="hero-node-dot" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>🤖 LLM Classification</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Classify support tickets using Gemini 2.5</div>
              </div>
            </div>
            <div style={{ height: '16px', borderLeft: '2px dotted rgba(255,255,255,0.1)', marginLeft: '19px', margin: '4px 0 4px 19px' }} />
            <div className="hero-node-row" style={{ borderLeft: '3px solid #f59e0b' }}>
              <div className="hero-node-dot" style={{ background: '#f59e0b', boxShadow: '0 0 8px #f59e0b' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>🔀 Branching Logic</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Route workflow based on issue category</div>
              </div>
            </div>
            <div style={{ height: '16px', borderLeft: '2px dotted rgba(255,255,255,0.1)', marginLeft: '19px', margin: '4px 0 4px 19px' }} />
            <div className="hero-node-row" style={{ borderLeft: '3px solid #ef4444' }}>
              <div className="hero-node-dot" style={{ background: '#ef4444', boxShadow: '0 0 8px #ef4444' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>⏸️ Human-in-the-Loop</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Approval gate for refund requests</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel: Form Card */}
      <div className="auth-form-panel">
        <div className="glass-card" style={{ maxWidth: '420px', width: '100%', padding: '40px 32px', zIndex: 1, boxShadow: '0 20px 40px rgba(0,0,0,0.4), 0 0 1px 1px rgba(255,255,255,0.08)' }}>
          <div className="brand" style={{ fontSize: '1.6rem', justifyContent: 'center', marginBottom: '28px', display: 'none' }}>
            AI Agent<span>Workflow</span>
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, textAlign: 'center', marginBottom: '24px', letterSpacing: '-0.02em' }}>
            {isSignUp ? 'Create your account' : 'Sign in to your account'}
          </h2>

          {(message || errorMsg) && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#fca5a5',
              fontSize: '0.85rem',
              marginBottom: '20px'
            }}>
              {message || errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {isSignUp && (
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="input-field"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label className="form-label" style={{ margin: 0 }}>Password</label>
              </div>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '20px' }} disabled={isLoading}>
              {isLoading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <p className="text-muted text-center" style={{ fontSize: '0.85rem' }}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <span
              onClick={() => {
                setIsSignUp(!isSignUp);
                setMessage('');
              }}
              style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
            >
              {isSignUp ? 'Sign In' : 'Create Account'}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
