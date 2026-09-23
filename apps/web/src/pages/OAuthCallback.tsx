import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/ui';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      const token = params.get('token');
      const bound = params.get('bound');
      const error = params.get('error');
      const redirect = params.get('redirect') || '/';

      if (error) {
        setStatus('error');
        setMessage(error);
        return;
      }
      if (token) {
        setToken(token);
        await refresh();
        setStatus('ok');
        setMessage('登录成功，正在跳转…');
        window.history.replaceState({}, '', '/oauth/callback');
        setTimeout(() => navigate(redirect, { replace: true }), 900);
        return;
      }
      if (bound) {
        await refresh();
        setStatus('ok');
        setMessage(`已成功绑定 ${bound} 账号`);
        void refresh();
        setTimeout(() => navigate('/settings', { replace: true }), 1200);
        return;
      }
      setStatus('error');
      setMessage('回调参数不完整');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  if (status === 'working') return <Loading label="正在处理第三方登录…" />;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      {status === 'ok' ? (
        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
      ) : (
        <XCircle className="h-10 w-10 text-rose-500" />
      )}
      <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      {status === 'error' && (
        <div className="flex gap-2">
          <Link to="/login" className="btn-primary">
            返回登录
          </Link>
          <Link to="/" className="btn-ghost">
            回到首页
          </Link>
        </div>
      )}
    </div>
  );
}
