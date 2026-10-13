// 下载外部性状数据库的固定版本，并核对 sha256。
// 许可允许再分发的（dir: external）存到 data-external/ 并进仓库；其余存到 data-raw/（不进仓库）。
//   npm run data:fetch            下载缺的文件、核对校验和
//   npm run data:fetch -- --pin   第一次下载后，把校验和写回 sources.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const root = join(here, '..', '..');
const dirs = { external: join(root, 'data-external'), raw: join(root, 'data-raw') };
const manifestPath = join(here, 'sources.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pin = process.argv.includes('--pin');

for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
let failed = false;
for (const src of manifest.sources) {
  const path = join(dirs[src.dir], src.file);
  if (!existsSync(path)) {
    console.log(`下载 ${src.name} …`);
    try {
      // 用 curl：它会走环境里配置好的代理。
      execFileSync('curl', ['-sSfL', '--retry', '3', '-o', path, src.url], { stdio: 'inherit' });
    } catch {
      console.error(`✗ 下载失败：${src.url}`);
      console.error(`  可以用浏览器打开这个地址手动下载，保存为 ${path}，再重新运行本命令。`);
      failed = true;
      continue;
    }
  }
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (src.sha256 === null) {
    if (pin) src.sha256 = sha;
    console.log(`${pin ? '已记录' : '尚未记录'}校验和 ${src.id}: ${sha}`);
  } else if (src.sha256 !== sha) {
    console.error(`✗ ${src.id} 的内容和记录的版本不同：${sha} ≠ ${src.sha256}`);
    failed = true;
  } else {
    console.log(`✓ ${src.id} 校验和一致`);
  }
}
if (pin) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (failed) process.exit(1);
