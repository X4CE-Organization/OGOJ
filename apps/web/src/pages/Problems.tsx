import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, DIFFICULTY_COLORS, DIFFICULTY_COLORS_DARK, DIFFICULTY_NAMES } from '../lib/format';
import { rememberProblemsUrl } from '../lib/nav';
import { DifficultyBadge, EmptyState, Loading, Pagination, Section, TagBadge } from '../components/ui';

interface ProblemItem {
  id: number;
  pid: string;
  title: string;
  difficulty: number;
  tags: { id: number; name: string; color: string }[];
  provider: string;
  submitCount: number;
  acceptedCount: number;
  passRate?: number;
  reviewStatus?: string;
}

export default function Problems() {
  const { user, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<ProblemItem[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(params.get('q') ?? '');

  const page = Number(params.get('page') ?? 1);
  const size = 50;
  const difficulties = params.get('difficulty')?.split(',').filter(Boolean).map(Number) ?? [];
  const selectedTags = params.get('tag')?.split(',').filter(Boolean).map(Number) ?? [];
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const showAll = params.get('all') === 'true';

  useEffect(() => {
    api.get<{ tags: any[] }>('/api/tags').then((data) => setTags(data.tags)).catch(() => undefined);
  }, []);

  // 记住当前这一屏的筛选条件，题目详情页的「返回题库」会回到这里
  useEffect(() => {
    const search = params.toString();
    rememberProblemsUrl(search ? `/problems?${search}` : '/problems');
  }, [params]);

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(
        `/api/problems${query({
          page,
          size,
          q: params.get('q') ?? '',
          difficulty: difficulties.join(','),
          tag: selectedTags.join(','),
          status,
          sort,
          all: showAll ? 'true' : '',
          review: params.get('review') ?? '',
        })}`,
      )
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === 'all') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const toggleDifficulty = (value: number) => {
    const next = difficulties.includes(value)
      ? difficulties.filter((item) => item !== value)
      : [...difficulties, value].sort();
    update({ difficulty: next.join(',') });
  };

  const toggleTag = (value: number) => {
    const next = selectedTags.includes(value)
      ? selectedTags.filter((item) => item !== value)
      : [...selectedTags, value];
    update({ tag: next.join(',') });
  };

  const tagGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const tag of tags) {
      const list = groups.get(tag.category) ?? [];
      list.push(tag);
      groups.set(tag.category, list);
    }
    return [...groups.entries()];
  }, [tags]);

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-4">
        <Section title="筛选题目">
          <div className="space-y-4 p-4">
            <div>
              <span className="label">关键词</span>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') update({ q: keyword });
                  }}
                  placeholder="题目名称 / 编号"
                />
                <button type="button" className="btn-ghost !px-2.5" onClick={() => update({ q: keyword })}>
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <span className="label">难度</span>
              <div className="space-y-1">
                {DIFFICULTY_NAMES.map((name, index) => {
                  const value = index + 1;
                  return (
                    <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={difficulties.includes(value)}
                        onChange={() => toggleDifficulty(value)}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full [background-color:var(--dot)] dark:[background-color:var(--dot-dark)]"
                        style={{
                          ['--dot' as string]: DIFFICULTY_COLORS[index],
                          ['--dot-dark' as string]: DIFFICULTY_COLORS_DARK[index],
                        }}
                      />
                      <span className="text-slate-600 dark:text-slate-300">{name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {user && (
              <div>
                <span className="label">完成状态</span>
                <div className="flex gap-1">
                  {[
                    { value: '', label: '全部' },
                    { value: 'accepted', label: '已通过' },
                    { value: 'todo', label: '未通过' },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => update({ status: item.value })}
                      className={classNames(
                        'flex-1 rounded-lg px-2 py-1.5 text-xs',
                        status === item.value
                          ? 'bg-primary text-white'
                          : 'border border-slate-200 text-slate-500 dark:border-slate-700',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="label">排序</span>
              <select className="input" value={sort} onChange={(event) => update({ sort: event.target.value })}>
                <option value="newest">最新发布</option>
                <option value="oldest">最早发布</option>
                <option value="difficulty">难度从低到高</option>
                <option value="difficulty_desc">难度从高到低</option>
                <option value="submissions">提交数最多</option>
                <option value="acceptance">通过率最高</option>
                <option value="pid">按编号</option>
              </select>
            </div>

            {user?.role !== 'user' && (
              <label className="flex items-center gap-2 text-sm text-slate-500">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(event) => update({ all: event.target.checked ? 'true' : undefined })}
                />
                显示未公开题目（管理员）
              </label>
            )}
          </div>
        </Section>

        {tagGroups.length > 0 && (
          <Section title="算法标签">
            <div className="space-y-3 p-4">
              {tagGroups.map(([category, list]) => (
                <div key={category}>
                  <div className="mb-1.5 text-xs font-medium text-slate-400">{category}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs transition',
                          selectedTags.includes(tag.id) ? 'ring-2 ring-primary' : '',
                        )}
                        style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                      >
                        {tag.name}
                        <span className="ml-1 opacity-60">{tag.problem_count ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </aside>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-primary" /> 题库
          </h1>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>共 {total} 道题目</span>
            {user?.role !== 'user' && (
              <Link to="/admin/problems/new" className="btn-primary !px-2.5 !py-1 text-xs">
                新建题目
              </Link>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <EmptyState title="没有找到符合条件的题目" description="试试调整筛选条件" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">编号</th>
                    <th>题目名称</th>
                    <th className="w-32">难度</th>
                    <th className="hidden w-64 md:table-cell">标签</th>
                    {settings.show_accepted_count !== false && <th className="w-24">通过率</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((problem) => (
                    <tr key={problem.id}>
                      <td className="font-mono text-xs text-slate-400">
                        {problem.pid}
                        {problem.reviewStatus && problem.reviewStatus !== 'approved' && (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                            {problem.reviewStatus === 'pending' ? '待审' : '驳回'}
                          </span>
                        )}
                      </td>
                      <td>
                        <Link to={`/problem/${problem.pid}`} className="hover:text-primary">
                          {problem.title}
                        </Link>
                        {problem.provider ? (
                          <span className="ml-2 text-xs text-slate-400">[{problem.provider}]</span>
                        ) : null}
                      </td>
                      <td>
                        <DifficultyBadge value={problem.difficulty} />
                      </td>
                      <td className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {problem.tags.slice(0, 4).map((tag) => (
                            <TagBadge key={tag.id} tag={tag} />
                          ))}
                        </div>
                      </td>
                      {settings.show_accepted_count !== false && (
                        <td className="text-xs text-slate-500">
                          {problem.passRate !== undefined ? `${problem.passRate}%` : '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
        </div>
      </div>
    </div>
  );
}
