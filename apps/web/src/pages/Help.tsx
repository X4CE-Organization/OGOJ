import { Link } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { Section } from '../components/ui';
import { useAuth } from '../lib/auth';

const FAQ: { question: string; answer: string }[] = [
  {
    question: '如何提交代码？',
    answer:
      '登录后进入任意题目页面，在右侧「提交代码」面板中选择语言、粘贴代码并点击「提交评测」，随后会跳转到评测记录页面实时查看结果。',
  },
  {
    question: '评测结果分别代表什么？',
    answer:
      'AC 通过；WA 答案错误；TLE 运行超时；MLE 内存超限；RE 运行时错误（程序崩溃或返回非零值）；CE 编译错误；OLE 输出超限；PE 格式错误；SE 评测系统错误。',
  },
  {
    question: '积分是怎么获得的？',
    answer:
      '每通过一道题目即可获得积分（默认 1 分），全站首杀还有额外奖励。积分可在商店兑换「创建一次比赛」「出一道题」等特权。',
  },
  {
    question: '如何创建自己的比赛？',
    answer:
      '先在商店用积分兑换「创建一次比赛」，然后在比赛页面提交创建申请（填写赛制、时间、题目），等待管理员审核通过即可。',
  },
  {
    question: '我想出一道题该怎么做？',
    answer:
      '在商店兑换「出一道题」资格后，进入「题库 → 新建题目」填写题面，并上传测试数据（支持逐点填写或 ZIP 批量导入 *in/*out 成对文件），提交后等待审核。',
  },
  {
    question: '为什么我看不到别人的代码？',
    answer:
      '为了保护比赛公平性，比赛进行中的提交代码对其他用户不可见；此外管理员可以在系统设置中关闭「允许查看他人代码」。',
  },
  {
    question: 'Special Judge 和交互题怎么写？',
    answer:
      'Special Judge 程序会收到三个参数：输入文件、选手输出文件、标准答案文件，返回 0 表示通过，返回非 0 表示不通过，也可以在标准输出中输出 score: x 给出部分分。交互题的交互库同样通过命令行参数拿到两个管道文件（选手输入管道、选手输出管道）与输入文件。',
  },
  {
    question: '忘了密码怎么办？',
    answer: '请联系站点管理员，管理员可以在控制面板中为你重置密码。',
  },
];

export default function Help() {
  const { user, settings } = useAuth();
  const showTickets = settings.enable_tickets !== false && settings.ticket_show_entry !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {showTickets && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <span className="rounded-lg bg-primary/10 p-2 text-primary">
            <LifeBuoy className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">没有找到答案？提交工单</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              题目数据有误、账号异常、发现抄袭或想提功能建议，都可以提交工单，管理员会在后台处理并回复你。
            </p>
          </div>
          <Link to={user ? '/tickets/new' : '/login'} className="btn-primary !py-1.5 text-xs">
            {user ? '提交工单' : '登录后提交'}
          </Link>
        </div>
      )}

      <Section title="帮助中心">
        <div className="space-y-4 p-4">
          {FAQ.map((item) => (
            <details key={item.question} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <summary className="cursor-pointer text-sm font-medium">{item.question}</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{item.answer}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section title="评测状态码">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-24">状态</th>
                <th>含义</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['AC', 'Accepted — 通过全部测试点'],
                ['WA', 'Wrong Answer — 答案与标准答案不一致'],
                ['TLE', 'Time Limit Exceeded — 运行时间超过题目限制'],
                ['MLE', 'Memory Limit Exceeded — 内存使用超过题目限制'],
                ['RE', 'Runtime Error — 程序运行时崩溃'],
                ['CE', 'Compile Error — 编译失败'],
                ['OLE', 'Output Limit Exceeded — 输出内容超过限制'],
                ['PE', 'Presentation Error — 输出格式与答案不同'],
                ['SE', 'System Error — 评测机出现异常，可重测'],
                ['UKOE', 'Unknown Error — 未知错误（例如题目暂无测试数据）'],
              ].map(([status, meaning]) => (
                <tr key={status}>
                  <td className="font-mono text-xs">{status}</td>
                  <td className="text-sm">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
