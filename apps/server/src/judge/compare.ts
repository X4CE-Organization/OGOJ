export type CompareMode = 'strict' | 'trim' | 'token' | 'float';

export interface CompareResult {
  ok: boolean;
  reason?: string;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Compare the contestant output with the answer file. */
export function compareOutput(
  userOutput: string,
  answer: string,
  mode: CompareMode = 'trim',
): CompareResult {
  const a = normalizeNewlines(userOutput);
  const b = normalizeNewlines(answer);

  switch (mode) {
    case 'strict':
      return a === b ? { ok: true } : { ok: false, reason: '输出与答案不一致' };

    case 'trim': {
      const left = a.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
      const right = b.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
      while (left.length && left[left.length - 1] === '') left.pop();
      while (right.length && right[right.length - 1] === '') right.pop();
      if (left.length !== right.length) {
        return { ok: false, reason: `输出行数不同（你的 ${left.length} 行，答案 ${right.length} 行）` };
      }
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) {
          return { ok: false, reason: `第 ${i + 1} 行不一致` };
        }
      }
      return { ok: true };
    }

    case 'token': {
      const left = a.split(/\s+/).filter(Boolean);
      const right = b.split(/\s+/).filter(Boolean);
      if (left.length !== right.length) {
        return { ok: false, reason: `输出项数不同（你的 ${left.length}，答案 ${right.length}）` };
      }
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return { ok: false, reason: `第 ${i + 1} 个数据不一致` };
      }
      return { ok: true };
    }

    case 'float': {
      const left = a.split(/\s+/).filter(Boolean);
      const right = b.split(/\s+/).filter(Boolean);
      if (left.length !== right.length) {
        return { ok: false, reason: '输出项数不同' };
      }
      for (let i = 0; i < left.length; i += 1) {
        const x = Number(left[i]);
        const y = Number(right[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          if (left[i] !== right[i]) return { ok: false, reason: `第 ${i + 1} 个数据不一致` };
          continue;
        }
        const eps = 1e-6 * Math.max(1, Math.abs(y));
        if (Math.abs(x - y) > eps) {
          return { ok: false, reason: `第 ${i + 1} 个数据误差过大（你的 ${x}，答案 ${y}）` };
        }
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: '未知的比对方式' };
  }
}
