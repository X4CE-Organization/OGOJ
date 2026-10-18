import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { fromNow } from '../../lib/format';
import { EmptyState, Loading, Modal, Pagination, Tabs } from '../../components/ui';
import { useToast } from '../../components/Toast';

type TabKey = 'articles' | 'posts' | 'comments' | 'messages' | 'solutions' | 'moments';

const TABS: { key: TabKey; label: string; deletedFilter: boolean }[] = [
  { key: 'articles', label: '文章广场', deletedFilter: true },
  { key: 'posts', label: '帖子', deletedFilter: true },
  { key: 'comments', label: '评论', deletedFilter: true },
  { key: 'messages', label: '私信 / 站内信', deletedFilter: false },
  { key: 'solutions', label: '题解', deletedFilter: true },
  { key: 'moments', label: '动态', deletedFilter: true },
];

const COMMENT_TYPES = [
  { value: '', label: '全部评论' },
  { value: 'article', label: '文章评论' },
  { value: 'problem', label: '题目评论' },
  { value: 'solution', label: '题解评论' },
  { value: 'contest', label: '比赛评论' },
  { value: 'list', label: '题单评论' },
  { value: 'discussion', label: '讨论区回复' },
  { value: 'moment', label: '动态评论' },
];

/** 编辑时用到的字段，按标签页区分 */
const EDIT_FIELDS: Record<TabKey, { key: string; label: string; type: 'text' | 'textarea' | 'bool'; max?: number }[]> = {
  articles: [
    { key: 'title', label: '标题', type: 'text', max: 200 },
    { key: 'summary', label: '摘要', type: 'text', max: 1000 },
    { key: 'category', label: '分类', type: 'text', max: 40 },
    { key: 'content', label: '正文（Markdown）', type: 'textarea' },
    { key: 'isPublic', label: '公开', type: 'bool' },
    { key: 'isPinned', label: '置顶', type: 'bool' },
  ],
  posts: [
    { key: 'title', label: '标题', type: 'text', max: 200 },
    { key: 'content', label: '正文（Markdown）', type: 'textarea' },
    { key: 'isPinned', label: '置顶', type: 'bool' },
    { key: 'isLocked', label: '锁定（不能再回复）', type: 'bool' },
  ],
  comments: [{ key: 'content', label: '评论内容', type: 'textarea' }],
  messages: [
    { key: 'title', label: '标题', type: 'text', max: 200 },
    { key: 'content', label: '正文', type: 'textarea' },
  ],
  solutions: [
    { key: 'title', label: '标题', type: 'text', max: 200 },
    { key: 'content', label: '正文（Markdown）', type: 'textarea' },
    { key: 'isPublic', label: '公开', type: 'bool' },
  ],
  moments: [
    { key: 'content', label: '动态内容', type: 'textarea' },
    { key: 'isPinned', label: '置顶', type: 'bool' },
  ],
};

const TYPE_LABEL: Record<string, string> = Object.fromEntries(COMMENT_TYPES.filter((t) => t.value).map((t) => [t.value, t.label]));

function preview(value: unknown, length = 80): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

/** 表单字段名是 camelCase（isPublic），数据库行是 snake_case（is_public） */
function rowKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export default function AdminContent() {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('articles');
  const [keyword, setKeyword] = useState('');
  const [commentType, setCommentType] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const meta = TABS.find((item) => item.key === tab)!;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/admin/content/${tab}${query({
          page,
          size: 30,
          keyword,
          deleted: deleted ? 'true' : '',
          type: tab === 'comments' ? commentType : '',
        })}`,
      );
      setData(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page, keyword, deleted, commentType]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.get<any>('/api/admin/content/stats'));
    } catch {
      /* 统计失败不影响列表 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    setPage(1);
    setDeleted(false);
    setCommentType('');
  }, [tab]);

  function openEdit(row: any) {
    const fields = EDIT_FIELDS[tab];
    const draft: Record<string, any> = {};
    for (const field of fields) {
      const value = row[rowKey(field.key)];
      draft[field.key] = field.type === 'bool' ? Boolean(value) : String(value ?? '');
    }
    setEditing(row);
    setForm(draft);
  }

  function itemUrl(row: any): string | null {
    if (tab === 'articles') return `/article/${row.id}`;
    if (tab === 'posts') return `/discussion/${row.id}`;
    if (tab === 'solutions') return `/solution/${row.id}`;
    if (tab === 'moments') return `/moment/${row.id}`;
    if (tab === 'comments') {
      if (row.type === 'article') return `/article/${row.target_id}`;
      if (row.type === 'discussion') return `/discussion/${row.target_id}`;
      if (row.type === 'moment') return `/moment/${row.target_id}`;
      if (row.type === 'solution') return `/solution/${row.target_id}`;
    }
    return null;
  }

  function itemPath(row: any): string {
    if (tab === 'comments') return `/api/admin/content/comments/${row.source}/${row.id}`;
    return `/api/admin/content/${tab}/${row.id}`;
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.put(itemPath(editing), form);
      toast.success('已保存修改');
      setEditing(null);
      await Promise.all([load(), loadStats()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: any) {
    const label = row.title ? `《${row.title}》` : '这条内容';
    if (!window.confirm(`确定删除${label}吗？${tab === 'messages' ? '私信删除后无法恢复。' : '删除后可以在「已删除」里恢复。'}`)) return;
    try {
      await api.del(itemPath(row));
      toast.success('已删除');
      await Promise.all([load(), loadStats()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function restore(row: any) {
    try {
      await api.put(itemPath(row), { isDeleted: false });
      toast.success('已恢复');
      await Promise.all([load(), loadStats()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复失败');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">内容管理</h1>
          <p className="text-xs text-slate-500">文章、帖子、评论、私信、题解、动态都能在这里改文字和删除。</p>
        </div>
        <span className="text-sm text-slate-500">共 {data?.total ?? 0} 条</span>
      </div>

      <Tabs
        tabs={TABS.map((item) => ({
          key: item.key,
          label: item.label,
          badge: stats ? stats[item.key] : undefined,
        }))}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
      />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input !w-full sm:!w-72"
          placeholder="搜索标题 / 正文 / 作者 / 收件人"
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
        />
        {tab === 'comments' ? (
          <select
            className="input !w-full sm:!w-44"
            value={commentType}
            onChange={(event) => {
              setCommentType(event.target.value);
              setPage(1);
            }}
          >
            {COMMENT_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}
        {meta.deletedFilter ? (
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={deleted}
              onChange={(event) => {
                setDeleted(event.target.checked);
                setPage(1);
              }}
            />
            只看已删除
          </label>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title={deleted ? '没有已删除的内容' : '没有内容'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[720px]">
              <thead>
                <tr>
                  {tab === 'articles' ? <><th>文章</th><th>作者</th><th>分类</th><th>状态</th><th>时间</th></> : null}
                  {tab === 'posts' ? <><th>帖子</th><th>作者</th><th>回复</th><th>状态</th><th>时间</th></> : null}
                  {tab === 'comments' ? <><th>评论</th><th>位置</th><th>作者</th><th>时间</th></> : null}
                  {tab === 'messages' ? <><th>发件人 → 收件人</th><th>标题</th><th>内容</th><th>时间</th></> : null}
                  {tab === 'solutions' ? <><th>题解</th><th>题目</th><th>作者</th><th>状态</th><th>时间</th></> : null}
                  {tab === 'moments' ? <><th>动态</th><th>作者</th><th>状态</th><th>时间</th></> : null}
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row: any) => {
                  const url = itemUrl(row);
                  return (
                    <tr key={`${row.source ?? tab}-${row.id}`}>
                      {tab === 'articles' ? (
                        <>
                          <td>
                            <div className="font-medium">{url ? <Link to={url} className="hover:text-primary">{row.title}</Link> : row.title}</div>
                            <div className="text-xs text-slate-400">{preview(row.summary || row.content, 60)}</div>
                          </td>
                          <td>{row.author}</td>
                          <td>{row.category}</td>
                          <td className="whitespace-nowrap text-xs">{row.is_deleted ? '已删除' : row.is_public ? (row.is_pinned ? '公开 · 置顶' : '公开') : '未公开'}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fromNow(row.created_at)}</td>
                        </>
                      ) : null}
                      {tab === 'posts' ? (
                        <>
                          <td>
                            <div className="font-medium">{url ? <Link to={url} className="hover:text-primary">{row.title}</Link> : row.title}</div>
                            <div className="text-xs text-slate-400">{preview(row.content, 60)}</div>
                          </td>
                          <td>{row.author}</td>
                          <td>{row.reply_count}</td>
                          <td className="whitespace-nowrap text-xs">{row.is_deleted ? '已删除' : row.is_locked ? '已锁定' : row.is_pinned ? '置顶' : '正常'}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fromNow(row.created_at)}</td>
                        </>
                      ) : null}
                      {tab === 'comments' ? (
                        <>
                          <td className="max-w-[420px]">{preview(row.content, 90)}</td>
                          <td className="text-xs text-slate-500">
                            <div>{TYPE_LABEL[row.type] ?? row.type}</div>
                            <div className="truncate text-slate-400">{preview(row.target_title, 40)}</div>
                          </td>
                          <td>{row.author}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fromNow(row.created_at)}</td>
                        </>
                      ) : null}
                      {tab === 'messages' ? (
                        <>
                          <td className="whitespace-nowrap text-xs">
                            {row.from_user || '系统'} → {row.to_user}
                            <div className="text-slate-400">{row.type}{row.conversation_key ? ' · 私信' : ''}</div>
                          </td>
                          <td className="max-w-[180px]">{preview(row.title, 30)}</td>
                          <td className="max-w-[320px]">{preview(row.content, 60)}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fromNow(row.created_at)}</td>
                        </>
                      ) : null}
                      {tab === 'solutions' ? (
                        <>
                          <td>
                            <div className="font-medium">{url ? <Link to={url} className="hover:text-primary">{row.title}</Link> : row.title}</div>
                            <div className="text-xs text-slate-400">{preview(row.content, 60)}</div>
                          </td>
                          <td className="max-w-[200px] text-xs">{preview(row.problem_title, 30)}</td>
                          <td>{row.author}</td>
                          <td className="whitespace-nowrap text-xs">{row.is_deleted ? '已删除' : row.is_public ? '公开' : '未公开'}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fromNow(row.created_at)}</td>
                        </>
                      ) : null}
                      {tab === 'moments' ? (
                        <>
                          <td className="max-w-[520px]">{preview(row.content, 100)}</td>
                          <td>{row.author}</td>
                          <td className="whitespace-nowrap text-xs">{row.is_deleted ? '已删除' : row.is_pinned ? '置顶' : '正常'}</td>
                          <td className="whitespace-nowrap text-xs text-slate-500">{fromNow(row.created_at)}</td>
                        </>
                      ) : null}
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {url ? (
                            <Link to={url} className="btn-ghost p-1.5" title="查看">
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          ) : null}
                          {row.is_deleted ? (
                            <button type="button" className="btn-ghost p-1.5 text-emerald-600" title="恢复" onClick={() => restore(row)}>
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          ) : (
                            <>
                              <button type="button" className="btn-ghost p-1.5" title="修改" onClick={() => openEdit(row)}>
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button type="button" className="btn-ghost p-1.5 text-rose-600" title="删除" onClick={() => remove(row)}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data ? <Pagination page={page} size={data.size} total={data.total} onChange={setPage} /> : null}
      </div>

      <Modal
        open={Boolean(editing)}
        title={`修改${meta.label}${editing?.title ? ` · ${preview(editing.title, 24)}` : ''}`}
        onClose={() => setEditing(null)}
        width="max-w-3xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn-primary text-sm" disabled={saving} onClick={save}>
              {saving ? '保存中…' : '保存修改'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {EDIT_FIELDS[tab].map((field) => (
            <div key={field.key}>
              {field.type === 'bool' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(form[field.key])}
                    onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.checked }))}
                  />
                  {field.label}
                </label>
              ) : (
                <>
                  <label className="mb-1 block text-xs text-slate-500">{field.label}</label>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="input !h-64 !w-full font-mono text-xs"
                      maxLength={200000}
                      value={form[field.key] ?? ''}
                      onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    />
                  ) : (
                    <input
                      className="input !w-full"
                      maxLength={field.max}
                      value={form[field.key] ?? ''}
                      onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    />
                  )}
                </>
              )}
            </div>
          ))}
          {editing ? (
            <p className="text-[11px] text-slate-400">
              作者 @{editing.author || editing.from_user || '系统'} · {fromNow(editing.created_at)}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
