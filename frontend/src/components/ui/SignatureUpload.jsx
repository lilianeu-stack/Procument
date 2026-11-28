import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The selected signature could not be read.'));
    reader.readAsDataURL(file);
  });
}

export default function SignatureUpload({ label, value, onChange, disabled = false }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!ACCEPTED.includes(file.type)) {
      setError('Choose a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Signature images must be 5 MB or smaller.');
      return;
    }
    setBusy(true);
    try { onChange(await readImage(file)); }
    catch (exception) { setError(exception.message || 'The image could not be read.'); }
    finally { setBusy(false); }
  }

  return <div className="rounded-lg border border-brand bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-extrabold uppercase tracking-wide text-black">{label}</span>
      {value && <button type="button" disabled={disabled} onClick={() => onChange(null)}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-black disabled:opacity-50">
        <Trash2 size={12} />Remove
      </button>}
    </div>
    <div className="mt-2 rounded-lg border border-dashed border-brand bg-white px-3 py-2">
      <div className="flex min-h-[64px] min-w-0 items-center">
        {value
          ? <img src={value} alt={`${label} signature`} className="max-h-16 max-w-full object-contain" />
          : <span className="text-[10px] text-black">No signature uploaded yet.</span>}
      </div>
      <button type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand px-2.5 py-1.5 text-[10px] font-bold text-black disabled:opacity-50">
        <ImagePlus size={13} />{busy ? 'Reading…' : value ? 'Replace image' : 'Upload image'}
      </button>
      <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} onChange={choose} className="hidden" aria-label={`Upload ${label} signature`} />
    </div>
    {error && <p className="mt-1 text-[10px] font-semibold text-black">{error}</p>}
  </div>;
}
