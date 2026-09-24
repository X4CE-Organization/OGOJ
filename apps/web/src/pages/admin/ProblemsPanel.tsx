import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, FileArchive, FileCode2, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { api, query } from '../../lib/api';
import { classNames, DIFFICULTY_NAMES, fromNow } from '../../lib/format';
import { DifficultyBadge, EmptyState, Field, Loading, Modal, Pagination } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function ProblemsPanel() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [review, setReview] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<'zip' | 'fps'>('zip');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDifficulty, setImportDifficulty] = useState(1);
  const [importPublic, setImportPublic] = useState(true);
  const [importResult, setImportResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/admin/problems${query({ page, size: 50, review, q: search })}`);
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, review, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewProblem = async (problem: any, approve: boolean) => {
    const note = approve ? '' : window.prompt('驳回原因', '题目描述或数据需要修改') ?? '';
    try {
      await api.post(`/api/admin/problems/${problem.id}/review`, { approve, note });
      toast.success(approve ? '已通过审核' : '已驳回');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async (problem: any) => {
    if (!window.confirm(`确定删除题目 ${problem.pid} 吗？（软删除，可在数据库中恢复）`)) return;
    try {
      await api.del(`/api/problems/${problem.id}`);
      toast.success('已删除');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const rejudge = async (problem: any) => {
    if (!window.confirm(`确定重测 ${problem.pid} 的全部提交吗？`)) return;
    try {
      const result = await api.post<{ affected: number }>('/api/submissions/rejudge', { problemId: problem.id });
      toast.success(`已加入重测队列：${result.affected} 条`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重测失败');
    }
  };

  const items: any[] = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((problem) => selected.includes(problem.id));

  const toggleOne = (id: number) => {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const toggleAll = () => {
    const ids = items.map((problem) => problem.id);
    setSelected((current) => (allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]));
  };

  /** 勾选的题目导出成一个 ZIP 题目包 */
  const exportSelected = async () => {
    if (!selected.length) {
      toast.error('请先勾选要导出的题目');
      return;
    }
    setBusy('export');
    try {
      const name = await api.download(`/api/admin/problems/export${query({ ids: selected.join(',') })}`, 'ogoj-problems.zip');
      toast.success(`已导出 ${selected.length} 道题目 → ${name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy('');
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setImportResult(null);
    setImportDifficulty(1);
    setImportPublic(true);
  };

  /** 导入 ZIP 题目包或 FPS XML */
  const runImport = async () => {
    if (!importFile) {
      toast.error('请选择要导入的文件');
      return;
    }
    setBusy('import');
    try {
      const form = new FormData();
      form.append('file', importFile);
      const result = await api.post<any>(
        `/api/admin/problems/import${query({
          format: importFormat,
          difficulty: importDifficulty,
          public: importPublic ? 1 : 0,
        })}`,
        form,
      );
      setImportResult(result);
      toast.success(`导入完成：新增 ${result.created?.length ?? 0} 道题目`);
      setSelected([]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">题目管理</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost !py-1.5 text-xs"
            onClick={() => {
              resetImport();
              setImportOpen(true);
            }}
          >
            <Upload className="h-3.5 w-3.5" /> 导入题目
          </button>
          <button
            type="button"
            className="btn-ghost !py-1.5 text-xs"
            disabled={!selected.length || busy === 'export'}
            onClick={() => void exportSelected()}
          >
            <Download className="h-3.5 w-3.5" />
            {busy === 'export' ? '导出中…' : `批量导出${selected.length ? `（${selected.length}）` : ''}`}
          </button>
          <Link to="/admin/problems/new" className="btn-primary !py-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> 新建题目
          </Link>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">已勾选 <b>{selected.length}</b> 道题目</span>
          <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => void exportSelected()}>
            <FileArchive className="h-3.5 w-3.5" /> 导出为 ZIP
          </button>
          <button type="button" className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setSelected([])}>
            清除勾选
          </button>
        </div>
      )}

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setReview('')}
          className={classNames(
            'rounded-lg px-3 py-1.5 text-sm',
            !review ? 'bg-primary text-white' : 'border border-slate-200 text-slate-500 dark:border-slate-700',
          )}
        >
          全部
        </button>
        {[
          { value: 'pending', label: '待审核' },
          { value: 'approved', label: '已通过' },
          { value: 'rejected', label: '已驳回' },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setReview(item.value);
              setPage(1);
            }}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              review === item.value
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
        <input
          className="input !w-56"
          placeholder="搜索题目编号 / 标题"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有符合条件的题目" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="全选本页题目"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="w-24">编号</th>
                  <th>题目</th>
                  <th className="w-28">难度</th>
                  <th className="w-24">测试点</th>
                  <th className="w-24">提交</th>
                  <th className="w-28">状态</th>
                  <th className="w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((problem: any) => (
                  <tr key={problem.id} className={classNames(selected.includes(problem.id) && 'bg-primary/5')}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择题目 ${problem.pid}`}
                        checked={selected.includes(problem.id)}
                        onChange={() => toggleOne(problem.id)}
                      />
                    </td>
                    <td className="font-mono text-xs">{problem.pid}</td>
                    <td>
                      <Link to={`/problem/${problem.pid}`} className="hover:text-primary">
                        {problem.title}
                      </Link>
                      <div className="text-[11px] text-slate-400">
                        {problem.source_type === 'user' ? '用户出题' : '官方题目'}
                        {problem.owner_name ? ` · ${problem.owner_name}` : ''} · {fromNow(problem.updated_at)}
                      </div>
                    </td>
                    <td>
                      <DifficultyBadge value={problem.difficulty} compact />
                    </td>
                    <td className={problem.testcase_count ? '' : 'text-rose-500'}>
                      {problem.testcase_count}
                    </td>
                    <td className="text-xs text-slate-500">
                      {problem.accepted_count} / {problem.submit_count}
                    </td>
                    <td>
                      <span
                        className={classNames(
                          'rounded px-1.5 py-0.5 text-xs',
                          problem.review_status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : problem.review_status === 'pending'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
                        )}
                      >
                        {problem.review_status === 'approved' ? '已通过' : problem.review_status === 'pending' ? '待审核' : '已驳回'}
                      </span>
                      {!problem.is_public && <div className="text-[11px] text-slate-400">未公开</div>}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Link to={`/admin/problems/${problem.id}/edit`} className="text-primary hover:underline">
                          <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                          编辑
                        </Link>
                        {problem.review_status !== 'approved' && (
                          <button type="button" className="text-emerald-600 hover:underline" onClick={() => reviewProblem(problem, true)}>
                            <Check className="mr-0.5 inline h-3.5 w-3.5" />
                            通过
                          </button>
                        )}
                        {problem.review_status !== 'rejected' && (
                          <button type="button" className="text-amber-600 hover:underline" onClick={() => reviewProblem(problem, false)}>
                            <X className="mr-0.5 inline h-3.5 w-3.5" />
                            驳回
                          </button>
                        )}
                        <button type="button" className="text-slate-500 hover:underline" onClick={() => rejudge(problem)}>
                          <RefreshCw className="inline h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => remove(problem)}>
                          <Trash2 className="inline h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={50} total={data?.total ?? 0} onChange={setPage} />
      </div>

      <Modal
        open={importOpen}
        title="导入题目"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setImportOpen(false)}>
              关闭
            </button>
            <button type="button" className="btn-primary" disabled={busy === 'import'} onClick={() => void runImport()}>
              {busy === 'import' ? '导入中…' : '开始导入'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="导入格式" required>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: 'zip' as const, label: 'ZIP 题目包', hint: '本站批量导出生成的 ZIP', icon: FileArchive },
                { value: 'fps' as const, label: 'FPS 文件', hint: 'FPS XML 题目文件', icon: FileCode2 },
              ].map((item) => (
                <label
                  key={item.value}
                  className={classNames(
                    'flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm',
                    importFormat === item.value ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-slate-700',
                  )}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={importFormat === item.value}
                    onChange={() => {
                      setImportFormat(item.value);
                      setImportFile(null);
                      setImportResult(null);
                    }}
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <item.icon className="h-3.5 w-3.5 text-primary" /> {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="选择文件" required hint={importFormat === 'zip' ? '一次可以导入多个题目' : '一个 FPS 文件可以包含多道题目'}>
            <input
              type="file"
              className="input"
              accept={importFormat === 'zip' ? '.zip' : '.xml'}
              onChange={(event) => {
                setImportFile(event.target.files?.[0] ?? null);
                setImportResult(null);
              }}
            />
          </Field>

          {importFormat === 'fps' && (
            <Field label="默认难度" hint="FPS 文件里没有难度信息，导入后可以用这个难度">
              <select
                className="input"
                value={importDifficulty}
                onChange={(event) => setImportDifficulty(Number(event.target.value))}
              >
                {DIFFICULTY_NAMES.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={importPublic} onChange={(event) => setImportPublic(event.target.checked)} />
            导入后立即公开（取消勾选则先隐藏，之后可在题目设置里公开）
          </label>

          {importResult && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">
              <div className="font-medium">
                新增 {importResult.created?.length ?? 0} 道题目
                {importResult.failed?.length ? `，失败 ${importResult.failed.length} 道` : ''}
              </div>
              <ul className="mt-1 space-y-0.5 text-slate-500">
                {(importResult.created ?? []).slice(0, 30).map((item: any) => (
                  <li key={item.pid}>
                    {item.pid} · {item.title} · {item.testcases} 个测试点
                    {item.samples ? ` · ${item.samples} 组样例` : ''}
                    {item.images ? ` · ${item.images} 张图片` : ''}
                  </li>
                ))}
                {(importResult.created ?? []).length > 30 && <li>……还有 {importResult.created.length - 30} 道</li>}
                {(importResult.failed ?? []).map((item: any) => (
                  <li key={item.name} className="text-rose-500">
                    失败：{item.name} —— {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
