import sharp from 'sharp';

const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Signatures arrive as data URLs so the existing JSON API can carry them.
// They are decoded and re-encoded here: nothing supplied by the browser is
// written to storage or returned to clients verbatim.
export async function normalizeSignature(value, label = 'Signature') {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'string' ? value : value?.data;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw httpError(400, `Choose an image for the ${label.toLowerCase()} signature.`);
  }
  const match = raw.match(DATA_URL);
  const declaredType = match ? match[1].toLowerCase() : null;
  const base64 = (match ? match[2] : raw).replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw httpError(400, `The ${label.toLowerCase()} signature could not be read.`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw httpError(400, `The ${label.toLowerCase()} signature is empty.`);
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    throw httpError(400, `${label} images must be 5 MB or smaller.`);
  }
  try {
    const image = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      throw httpError(400, 'Only JPG, PNG and WebP signature images are supported.');
    }
    if (declaredType && declaredType !== `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}`) {
      throw httpError(400, `The ${label.toLowerCase()} signature file type does not match its contents.`);
    }
    const webp = await image
      .rotate()
      .resize(900, 320, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();
    return `data:image/webp;base64,${webp.toString('base64')}`;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, `The ${label.toLowerCase()} signature image is corrupt or unsupported.`);
  }
}
