import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Crown, Flame, Plus, Search, UserPlus, Users2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, fromNow } from '../../lib/format';
import { TEAM_POLICIES, teamPolicy } from '../../lib/team';
import { EmptyState, Field, Loading, Modal, Pagination, Section } from '../../components/ui';
import ImageUploadField from '../../components/ImageUploadField';
import TeamPolicyBadge from '../../components/TeamPolicyBadge';
import { useToast } from '../../components/Toast';

/** 公开程度选项值：与后端 join_policy 对应 */
const POLICY_VALUES = ['open', 'approval', 'closed'];

export default function TeamList() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [topTeams, setTopTeams] = useState<any[]>([]);
  const [myTeams, setMyTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(params.get('q') ?? '');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    avatar: '',
    category: '',
    joinPolicy: 'open',
    isPublic: true,
    maxMembers: 0,
    allowMemberInvite: true,
  });

  const [joining, setJoining] = useState(false);
  const [joinForm, setJoinForm] = useState({ name: '', message: '', inviteCode: '' });
  const [joinPreview, setJoinPreview] = useState<any>(null);

  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'members';
  const policy = params.get('policy') ?? '';
  const category = params.get('category') ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get<any>(
        `/api/teams${query({ page, size: 24, sort, policy, category, q: params.get('q') ?? '' })}`,
      );
      setData(list);
      const top = await api.get<any>('/api/teams?sort=top&size=6');
      setTopTeams(top.items ?? []);
      if (user) {
        const mine = await api.get<any>('/api/teams?mine=true&size=12');
        setMyTeams(mine.items ?? []);
      } else {
        setMyTeams([]);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, sort, policy, category, params, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const create = async () => {
    try {
      const result = await api.post<{ slug: string }>('/api/teams', form);
      toast.success('团队创建成功');
      setCreating(false);
      window.location.href = `/team/${encodeURIComponent(result.slug)}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  /** 输入团队名称 → 预览团队 → 按公开程度加入或提交申请 */
  const lookupTeam = async (name: string) => {
    setJoinForm((current) => ({ ...current, name }));
    if (!name.trim()) {
      setJoinPreview(null);
      return;
    }
    try {
      const result = await api.get<any>(`/api/teams${query({ q: name, size: 1 })}`);
      setJoinPreview(result.items?.[0] ?? null);
    } catch {
      setJoinPreview(null);
    }
  };

  const join = async (teamName?: string) => {
    const name = (teamName ?? joinForm.name).trim();
    if (!name) {
      toast.error('请输入团队名称');
      return;
    }
    try {
      const result = await api.post<any>('/api/teams/join-by-name', {
        name,
        message: joinForm.message,
        inviteCode: joinForm.inviteCode,
      });
      toast.success(result.message ?? '已加入团队');
      setJoining(false);
      setJoinForm({ name: '', message: '', inviteCode: '' });
      setJoinPreview(null);
      if (result.status === 'joined') {
        window.location.href = `/team/${encodeURIComponent(result.team.slug)}`;
      } else {
        void load();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加入失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Users2 className="h-5 w-5 text-primary" /> 团队
        </h1>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setJoining(true)}>
            <UserPlus className="h-3.5 w-3.5" /> 加入团队
          </button>
          <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 创建团队
          </button>
        </div>
      </div>

      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-orange-500" /> 顶流团队
          </span>
        }
      >
        {topTeams.length === 0 ? (
          <EmptyState title="暂无团队" />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {topTeams.map((team, index) => (
              <Link
                key={team.id}
                to={`/team/${team.slug}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-primary/40 hover:shadow-sm dark:border-slate-700"
              >
                <span
                  className={classNames(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                    index === 0
                      ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20'
                      : index === 1
                        ? 'bg-slate-200 text-slate-600 dark:bg-slate-700'
                        : index === 2
                          ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/20'
                          : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
                  )}
                >
                  {index + 1}
                </span>
                {team.avatar ? (
                  <img src={team.avatar} alt={team.name} className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold text-primary">
                    {team.name.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{team.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{team.memberCount} 成员</span>
                    <span>{team.problemCount} 题</span>
                    <span>经验 {team.experience}</span>
                  </div>
                </div>
                <TeamPolicyBadge policy={team.joinPolicy} />
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <Crown className="h-4 w-4 text-primary" /> 我的团队
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> 创建团队
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setJoining(true)}>
              <UserPlus className="h-3.5 w-3.5" /> 加入团队
            </button>
          </div>
        }
      >
        {!user ? (
          <EmptyState
            title="登录后可以查看自己加入的团队"
            description="登录后还能创建自己的团队，或输入团队名称加入"
            action={
              <Link to="/login" className="btn-primary mt-2">
                去登录
              </Link>
            }
          />
        ) : myTeams.length === 0 ? (
          <EmptyState
            title="你还没有加入任何团队"
            description="可以创建一个新团队，或者输入团队名称申请加入"
            action={
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> 创建团队
                </button>
                <button type="button" className="btn-ghost" onClick={() => setJoining(true)}>
                  <UserPlus className="h-4 w-4" /> 加入团队
                </button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {myTeams.map((team) => (
              <Link
                key={team.id}
                to={`/team/${team.slug}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-primary/40 hover:shadow-sm dark:border-slate-700"
              >
                {team.avatar ? (
                  <img src={team.avatar} alt={team.name} className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold text-primary">
                    {team.name.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{team.name}</span>
                    <span className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">
                      {team.myRole === 'owner' ? '团长' : team.myRole === 'admin' ? '管理员' : '成员'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {team.memberCount} 成员 · {team.problemCount} 题 · {team.assignmentCount} 作业
                  </div>
                </div>
                <TeamPolicyBadge policy={team.joinPolicy} />
              </Link>
            ))}
          </div>
        )}
      </Section>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            className="input !w-56 !pl-8"
            placeholder="搜索团队名称或简介"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ q: keyword });
            }}
          />
        </div>
        <select className="input !w-36" value={sort} onChange={(event) => update({ sort: event.target.value })}>
          <option value="members">按成员数</option>
          <option value="top">按团队经验</option>
          <option value="problems">按题目数</option>
          <option value="newest">最新创建</option>
        </select>
        <select className="input !w-48" value={policy} onChange={(event) => update({ policy: event.target.value })}>
          <option value="">全部公开程度</option>
          {TEAM_POLICIES.map((item, index) => (
            <option key={item.short} value={POLICY_VALUES[index]}>
              {item.label}
            </option>
          ))}
        </select>
        {(data?.categories ?? []).length > 0 && (
          <select className="input !w-36" value={category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">全部分类</option>
            {(data?.categories ?? []).map((item: any) => (
              <option key={item.category} value={item.category}>
                {item.category}（{item.c}）
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : !data?.items?.length ? (
        <div className="card">
          <EmptyState title="没有找到团队" description="换个关键词试试，或者直接输入团队名称加入" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((team: any) => (
            <Link key={team.id} to={`/team/${team.slug}`} className="card overflow-hidden hover:shadow-md">
              <div
                className="h-16 bg-gradient-to-r from-sky-400 to-indigo-500"
                style={team.background ? { backgroundImage: `url(${team.background})`, backgroundSize: 'cover' } : undefined}
              />
              <div className="flex gap-3 p-4 pt-0">
                <span className="-mt-6 shrink-0">
                  {team.avatar ? (
                    <img
                      src={team.avatar}
                      alt={team.name}
                      className="h-12 w-12 rounded-xl object-cover ring-2 ring-white dark:ring-slate-900"
                    />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary ring-2 ring-white dark:ring-slate-900">
                      {team.name.slice(0, 1)}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate font-semibold">{team.name}</h2>
                    {team.myRole !== 'guest' && (
                      <span className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">
                        {team.myRole === 'owner' ? '团长' : team.myRole === 'admin' ? '管理员' : '成员'}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">{team.description || '这个团队还没有写简介'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>{team.memberCount} 成员</span>
                    <span>{team.problemCount} 题</span>
                    <span>{team.contestCount} 比赛</span>
                    <span className="ml-auto">{fromNow(team.createdAt)}</span>
                  </div>
                  <div className="mt-2">
                    <TeamPolicyBadge policy={team.joinPolicy} />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <Pagination page={page} size={24} total={data?.total ?? 0} onChange={(next) => update({ page: next })} />
      </div>

      <Modal
        open={creating}
        title="创建团队"
        onClose={() => setCreating(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={create}>
              创建团队
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="团队名称" required hint="创建后可在团队设置里修改">
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：XX 中学信息学战队"
            />
          </Field>
          <Field label="团队介绍" hint="未加入的用户也能看到这段介绍">
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="介绍一下团队的定位、主要活动、加入要求…"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="团队分类">
              <input
                className="input"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                placeholder="例如：竞赛 / 学校 / 兴趣"
              />
            </Field>
            <Field label="公开程度">
              <select
                className="input"
                value={form.joinPolicy}
                onChange={(event) => setForm({ ...form, joinPolicy: event.target.value })}
              >
                {TEAM_POLICIES.map((item, index) => (
                  <option key={item.short} value={POLICY_VALUES[index]}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="成员上限" hint="0 表示不限">
              <input
                className="input"
                type="number"
                value={form.maxMembers}
                onChange={(event) => setForm({ ...form, maxMembers: Number(event.target.value) })}
              />
            </Field>
          </div>
          <Field label="团队头像">
            <ImageUploadField
              value={form.avatar}
              onChange={(next) => setForm({ ...form, avatar: next })}
              category="teams"
              previewClassName="h-16 w-16"
              rounded="rounded-xl"
              hint="建议正方形图片"
            />
          </Field>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
              />
              公开团队主页（所有人都能看到）
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.allowMemberInvite}
                onChange={(event) => setForm({ ...form, allowMemberInvite: event.target.checked })}
              />
              允许普通成员邀请好友
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={joining}
        title="加入团队"
        onClose={() => setJoining(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setJoining(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={() => join()}>
              {joinPreview?.joinPolicy === 'approval' ? '提交申请' : '加入'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="团队名称" required hint="输入完整的团队名称，例如：算法集训队">
            <input
              className="input"
              value={joinForm.name}
              onChange={(event) => void lookupTeam(event.target.value)}
              placeholder="请输入团队名称"
            />
          </Field>
          {joinPreview && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <b>{joinPreview.name}</b>
                <TeamPolicyBadge policy={joinPreview.joinPolicy} />
                <span className="text-xs text-slate-400">{joinPreview.memberCount} 位成员</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {teamPolicy(joinPreview.joinPolicy).description}
                {joinPreview.joinPolicy === 'open' && ' 点击下方按钮即可直接加入。'}
                {joinPreview.joinPolicy === 'approval' && ' 需要填写申请留言。'}
                {joinPreview.joinPolicy === 'closed' && ' 需要向管理员索取邀请码。'}
              </p>
            </div>
          )}
          {joinPreview?.joinPolicy === 'approval' && (
            <Field label="申请留言" hint="让管理员了解你，提高通过率">
              <textarea
                className="input min-h-[100px]"
                value={joinForm.message}
                onChange={(event) => setJoinForm({ ...joinForm, message: event.target.value })}
              />
            </Field>
          )}
          {joinPreview?.joinPolicy === 'closed' && (
            <Field label="邀请码" required>
              <input
                className="input"
                value={joinForm.inviteCode}
                onChange={(event) => setJoinForm({ ...joinForm, inviteCode: event.target.value })}
              />
            </Field>
          )}
          {!joinPreview && joinForm.name.trim().length > 0 && (
            <p className="text-xs text-amber-600">没有找到这个团队，请检查名称是否完整。</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
