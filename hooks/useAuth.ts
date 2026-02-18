import { useState, useEffect, useCallback } from 'react';
import { RuntimeMode } from '../types';
import { getKernelClient, UserInfo } from '../services/kernelClient';

export interface UseAuthReturn {
  authUser: UserInfo | null;
  authChecking: boolean;
  authError: string | null;
  runtimeMode: RuntimeMode;
  setRuntimeMode: React.Dispatch<React.SetStateAction<RuntimeMode>>;
  handleLogin: (username: string, password: string) => Promise<boolean>;
  handleRegister: (username: string, password: string, displayName: string) => Promise<boolean>;
  handleLogout: () => void;
}

export function useAuth(kernelConnected: boolean): UseAuthReturn {
  const [authUser, setAuthUser] = useState<UserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('mock');

  // Check for stored token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('aether_token');
    if (storedToken) {
      const client = getKernelClient();
      client.setToken(storedToken);
      const baseUrl = 'http://localhost:3001';
      fetch(`${baseUrl}/api/kernel`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      })
        .then((res) => {
          if (res.ok) {
            client.reconnect();
            try {
              const parts = storedToken.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                if (payload.sub && payload.username && payload.exp > Date.now()) {
                  const user: UserInfo = {
                    id: payload.sub,
                    username: payload.username,
                    displayName: payload.username,
                    role: payload.role || 'user',
                  };
                  setAuthUser(user);
                  client.setCurrentUser(user);
                }
              }
            } catch {
              // Token decode failed, will need to re-login
            }
          } else {
            localStorage.removeItem('aether_token');
            client.setToken(null);
          }
          setAuthChecking(false);
        })
        .catch(() => {
          setAuthChecking(false);
        });
    } else {
      fetch('http://localhost:3001/health')
        .then((res) => {
          if (res.ok) {
            setRuntimeMode('kernel');
          }
          setAuthChecking(false);
        })
        .catch(() => {
          setAuthChecking(false);
        });
    }
  }, []);

  // Detect kernel availability
  useEffect(() => {
    if (kernelConnected) {
      setRuntimeMode('kernel');
    }
  }, [kernelConnected]);

  const handleLogin = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const client = getKernelClient();
      const result = await client.loginHttp(username, password);
      setAuthUser(result.user);
      setAuthError(null);
      client.reconnect();
      return true;
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const handleRegister = useCallback(
    async (username: string, password: string, displayName: string): Promise<boolean> => {
      try {
        const client = getKernelClient();
        const result = await client.registerHttp(username, password, displayName);
        setAuthUser(result.user);
        setAuthError(null);
        client.reconnect();
        return true;
      } catch (err: unknown) {
        setAuthError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [],
  );

  const handleLogout = useCallback(() => {
    const client = getKernelClient();
    client.logout();
    client.disconnect();
    setAuthUser(null);
  }, []);

  return {
    authUser,
    authChecking,
    authError,
    runtimeMode,
    setRuntimeMode,
    handleLogin,
    handleRegister,
    handleLogout,
  };
}
