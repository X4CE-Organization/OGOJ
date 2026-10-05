/**
 * 把 MIT Scratch 的编辑器（scratch-gui）拉到 apps/web/public/scratch/。
 *
 * 编辑器是自托管的静态站点，不进 git（体积近百 MB），构建镜像时现拉。
 * 产物结构：
 *   public/scratch-editor/index.html          由 scratch-host/editor.html 拷过来
 *   public/scratch-editor/scratch-gui.js      scratch-gui 的库构建
 *   public/scratch-editor/vendor/react*.js    React 16 UMD（scratch-gui 依赖）
 *   public/scratch-editor/static|chunks|libraries|...
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const outDir = path.join(webRoot, 'public', 'scratch-editor');
const hostPage = path.join(webRoot, 'scratch-host', 'editor.html');

const SCRATCH_GUI_VERSION = process.env.SCRATCH_GUI_VERSION ?? '5.3.0';
const REACT_VERSION = '16.14.0';

if (fs.existsSync(path.join(outDir, 'scratch-gui.js'))) {
  console.log('[scratch] 已存在，跳过下载（删除 public/scratch-editor 可强制重拉）');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ogoj-scratch-'));
console.log('[scratch] 临时目录', tmp);

function pack(spec) {
  const name = execFileSync('npm', ['pack', spec, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop();
  return path.join(tmp, name);
}

function extract(tgz, subdir) {
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });
  return path.join(tmp, subdir);
}

fs.mkdirSync(outDir, { recursive: true });

// 1) scratch-gui 的构建产物
const guiTgz = pack(`scratch-gui@${SCRATCH_GUI_VERSION}`);
const distDir = extract(guiTgz, 'package/dist');
fs.cpSync(distDir, outDir, { recursive: true });
console.log('[scratch] scratch-gui 已解压');

// 2) React 16 UMD（scratch-gui 只兼容 React 16）
fs.mkdirSync(path.join(outDir, 'vendor'), { recursive: true });
for (const pkg of ['react', 'react-dom']) {
  const tgz = pack(`${pkg}@${REACT_VERSION}`);
  extract(tgz, 'package');
  fs.copyFileSync(
    path.join(tmp, 'package', 'umd', `${pkg}.production.min.js`),
    path.join(outDir, 'vendor', `${pkg}.production.min.js`),
  );
  fs.rmSync(path.join(tmp, 'package'), { recursive: true, force: true });
  console.log(`[scratch] ${pkg} UMD 已就位`);
}

// 3) 宿主页
fs.copyFileSync(hostPage, path.join(outDir, 'index.html'));

// 4) 源映射太大，运行时用不到
for (const file of fs.readdirSync(outDir)) {
  if (file.endsWith('.map')) fs.rmSync(path.join(outDir, file));
}

fs.rmSync(tmp, { recursive: true, force: true });
const size = execFileSync('du', ['-sh', outDir], { encoding: 'utf8' }).trim();
console.log('[scratch] 完成 ->', outDir, size);
