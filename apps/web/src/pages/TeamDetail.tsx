import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogOut, Megaphone, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fromNow } from '../lib/format';
import { Avatar, DifficultyBadge, EmptyState, Field, Loading, Modal, Section } from '../components/ui';
import { useToast } from '../components/Toast';

export default function TeamDetail() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [announcing, setAnnouncing] = useState(false);
  const [announcement, setAnnouncement] = useState({ title: '', content: '' });
  const [problemId, setProblemId] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/teams/${slug}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="团队不存在或未公开" />;

  const { team, members, announcements, problems } = data;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-4">
        <div className="card p-4 text-center">
          {team.avatar ? (
            <img src={team.avatar} alt={team.name} className="mx-auto h-20 w-20 rounded-xl object-cover" />
          ) : (
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
              {team.name.slice(0, 1)}
            </span>
          )}
          <h1 className="mt-2 text-lg font-bold">{team.name}</h1>
          <p className="text-xs text-slate-400">
            {team.member_count} 名成员 · 创建于 {fromNow(team.created_at)}
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{team.description || '暂无简介'}</p>
          {user && (
            <div className="mt-3 flex gap-2">
              {team.membership ? (
                team.membership !== 'owner' && (
                  <button
                    type="button"
                    className="btn-ghost w-full"
                    onClick={() => action(() => api.post(`/api/teams/${slug}/leave`), '已退出团队')}
                  >
                    <LogOut className="h-4 w-4" /> 退出团队
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => action(() => api.post(`/api/teams/${slug}/join`), '已加入团队')}
                >
                  <UserPlus className="h-4 w-4" /> 加入团队
                </button>
              )}
            </div>
          )}
        </div>

        <Section title={`成员（${members.length}）`}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {members.map((member: any) => (
              <li key={member.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <Avatar user={member} size={26} />
                <Link to={`/user/${member.username}`} className="flex-1 truncate hover:text-primary">
                  {member.display_name || member.username}
                </Link>
                {member.role === 'owner' && <span className="text-xs text-rose-500">团长</span>}
                {member.role === 'admin' && <span className="text-xs text-amber-500">管理</span>}
                {team.canManage && member.role !== 'owner' && (
                  <button
                    type="button"
                    className="text-rose-400 hover:text-rose-600"
                    onClick={() => action(() => api.del(`/api/teams/${slug}/members/${member.id}`), '已移除成员')}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </aside>

      <div className="space-y-4">
        <Section
          title="团队公告"
          action={
            team.canManage && (
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-xs"
                onClick={() => setAnnouncing(true)}
              >
                <Megaphone className="h-3.5 w-3.5" /> 发布公告
              </button>
            )
          }
        >
          {announcements.length === 0 ? (
            <EmptyState title="暂无公告" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {announcements.map((item: any) => (
                <li key={item.id} className="px-4 py-3">
                  <h3 className="font-medium">{item.title}</h3>
                  <pre className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
{item.content}
                  </pre>
                  <div className="mt-1 text-xs text-slate-400">
                    {item.username} · {fromNow(item.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={`团队题目（${problems.length}）`}
          action={
            team.canManage && (
              <div className="flex items-center gap-1">
                <input
                  className="input !w-24 !py-1 text-xs"
                  placeholder="题目 ID"
                  value={problemId}
                  onChange={(event) => setProblemId(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-xs"
                  onClick={() =>
                    action(
                      () => api.post(`/api/teams/${slug}/problems`, { problemId: Number(problemId) }),
                      '已添加题目',
                    ).then(() => setProblemId(''))
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          }
        >
          {problems.length === 0 ? (
            <EmptyState title="团队还没有添加题目" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {problems.map((problem: any) => (
                <li key={problem.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-16 font-mono text-xs text-slate-400">{problem.pid}</span>
                  <Link to={`/problem/${problem.pid}`} className="flex-1 truncate hover:text-primary">
                    {problem.title}
                  </Link>
                  <DifficultyBadge value={problem.difficulty} compact />
                  {team.canManage && (
                    <button
                      type="button"
                      className="text-rose-400 hover:text-rose-600"
                      onClick={() =>
                        action(() => api.del(`/api/teams/${slug}/problems/${problem.id}`), '已移除题目')
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Modal
        open={announcing}
        title="发布团队公告"
        onClose={() => setAnnouncing(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAnnouncing(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                void action(
                  () => api.post(`/api/teams/${slug}/announcements`, announcement),
                  '公告已发布',
                );
                setAnnouncing(false);
                setAnnouncement({ title: '', content: '' });
              }}
            >
              发布
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="标题" required>
            <input
              className="input"
              value={announcement.title}
              onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })}
            />
          </Field>
          <Field label="内容">
            <textarea
              className="input min-h-[160px]"
              value={announcement.content}
              onChange={(event) => setAnnouncement({ ...announcement, content: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
