/* 满规模注入变换：对 full 输入 JSON 做 16MiB 分块的带引号 token 流式替换，
   等价于 07 小规模 mutate() 对整棵 JSON 树的全量字符串替换。
   注入串均不含需要 JSON 转义的字符，带引号替换保持 JSON 合法。
   用法：node mutate-full-injection.cjs <输入目录> <输出目录> */
const fs = require('fs');
const path = require('path');

const NAME = 'function_00_long_descriptive_component_for_navigation';
const FILE = '/workspace/project/src/bulk/unit_000002_long_descriptive_component_for_navigation.c';
const INJECTED_NAME = '@@DATA@@</script><svg onload=window.__recordInjected=1>';
const INJECTED_FILE =
  '/workspace/project/src/bulk/<img src=x onerror=window.__recordInjected=1>.c';
const REPLACEMENTS = new Map([
  ['"' + NAME + '"', '"' + INJECTED_NAME + '"'],
  ['"' + FILE + '"', '"' + INJECTED_FILE + '"'],
]);

function streamReplace(input, output) {
  const fd = fs.openSync(input, 'r');
  const out = fs.openSync(output, 'w');
  const CH = 16 * 1024 * 1024;
  const buf = Buffer.alloc(CH);
  const counts = {};
  for (const token of REPLACEMENTS.keys()) counts[token] = 0;
  let tail = '';
  let read;
  while ((read = fs.readSync(fd, buf, 0, CH, null)) > 0) {
    let text = tail + buf.toString('utf8', 0, read);
    // 保留最长 token 长度的边界，避免跨块 token 被截断。
    const keep = 512;
    const cut = Math.max(0, text.length - keep);
    tail = text.slice(cut);
    text = text.slice(0, cut);
    for (const [token, replacement] of REPLACEMENTS) {
      let index = text.indexOf(token);
      while (index !== -1) {
        counts[token]++;
        text = text.slice(0, index) + replacement + text.slice(index + token.length);
        index = text.indexOf(token, index + replacement.length);
      }
    }
    fs.writeSync(out, text);
  }
  let rest = tail;
  for (const [token, replacement] of REPLACEMENTS) {
    let index = rest.indexOf(token);
    while (index !== -1) {
      counts[token]++;
      rest = rest.slice(0, index) + replacement + rest.slice(index + token.length);
      index = rest.indexOf(token, index + replacement.length);
    }
  }
  fs.writeSync(out, rest);
  fs.closeSync(out);
  fs.closeSync(fd);
  return counts;
}

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) {
  console.error('用法：node mutate-full-injection.cjs <输入目录> <输出目录>');
  process.exit(2);
}
fs.mkdirSync(outputDir, { recursive: true });
const summary = { replacements: {}, sides: {} };
for (const side of ['baseline', 'current']) {
  const counts = streamReplace(
    path.join(inputDir, side + '.json'),
    path.join(outputDir, side + '.json')
  );
  summary.sides[side] = counts;
  for (const token of Object.keys(counts)) {
    summary.replacements[token] = (summary.replacements[token] || 0) + counts[token];
  }
}
fs.copyFileSync(path.join(inputDir, 'manifest.json'), path.join(outputDir, 'manifest.json'));
for (const counts of Object.values(summary.sides)) {
  for (const count of Object.values(counts)) {
    if (count <= 0) {
      console.error('替换计数为零，token 未命中：' + JSON.stringify(summary));
      process.exit(1);
    }
  }
}
console.log(JSON.stringify(summary));
