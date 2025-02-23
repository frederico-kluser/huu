const isValidUrl = (url: string): boolean => {
  if (!url) return false;
  let baseUrl = url;
  if (baseUrl.includes('*')) {
    if (!baseUrl.endsWith('/*')) return false;
    baseUrl = baseUrl.slice(0, -2);
  }
  if (baseUrl.startsWith('//')) {
    baseUrl = `http:${baseUrl}`;
  } else if (!/^https?:\/\//.test(baseUrl)) {
    baseUrl = `http://${baseUrl}`;
  }
  try {
    const urlObj = new URL(baseUrl);
    const hostnameParts = urlObj.hostname.split('.');
    if (hostnameParts.length < 2) return false;
    const tld = hostnameParts[hostnameParts.length - 1];
    if (tld.length < 2) return false;
    return true;
  } catch (error) {
    return false;
  }
};

export default isValidUrl;
