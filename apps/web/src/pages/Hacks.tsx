import { useState } from 'react';
import { Crosshair } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import HackList from '../components/HackList';
import { Section } from '../components/ui';

export default function Hacks() {
  const { user, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [mine, setMine] = useState(false);
  const problemId = params.get('problemId') ? Number(params.get('problemId')) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Crosshair className="h-5 w-5 text-primary" /> Hack 记录
        </h1>
        <p className="text-xs text-slate-500">
          通过构造测试数据让别人的错误代码暴露出来，成功即可获得积分；数据会被并入题库。
        </p>
      </div>

      {settings.enable_hack === false && (
        <div className="card p-4 text-sm text-amber-600 dark:text-amber-400">
          本站当前未开启 Hack 系统（可在控制面板 → 系统设置 → Hack 与成就 中启用）。
        </div>
      )}

      {user && (
        <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
          <label className="flex items-center gap-1.5 text-slate-500">
            <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
            只看与我相关的
          </label>
          {problemId && (
            <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">
              仅显示题目 #{problemId}
              <button
                type="button"
                className="ml-2"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('problemId');
                  setParams(next);
                }}
              >
                ✕
              </button>
            </span>
          )}
        </div>
      )}

      <Section title="Hack 记录">
        <div className="p-4">
          <HackList problemId={problemId} showHackButton mine={mine} />
        </div>
      </Section>
    </div>
  );
}
