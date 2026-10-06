/**
 * 构建期预压缩：给 dist/ 里的文本资源生成 .br / .gz 兄弟文件。
 *
 * 服务端用 @fastify/static 的 preCompressed 直接发送这些文件，于是 18MB 的
 * scratch-gui.js 不再需要每次请求现场 brotli（那是 2 核机器上最贵的一步）。
 * 生成的文件不进版本库：dist/ 本来就在 .gitignore 里。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '..', 'dist');

/** 只压文本类资源；图片 / 字体 / 音视频本身已是压缩格式，再压只浪费构建时间 */
const EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
  '.xml',
  '.webmanifest',
]);
/** 太小压了不划算：省下的字节还不如 HTTP 头值钱 */
const MIN_BYTES = 1024;
/** 大文件降一档质量，避免构建时间失控（编辑器主包 18MB，q11 比 q10 慢一倍多） */
const BIG_BYTES = 2 * 1024 * 1024;

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 11 ? parsed : fallback;
}

const QUALITY_SMALL = envInt('OGOJ_BROTLI_QUALITY', 11);
const QUALITY_BIG = envInt('OGOJ_BROTLI_QUALITY_BIG', 10);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (!fs.existsSync(distDir)) {
  console.error('[precompress] 没有找到 dist，先跑 vite build');
  process.exit(1);
}

if (process.env.OGOJ_SKIP_PRECOMPRESS === '1') {
  console.log('[precompress] OGOJ_SKIP_PRECOMPRESS=1，跳过');
  process.exit(0);
}

const started = Date.now();
let count = 0;
let rawBytes = 0;
let brBytes = 0;
let gzBytes = 0;

for (const file of walk(distDir)) {
  const ext = path.extname(file).toLowerCase();
  if (!EXTENSIONS.has(ext)) continue;
  if (file.endsWith('.br') || file.endsWith('.gz')) continue;

  const stat = fs.statSync(file);
  if (stat.size < MIN_BYTES) continue;

  const content = fs.readFileSync(file);
  const quality = stat.size >= BIG_BYTES ? QUALITY_BIG : QUALITY_SMALL;

  const brotli = zlib.brotliCompressSync(content, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length,
    },
  });
  const gzip = zlib.gzipSync(content, { level: 9 });

  fs.writeFileSync(`${file}.br`, brotli);
  fs.writeFileSync(`${file}.gz`, gzip);

  count += 1;
  rawBytes += content.length;
  brBytes += brotli.length;
  gzBytes += gzip.length;
}

const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
console.log(
  `[precompress] ${count} 个文件，原始 ${mb(rawBytes)} -> br ${mb(brBytes)} / gz ${mb(gzBytes)}，` +
    `耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
