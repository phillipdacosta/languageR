export function youtubeThumbnailFromVideoUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  const m = u.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

export function detectVideoType(url: string): 'youtube' | 'vimeo' | 'upload' {
  const u = url.trim().toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('vimeo.com')) return 'vimeo';
  return 'upload';
}

/** Direct file / GCS URLs play in-app with expo-video; YouTube/Vimeo use thumbnail + browser */
export function shouldPlayIntroVideoInline(url: string, videoType: 'upload' | 'youtube' | 'vimeo'): boolean {
  if (videoType === 'youtube' || videoType === 'vimeo') return false;
  const u = url.trim().toLowerCase();
  if (!u) return false;
  if (u.includes('storage.googleapis.com')) return true;
  if (u.endsWith('.mp4') || u.endsWith('.mov') || u.endsWith('.m4v') || u.includes('.mp4?') || u.includes('.mov?')) {
    return true;
  }
  return videoType === 'upload';
}
