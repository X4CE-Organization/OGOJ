import { useEffect, useState } from 'react';
import { Github, KeyRound, Link2 } from 'lucide-react';
import { api } from '../lib/api';
import { classNames } from '../lib/format';

interface Provider {
  id: string;
  name: string;
  bindUrl: string;
  loginUrl: string;
}

let cache: Provider[] | null = null;

const ICONS: Record<string, any> = { github: Github, gitee: KeyRound, google: KeyRound, custom: KeyRound };

export function useOAuthProviders(): Provider[] {
  const [providers, setProviders] = useState<Provider[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    api
      .get<{ providers: Provider[]; enabled: boolean; showOnLogin: boolean }>('/api/auth/oauth/providers')
      .then((data) => {
        cache = data.providers;
        setProviders(data.providers);
      })
      .catch(() => undefined);
  }, []);
  return providers;
}

export default function OAuthButtons({
  bind = false,
  redirect,
  className,
}: {
  bind?: boolean;
  redirect?: string;
  className?: string;
}) {
  const providers = useOAuthProviders();
  if (!providers.length) return null;

  return (
    <div className={classNames('space-y-2', className)}>
      {providers.map((provider) => {
        const Icon = ICONS[provider.id] ?? KeyRound;
        const href = `${bind ? provider.bindUrl : provider.loginUrl}${
          redirect ? `${bind ? '&' : '?'}redirect=${encodeURIComponent(redirect)}` : ''
        }`;
        return (
          <a key={provider.id} href={href} className="btn-ghost w-full">
            {bind ? <Link2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            {bind ? `绑定 ${provider.name}` : `使用 ${provider.name} 登录`}
          </a>
        );
      })}
    </div>
  );
}
