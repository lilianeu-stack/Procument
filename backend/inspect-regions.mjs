import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, channels } = info;
const hex = (x, y) => {
  const i = (y * width + x) * channels;
  return `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

function report(name, x1, y1, x2, y2) {
  const counts = new Map();
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const c = hex(x, y);
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  console.log(`\n${name} (${x1},${y1})-(${x2},${y2})`);
  for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(c, n);
}

report('header', 122, 42, 1033, 109);
report('body top', 122, 110, 1033, 250);
report('body middle', 122, 250, 1033, 500);
report('body bottom', 122, 500, 1033, 704);

const greenish = new Map();
for (let y = 37; y <= 704; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * channels;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (g > r + 15 && g > b + 15) {
      const c = hex(x, y);
      greenish.set(c, (greenish.get(c) || 0) + 1);
    }
  }
}
console.log('\nGreenish colors:', [...greenish.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
