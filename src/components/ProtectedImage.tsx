import { ImageOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchProtectedBlob } from '../lib/api';

interface ProtectedImageProps {
  photoId: number;
  alt: string;
  className?: string;
}

export function ProtectedImage({ photoId, alt, className = '' }: ProtectedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    fetchProtectedBlob(`/api/uploads/${photoId}`)
      .then(({ blob }) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message || 'Gambar gagal dimuatkan.');
        setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [photoId, retryCount]);

  if (loading) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-500">
        Memuatkan gambar...
      </div>
    );
  }

  if (error || !objectUrl) {
    return (
      <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 text-center text-xs text-slate-600">
        <ImageOff className="h-5 w-5 text-slate-400" />
        <span>{error || 'Gambar tidak dapat dipaparkan.'}</span>
        <button
          type="button"
          onClick={() => setRetryCount((c) => c + 1)}
          className="mt-1 inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Muat Semula Gambar</span>
        </button>
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      className={`max-h-[420px] w-auto max-w-full rounded-lg border border-slate-200 object-contain mx-auto ${className}`}
    />
  );
}
