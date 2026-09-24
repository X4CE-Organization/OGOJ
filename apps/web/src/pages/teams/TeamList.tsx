import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Users2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, fromNow } from '../../lib/format';
import { Avatar, EmptyState, Field, Loading, Modal, Pagination } from '../../components/ui';
import ImageUploadField from '../../components/ImageUploadField';
import { useToast } from '../../components/Toast';

const POLICY_LABEL: Record<string, string> = {
  open: '自由加入',
  approval: '加入需要审核',
  closed: '不允许加入',
};

export default function TeamList() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState(params.get('q') ?? '');
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

  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'members';
  const policy = params.get('policy') ?? '';
  const category = params.get('category') ?? '';
  const mine = params.get('mine') ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/teams${query({ page, size: 24, sort, policy, category, mine, q: params.get('q') ?? '' })}`,
      );
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, sort, policy, category, mine, params]);

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
      window.location.href = `/team/${result.slug}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Users2 className="h-5 w-5 text-primary" /> 团队
        </h1>
        {user && (
          <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 创建团队
          </button>
        )}
      </div>

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
          <option value="problems">按题目数</option>
          <option value="newest">最新创建</option>
        </select>
        <select className="input !w-40" value={policy} onChange={(event) => update({ policy: event.target.value })}>
          <option value="">全部公开程度</option>
          <option value="open">自由加入</option>
          <option value="approval">加入需要审核</option>
          <option value="closed">不允许加入</option>
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
        {user && (
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={mine === 'true'}
              onChange={(event) => update({ mine: event.target.checked ? 'true' : undefined })}
            />
            只看我加入的
          </label>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : !data?.items?.length ? (
        <div className="card">
          <EmptyState title="没有找到团队" description="创建一个团队，和同伴一起刷题、出题、打比赛" />
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
                    <img src={team.avatar} alt={team.name} className="h-12 w-12 rounded-xl object-cover ring-2 ring-white dark:ring-slate-900" />
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
                    <span className={classNames(team.joinPolicy === 'closed' ? 'text-rose-400' : '')}>
                      {POLICY_LABEL[team.joinPolicy] ?? team.joinPolicy}
                    </span>
                    <span className="ml-auto">{fromNow(team.createdAt)}</span>
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
                <option value="open">自由加入</option>
                <option value="approval">加入需要审核</option>
                <option value="closed">不允许加入（凭邀请码）</option>
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
              公开团队（所有人都能看到团队主页）
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
    </div>
  );
}
