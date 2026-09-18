export function posterSrc(url?: string | null) {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('/api/proxy/image')) return url;
    if (!/^https?:\/\//i.test(url)) return url;
    return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}
