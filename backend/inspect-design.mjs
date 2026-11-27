import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const key = (x, y) => {
  const i = (y * width + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const hex = ([r, g, b]) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const counts = new Map();
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const color = hex(key(x, y));
    counts.set(color, (counts.get(color) || 0) + 1);
  }
}
console.log('Exact dominant colors:');
for (const [color, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(color, count);
}

const targets = ['#FFFFFF', '#F4F7F6', '#123D3A', '#F8FAFC', '#F1F5F9', '#172A39', '#CFD0D1', '#475569', '#7CB342'];
console.log('\nBounding boxes:');
for (const target of targets) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (hex(key(x, y)) !== target) continue;
      total += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  console.log(target, { total, minX, minY, maxX, maxY });
}

function runs(values) {
  const result = [];
  let start = 0;
  let current = values[0];
  for (let index = 1; index <= values.length; index += 1) {
    if (index === values.length || values[index] !== current) {
      result.push(`${start}-${index - 1}:${current}`);
      start = index;
      current = values[index];
    }
  }
  return result.filter((run) => Number(run.split(':')[0].split('-')[1]) - Number(run.split(':')[0].split('-')[0]) >= 15).join(' ');
}

console.log('\nSelected row runs (>=16 px, quantized):');
for (const y of [0, 10, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 240, 280, 320, 360, 400, 440, 480, 520, 560, 600, 650, 700]) {
  if (y >= height) continue;
  const row = [];
  for (let x = 0; x < width; x += 1) {
    const [r, g, b] = key(x, y);
    const q = [r, g, b].map((value) => Math.round(value / 16) * 16);
    row.push(hex(q));
  }
  console.log(`y=${y}`, runs(row));
}
