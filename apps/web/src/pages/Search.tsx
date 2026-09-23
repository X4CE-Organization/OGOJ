import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, query } from '../lib/api';
import { difficultyColor, difficultyName, fromNow } from '../lib/format';
import { Avatar, EmptyState, Loading, Section } from '../components/ui';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const term = params.get('q') ?? '';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState(term);

  useEffect(() => {
    if (!term) {
      setData(null);
      return;
    }
    setLoading(true);
    api
      .get<any>(`/api/public/search${query({ q: term, limit: 20 })}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [term]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setParams({ q: input });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <form onSubmit={submit} className="card flex gap-2 p-3">
        <input
          className="input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="搜索题目、用户、讨论、文章、题单"
          autoFocus
        />
        <button type="submit" className="btn-primary">
          搜索
        </button>
      </form>

      {loading && <Loading />}

      {!loading && data && (
        <div className="space-y-4">
          {data.problems.length > 0 && (
            <Section title={`题目（${data.problems.length}）`}>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.problems.map((problem: any) => (
                  <li key={problem.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-16 font-mono text-xs text-slate-400">{problem.pid}</span>
                    <Link to={`/problem/${problem.pid}`} className="flex-1 truncate hover:text-primary">
                      {problem.title}
                    </Link>
                    <span
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={{
                        backgroundColor: `${difficultyColor(problem.difficulty)}22`,
                        color: difficultyColor(problem.difficulty),
                      }}
                    >
                      {difficultyName(problem.difficulty)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.users.length > 0 && (
            <Section title={`用户（${data.users.length}）`}>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.users.map((user: any) => (
                  <li key={user.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Avatar user={user} size={26} />
                    <Link to={`/user/${user.username}`} className="flex-1 truncate hover:text-primary">
                      {user.display_name || user.username}
                    </Link>
                    <span className="text-xs text-slate-400">通过 {user.solved_count} 题</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.discussions.length > 0 && (
            <Section title={`讨论（${data.discussions.length}）`}>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.discussions.map((discussion: any) => (
                  <li key={discussion.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Link to={`/discussion/${discussion.id}`} className="flex-1 truncate hover:text-primary">
                      {discussion.title}
                    </Link>
                    <span className="text-xs text-slate-400">{fromNow(discussion.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.articles.length > 0 && (
            <Section title={`专栏（${data.articles.length}）`}>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.articles.map((article: any) => (
                  <li key={article.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Link to={`/article/${article.id}`} className="flex-1 truncate hover:text-primary">
                      {article.title}
                    </Link>
                    <span className="text-xs text-slate-400">{article.username}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.lists.length > 0 && (
            <Section title={`题单（${data.lists.length}）`}>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.lists.map((list: any) => (
                  <li key={list.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Link to={`/list/${list.id}`} className="flex-1 truncate hover:text-primary">
                      {list.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!data.problems.length &&
            !data.users.length &&
            !data.discussions.length &&
            !data.articles.length &&
            !data.lists.length && <EmptyState title="没有找到相关内容" description={`没有与「${term}」匹配的结果`} />}
        </div>
      )}

      {!term && !loading && <EmptyState title="输入关键词开始搜索" />}
    </div>
  );
}
