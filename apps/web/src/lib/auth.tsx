import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setToken } from './api';
import { setDifficulties } from './format';

export interface SiteUser {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  role: 'user' | 'admin' | 'superadmin';
  bio?: string;
  points: number;
  rating: number;
  solvedCount?: number;
  solved_count?: number;
  submissionCount?: number;
  acceptedCount?: number;
  isPrivate?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
  banner?: string;
  school?: string;
  ccfLevel?: string;
  gender?: number;
  level?: { name: string; index: number; next: number };
}

export interface SiteSettings {
  [key: string]: unknown;
  site_name?: string;
  site_full_name?: string;
  site_description?: string;
  site_logo?: string;
  site_favicon?: string;
  github_url?: string;
  theme_color?: string;
  default_theme_mode?: string;
  enable_dark_mode?: boolean;
  footer_text?: string;
  footer_links?: { label: string; href: string }[];
  home_notice?: string;
  layout_width?: string;
  copyright?: string;
  icp_record?: string;
  police_record?: string;
  maintenance_mode?: boolean;
  maintenance_message?: string;
  allow_register?: boolean;
  allow_submit?: boolean;
  enable_points?: boolean;
  shop_enabled?: boolean;
  show_github_link?: boolean;
  show_problem_tags?: boolean;
  show_rating?: boolean;
  show_others_code?: boolean;
  show_judge_detail?: boolean;
  show_testcase_data?: boolean;
  enable_dark_mode_toggle?: boolean;
}

export interface LanguageMeta {
  id: string;
  name: string;
  editor: string;
  template: string;
  enabled: boolean;
}

export interface Meta {
  settings: SiteSettings;
  difficulties: { value: number; name: string; color: string; colorDark?: string }[];
  languages: LanguageMeta[];
  boards: { slug: string; name: string; description?: string }[];
  judge: { waiting: number; judging: number; concurrency?: number; available?: string[] };
}

interface AuthContextValue {
  user: SiteUser | null;
  profile: any;
  grants: Record<string, number>;
  unread: number;
  ticketUnread: number;
  loading: boolean;
  meta: Meta | null;
  settings: SiteSettings;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  refresh: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  login: (username: string, password: string, remember?: boolean) => Promise<SiteUser>;
  register: (payload: Record<string, unknown>) => Promise<SiteUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return `${parseInt(match[1]!, 16)} ${parseInt(match[2]!, 16)} ${parseInt(match[3]!, 16)}`;
}

function shade(triplet: string, factor: number): string {
  const [r, g, b] = triplet.split(' ').map(Number);
  const mix = (value: number) => Math.round(value + (255 - value) * factor);
  return `${mix(r!)} ${mix(g!)} ${mix(b!)}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SiteUser | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [grants, setGrants] = useState<Record<string, number>>({});
  const [unread, setUnread] = useState(0);
  const [ticketUnread, setTicketUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta | null>(null);

  const settings = meta?.settings ?? {};

  const refreshMeta = useCallback(async () => {
    try {
      const data = await api.get<Meta>('/api/meta');
      setMeta(data);
    } catch {
      /* the site settings fall back to defaults */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<any>('/api/auth/me');
      setUser(data.user);
      setProfile(data.profile);
      setUnread(data.unreadMessages ?? 0);
      setTicketUnread(data.ticketUnread ?? 0);
      setGrants(data.grants ?? {});
    } catch {
      setUser(null);
      setProfile(null);
      setGrants({});
      setUnread(0);
      setTicketUnread(0);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refreshMeta(), refresh()]);
      setLoading(false);
    })();
  }, [refresh, refreshMeta]);

  // Apply the theme colour + document title coming from the system settings.
  useEffect(() => {
    if (!meta) return;
    // 后台改了难度配置后，通过这个事件通知前台刷新
    const onDifficultiesChanged = () => void refreshMeta();
    window.addEventListener('ogoj:difficulties', onDifficultiesChanged);
    return () => window.removeEventListener('ogoj:difficulties', onDifficultiesChanged);
  }, [meta, refreshMeta]);

  useEffect(() => {
    if (!meta) return;
    // 难度等级由后台配置，先同步到本地缓存，供全站的难度名称与配色使用
    setDifficulties(meta.difficulties ?? []);
    const color = hexToRgbTriplet(String(meta.settings.theme_color ?? '#0ea5e9'));
    if (color) {
      document.documentElement.style.setProperty('--ogoj-primary', color);
      document.documentElement.style.setProperty('--ogoj-primary-soft', shade(color, 0.78));
    }
    const name = String(meta.settings.site_name ?? 'OGOJ');
    const full = String(meta.settings.site_full_name ?? 'Oganesson Online Judge');
    document.title = `${name} - ${full}`;
    const favicon = String(meta.settings.site_favicon ?? '');
    if (favicon) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favicon;
    }
  }, [meta]);

  // Follow the server-configured default colour scheme for first-time visitors.
  useEffect(() => {
    if (!meta) return;
    const stored = localStorage.getItem('ogoj-theme');
    if (stored) return;
    const mode = String(meta.settings.default_theme_mode ?? 'light');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = mode === 'dark' || (mode === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
  }, [meta]);

  const login = useCallback(
    async (username: string, password: string, remember = true) => {
      const data = await api.post<{ token: string; user: SiteUser }>('/api/auth/login', {
        username,
        password,
        remember,
      });
      setToken(data.token);
      await refresh();
      return data.user;
    },
    [refresh],
  );

  const register = useCallback(
    async (payload: Record<string, unknown>) => {
      const data = await api.post<{ token: string; user: SiteUser }>('/api/auth/register', payload);
      setToken(data.token);
      await refresh();
      return data.user;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    setProfile(null);
    setGrants({});
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      grants,
      unread,
      ticketUnread,
      loading,
      meta,
      settings,
      isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
      isSuperAdmin: user?.role === 'superadmin',
      refresh,
      refreshMeta,
      login,
      register,
      logout,
    }),
    [user, profile, grants, unread, ticketUnread, loading, meta, settings, refresh, refreshMeta, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('ogoj-theme', next ? 'dark' : 'light');
    setDark(next);
  }, []);
  return { dark, toggle };
}
