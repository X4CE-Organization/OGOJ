import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="text-6xl font-black text-primary">404</div>
      <h1 className="text-lg font-semibold">页面不存在</h1>
      <p className="text-sm text-slate-500">你访问的页面可能已被删除，或者你没有权限查看。</p>
      <div className="mt-2 flex gap-2">
        <Link to="/" className="btn-primary">
          返回首页
        </Link>
        <Link to="/problems" className="btn-ghost">
          去刷题
        </Link>
      </div>
    </div>
  );
}
