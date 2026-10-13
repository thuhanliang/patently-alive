// 下载外部性状数据库的固定版本，并核对 sha256。
// 许可允许再分发的（dir: external）存到 data-external/ 并进仓库；其余存到 data-raw/（不进仓库）。
//   npm run data:fetch            下载缺的文件、检查内容、核对校验和
//   npm run data:fetch -- --pin   第一次下载后，把校验和写回 sources.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const dirs = { external: join(root, 'data-external'), raw: join(root, 'data-raw') };
const manifestPath = join(here, 'sources.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pin = process.argv.includes('--pin');

/** 粗查文件内容是不是对的（防止下载中断、或拿到报错网页）。返回问题描述，没问题返回 null。 */
function looksWrong(src, buf) {
  if (src.id === 'pantheria') {
    const head = buf.subarray(0, 2000).toString('latin1');
    if (!head.includes('MSW05_Binomial')) return '开头没有 PanTHERIA 的表头（MSW05_Binomial），可能是报错网页或下载不完整';
    if (buf.length < 1_000_000) return `文件只有 ${buf.length} 字节，PanTHERIA 应约 2.6 MB，可能下载不完整`;
  }
  if (src.id === 'anage') {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return '不是 zip 文件（开头不是 PK），可能是报错网页';
  }
  return null;
}

for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
let failed = false;
for (const src of manifest.sources) {
  const path = join(dirs[src.dir], src.file);
  if (!existsSync(path)) {
    console.log(`下载 ${src.name} …`);
    const part = `${path}.part`;
    try {
      // 用 curl：它会走系统里配置好的代理。先下载到 .part，成功了再改名，避免留下半截文件。
      execFileSync('curl', ['-sSfL', '--retry', '3', '-o', part, src.url], { stdio: 'inherit' });
      renameSync(part, path);
    } catch {
      rmSync(part, { force: true });
      console.error(`✗ 下载失败：${src.url}`);
      console.error(`  可以用浏览器打开这个地址手动下载，保存为 ${path}，再重新运行本命令。`);
      failed = true;
      continue;
    }
  }
  const buf = readFileSync(path);
  const problem = looksWrong(src, buf);
  if (problem) {
    console.error(`✗ ${path}：${problem}。删掉它重新下载。`);
    failed = true;
    continue;
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  if (src.sha256 === null) {
    if (pin) src.sha256 = sha;
    console.log(`${pin ? '已记录' : '尚未记录（加 --pin 记录）'}校验和 ${src.id}: ${sha}`);
  } else if (src.sha256 !== sha) {
    console.error(`✗ ${src.id} 的内容和记录的版本不同：${sha} ≠ ${src.sha256}`);
    failed = true;
  } else {
    console.log(`✓ ${src.id} 校验和一致`);
  }
}
if (pin && !failed) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (failed) process.exit(1);
