import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import {
  BookOpen,
  ClipboardList,
  FileText,
  ListChecks,
  MessageSquare,
  Settings2,
  Trophy,
  KeyRound,
  Users2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Field, Loading, Modal } from '../../components/ui';
import { useToast } from '../../components/Toast';
import TeamPolicyBadge from '../../components/TeamPolicyBadge';
import BackButton from '../../components/BackButton';
import { teamPolicy } from '../../lib/team';

export interface TeamContextValue {
  team: any;
  membership: any;
  permissions: Record<string, boolean>;
  stats: Record<string, number>;
  blacklisted: boolean;
  pendingApplication: any;
  reload: () => Promise<void>;
}

export default function TeamLayout() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const reload = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/teams/${encodeURIComponent(slug)}`);
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开团队');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const join = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      const result = await api.post<any>(`/api/teams/${slug}/join`, { message, inviteCode });
      toast.success(result.message ?? '已加入团队');
      setApplyOpen(false);
      setMessage('');
      setInviteCode('');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加入失败');
    }
  };

  const leave = async () => {
    if (!window.confirm('确定要退出该团队吗？')) return;
    try {
      await api.post(`/api/teams/${slug}/leave`);
      toast.success('已退出团队');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) return <Loading />;
  if (error || !data) return <EmptyState title="无法打开团队" description={error} />;

  const { team, membership, permissions, stats, blacklisted, pendingApplication } = data;
  const isMember = Boolean(membership);

  const tabs = [
    { to: `/team/${slug}`, label: '概览', end: true },
    { to: `/team/${slug}/discussions`, label: '讨论区', badge: stats.discussions },
    { to: `/team/${slug}/problems`, label: '题目', badge: stats.problems },
    { to: `/team/${slug}/assignments`, label: '作业', badge: stats.assignments },
    { to: `/team/${slug}/lists`, label: '题单', badge: stats.lists },
    { to: `/team/${slug}/contests`, label: '比赛', badge: stats.contests },
    { to: `/team/${slug}/members`, label: '成员', badge: stats.members },
    { to: `/team/${slug}/files`, label: '文件', badge: stats.files },
    ...(permissions.settings ? [{ to: `/team/${slug}/settings`, label: '团队设置', badge: 0 }] : []),
  ];

  return (
    <div className="space-y-4">
      <BackButton label="返回团队" listKey="teams" fallback="/teams" />
      {/* ------------------------------------------------------------ 团队头部 */}
      <div className="card overflow-hidden">
        <div
          className="h-28 bg-gradient-to-r from-sky-400 via-cyan-400 to-indigo-500"
          style={team.background ? { backgroundImage: `url(${team.background})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        />
        <div className="flex flex-wrap items-start gap-4 p-5 pt-0">
          <span className="-mt-8 shrink-0">
            {team.avatar ? (
              <img
                src={team.avatar}
                alt={team.name}
                className="h-20 w-20 rounded-2xl object-cover ring-4 ring-white dark:ring-slate-900"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-bold text-primary ring-4 ring-white dark:ring-slate-900">
                {team.name.slice(0, 1)}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{team.name}</h1>
              {team.category && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                  {team.category}
                </span>
              )}
              {!team.isPublic && (
                <span
                  title="该团队主页仅成员可见"
                  className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                >
                  主页仅成员可见
                </span>
              )}
              <TeamPolicyBadge policy={team.joinPolicy} />
              {membership && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  {membership.role === 'owner' ? '团长' : membership.role === 'admin' ? '管理员' : '成员'}
                  {membership.group ? ` · ${membership.group.name}` : ''}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
              {team.description || '这个团队还没有写介绍。'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>团长 {team.owner?.display_name || team.owner?.username}</span>
              <span>{team.memberCount} 位成员</span>
              <span>{team.problemCount} 道题目</span>
              <span>{team.experience} 团队经验</span>
              <span>创建于 {fromNow(team.createdAt)}</span>
              {team.maxMembers > 0 && <span>人数上限 {team.maxMembers}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isMember ? (
              <>
                {membership.group && (
                  <span className="text-xs text-slate-400">我的组别：{membership.group.name}</span>
                )}
                <span className="text-xs text-slate-400">我的贡献度：{membership.contribution}</span>
                {membership.role !== 'owner' && (
                  <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={leave}>
                    退出团队
                  </button>
                )}
              </>
            ) : blacklisted ? (
              <span className="text-xs text-rose-500">你已被该团队列入黑名单</span>
            ) : pendingApplication ? (
              <span className="text-xs text-amber-500">加入申请审核中</span>
            ) : team.joinPolicy === 'closed' ? (
              <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setApplyOpen(true)}>
                <KeyRound className="h-3.5 w-3.5" /> 输入邀请码加入
              </button>
            ) : team.joinPolicy === 'approval' ? (
              <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setApplyOpen(true)}>
                申请加入
              </button>
            ) : (
              <button type="button" className="btn-primary !py-1.5 text-xs" onClick={join}>
                加入团队
              </button>
            )}
          </div>
        </div>

        {/* 团队公告（加入后可见） */}
        {isMember && (team.announcement || permissions.settings) && (
          <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex items-start gap-2 text-sm">
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">团队公告</span>
              <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                {team.announcement || '还没有公告，管理员可以在「团队设置」里填写。'}
              </p>
            </div>
          </div>
        )}
        {!isMember && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400 dark:border-slate-800">
            {teamPolicy(team.joinPolicy).description} 加入团队后可以看到团队公告、作业与团队文件。
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ 标签导航 */}
      <div className="card flex flex-wrap items-center gap-1 p-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              classNames(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
                isActive ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
          >
            {tab.label}
            {tab.badge ? (
              <span className="rounded bg-black/10 px-1 text-[10px] dark:bg-white/10">{tab.badge}</span>
            ) : null}
            {tab.label === '团队设置' && stats.pendingApplications > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                {stats.pendingApplications}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <Outlet context={{ team, membership, permissions, stats, blacklisted, pendingApplication, reload } as TeamContextValue} />

      <Modal
        open={applyOpen}
        title={
          team.joinPolicy === 'approval'
            ? '申请加入团队'
            : team.joinPolicy === 'closed'
              ? '输入邀请码加入'
              : '加入团队'
        }
        onClose={() => setApplyOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setApplyOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={join}>
              {team.joinPolicy === 'approval' ? '提交申请' : '加入'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {team.joinPolicy === 'approval' && (
            <Field label="申请留言" hint="介绍一下你自己，方便管理员审核">
              <textarea
                className="input min-h-[100px]"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </Field>
          )}
          <Field label="邀请码" required={team.joinPolicy === 'closed'}>
            <input
              className="input"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="向团队管理员索取"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
