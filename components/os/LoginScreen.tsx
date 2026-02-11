import React, { useState, useRef, useEffect } from 'react';
import { Lock, User, ArrowRight, AlertCircle, UserPlus } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister?: (username: string, password: string, displayName: string) => Promise<boolean>;
  registrationOpen?: boolean;
  error?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  onRegister,
  registrationOpen = true,
  error: externalError,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (externalError) {
      setError(externalError);
      triggerShake();
    }
  }, [externalError]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      let success: boolean;
      if (isRegister && onRegister) {
        success = await onRegister(
          username.trim(),
          password,
          displayName.trim() || username.trim(),
        );
      } else {
        success = await onLogin(username.trim(), password);
      }

      if (!success) {
        setError(
          isRegister
            ? 'Registration failed. Username may already exist.'
            : 'Invalid username or password.',
        );
        triggerShake();
      }
    } catch (err: any) {
      setError(err.message || 'Connection error');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2670&auto=format&fit=crop')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dimmed overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Login card */}
      <div
        className={`relative z-10 w-full max-w-sm mx-auto px-4 transition-transform ${
          shake ? 'animate-[shake_0.5s_ease-in-out]' : ''
        }`}
      >
        {/* Glass card */}
        <div className="bg-white/10 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="pt-10 pb-6 text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-indigo-500/80 to-purple-600/80 border-2 border-white/20 flex items-center justify-center shadow-xl shadow-indigo-500/20">
              <span className="text-3xl select-none">&#9678;</span>
            </div>
            <h1 className="text-white text-xl font-light tracking-wide">Aether OS</h1>
            <p className="text-white/50 text-xs mt-1">
              {isRegister ? 'Create your account' : 'Sign in to continue'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-4">
            {/* Username */}
            <div
              className={`relative transition-all duration-200 ${focusedField === 'username' ? 'scale-[1.02]' : ''}`}
            >
              <div
                className={`flex items-center bg-white/10 rounded-xl border transition-colors ${
                  focusedField === 'username' ? 'border-indigo-400/50' : 'border-white/10'
                }`}
              >
                <User size={16} className="ml-4 text-white/40 shrink-0" />
                <input
                  ref={usernameRef}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Username"
                  className="w-full bg-transparent text-white text-sm px-3 py-3 outline-none placeholder-white/30"
                  autoComplete="username"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Display Name (register only) */}
            {isRegister && (
              <div
                className={`relative transition-all duration-200 ${focusedField === 'displayName' ? 'scale-[1.02]' : ''}`}
              >
                <div
                  className={`flex items-center bg-white/10 rounded-xl border transition-colors ${
                    focusedField === 'displayName' ? 'border-indigo-400/50' : 'border-white/10'
                  }`}
                >
                  <UserPlus size={16} className="ml-4 text-white/40 shrink-0" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onFocus={() => setFocusedField('displayName')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Display Name (optional)"
                    className="w-full bg-transparent text-white text-sm px-3 py-3 outline-none placeholder-white/30"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {/* Password */}
            <div
              className={`relative transition-all duration-200 ${focusedField === 'password' ? 'scale-[1.02]' : ''}`}
            >
              <div
                className={`flex items-center bg-white/10 rounded-xl border transition-colors ${
                  focusedField === 'password' ? 'border-indigo-400/50' : 'border-white/10'
                }`}
              >
                <Lock size={16} className="ml-4 text-white/40 shrink-0" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Password"
                  className="w-full bg-transparent text-white text-sm px-3 py-3 outline-none placeholder-white/30"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  disabled={loading}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-red-300 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 animate-fade-in">
                <AlertCircle size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 disabled:bg-white/5 disabled:opacity-50 text-white py-3 rounded-xl font-medium text-sm transition-all duration-200 border border-white/10 hover:border-white/20 active:scale-[0.98]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isRegister ? 'Create Account' : 'Log In'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            {/* Toggle register/login */}
            {registrationOpen && onRegister && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setError(null);
                  }}
                  className="text-white/40 hover:text-white/70 text-xs transition-colors"
                >
                  {isRegister ? 'Already have an account? Log In' : 'Create Account'}
                </button>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Shake animation keyframes */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-4px); }
          30%, 70% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
};
