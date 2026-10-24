export interface BulkFailure {
  id: string | number;
  label: string;
  message: string;
}

export interface BulkResult {
  succeeded: number;
  failures: BulkFailure[];
}

/**
 * 批量管理统一入口：限制并发，单项失败不影响其它项目。
 * 调用方用返回结果给出“成功 N 项、失败 M 项”的明确反馈。
 */
export async function runBulk<T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  options: {
    concurrency?: number;
    id?: (item: T) => string | number;
    label?: (item: T) => string;
  } = {},
): Promise<BulkResult> {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const failures: BulkFailure[] = [];
  let cursor = 0;
  let succeeded = 0;

  const runner = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      try {
        await worker(item);
        succeeded += 1;
      } catch (error) {
        failures.push({
          id: options.id?.(item) ?? cursor,
          label: options.label?.(item) ?? String(options.id?.(item) ?? cursor),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runner()),
  );
  return { succeeded, failures };
}

