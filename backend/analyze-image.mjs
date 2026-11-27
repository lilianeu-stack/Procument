import sharp from 'sharp';

const files = process.argv.slice(2);
const palette = [
  ['W', [255, 255, 255]],
  ['K', [0, 0, 0]],
  ['D', [35, 45, 55]],
  ['g', [124, 179, 66]],
  ['G', [40, 120, 60]],
  ['b', [30, 90, 140]],
  ['B', [20, 60, 110]],
  ['r', [200, 50, 50]],
  ['y', [230, 190, 60]],
  ['n', [180, 180, 180]],
  ['.', [235, 235, 235]],
];

function nearest(r, g, b) {
  let best = '?';
  let bestDist = Infinity;
  for (const [ch, p] of palette) {
    const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = ch; }
  }
  return best;
}

for (const file of files) {
  const meta = await sharp(file).metadata();
  const size = 80;
  const height = Math.max(1, Math.round(size * meta.height / meta.width));
  const { data, info } = await sharp(file)
    .resize(size, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log(`\n=== ${file} ===`);
  console.log(`${meta.width}x${meta.height} -> ${info.width}x${info.height}`);
  for (let y = 0; y < info.height; y += 1) {
    let row = '';
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      row += nearest(data[i], data[i + 1], data[i + 2]);
    }
    console.log(row);
  }

  const raw = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < raw.data.length; i += raw.info.channels * 4) {
    const r = Math.round(raw.data[i] / 16) * 16;
    const g = Math.round(raw.data[i + 1] / 16) * 16;
    const b = Math.round(raw.data[i + 2] / 16) * 16;
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('\nTop quantized colors:');
  for (const [color, count] of top) console.log(color, count);
}
