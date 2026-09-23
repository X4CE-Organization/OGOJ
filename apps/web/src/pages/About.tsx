import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatTime } from '../lib/format';
import { EmptyState, Loading, Section } from '../components/ui';
import Markdown from '../components/Markdown';

export default function About() {
  const { settings } = useAuth();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<any>('/api/public/announcements?size=50')
      .then((data) => setAnnouncements(data.items))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Section title="关于本站">
        <div className="p-4">
          <Markdown>{String(settings.about_page ?? '')}</Markdown>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">站点名称</dt>
              <dd>{String(settings.site_name ?? 'OGOJ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">开源协议</dt>
              <dd>{String(settings.license ?? 'AGPL-3.0')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">源码仓库</dt>
              <dd>
                <a
                  href={String(settings.github_url ?? 'https://github.com/x4ce-organization/OGOJ')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  {String(settings.github_url ?? 'https://github.com/x4ce-organization/OGOJ')}
                </a>
              </dd>
            </div>
            {settings.contact_email ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">联系邮箱</dt>
                <dd>{String(settings.contact_email)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </Section>

      <Section title="站内公告">
        {loading ? (
          <Loading />
        ) : announcements.length === 0 ? (
          <EmptyState title="暂无公告" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {announcements.map((item) => (
              <li key={item.id} className="p-4" id={`announcement-${item.id}`}>
                <div className="flex items-center gap-2">
                  {item.is_pinned ? <span className="text-xs text-rose-500">[置顶]</span> : null}
                  <h3 className="font-medium">{item.title}</h3>
                  <span className="ml-auto text-xs text-slate-400">{formatTime(item.created_at)}</span>
                </div>
                {item.content && (
                  <div className="mt-2">
                    <Markdown>{item.content}</Markdown>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="用户协议">
          <div className="p-4">
            <Markdown>{String(settings.terms_page ?? '')}</Markdown>
          </div>
        </Section>
        <Section title="隐私政策">
          <div className="p-4">
            <Markdown>{String(settings.privacy_page ?? '')}</Markdown>
          </div>
        </Section>
      </div>
    </div>
  );
}
