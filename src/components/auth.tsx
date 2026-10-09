'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, STATUS_QUERY_KEY } from '@/lib/client-api';
import { DEFAULT_SITE, type SiteSettings } from '@/lib/site-config-types';

interface AuthContextValue {
  site: SiteSettings;
  checked: boolean;
  verified: boolean;
  setupRequired: boolean;
  version: string | null;
  openLogin: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  site: DEFAULT_SITE, checked: false, verified: true, setupRequired: false,
  version: null, openLogin: () => {}, logout: async () => {},
});

export function useAuth(): AuthContextValue { return useContext(AuthContext); }

/** 前台公开访问；此上下文只加载网站信息，后台自行校验管理密钥。 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteSettings>(DEFAULT_SITE);
  const [checked, setChecked] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() })
      .then((status) => {
        if (cancelled) return;
        setSite(status.site ?? DEFAULT_SITE); setVersion(status.version);
      })
      .finally(() => { if (!cancelled) setChecked(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [queryClient]);

  return <AuthContext.Provider value={{ site, checked, verified: true, setupRequired: false,
    version, openLogin: () => {}, logout: async () => {} }}>{children}</AuthContext.Provider>;
}
