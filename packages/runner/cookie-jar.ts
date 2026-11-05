/**
 * Virtual cookie jar for the Service Worker
 * 
 * Manages cookies across requests since Service Workers don't have
 * automatic access to the browser's Cookie header for intercepted requests.
 */

export interface CookieJar {
  setCookies(setCookieHeaders: string[], url: string): void;
  getCookieHeader(url: string): string | null;
  clear(): void;
}

interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export class CookieJarImpl implements CookieJar {
  private cookies: Map<string, Cookie> = new Map();

  setCookies(setCookieHeaders: string[], url: string): void {
    const urlObj = new URL(url);
    
    for (const header of setCookieHeaders) {
      const cookie = this.parseSetCookie(header, urlObj);
      if (cookie) {
        const key = `${cookie.name}:${cookie.domain || urlObj.hostname}:${cookie.path || '/'}`;
        this.cookies.set(key, cookie);
      }
    }
  }

  getCookieHeader(url: string): string | null {
    const urlObj = new URL(url);
    const now = new Date();
    const matchingCookies: Cookie[] = [];

    for (const cookie of this.cookies.values()) {
      // Check expiration
      if (cookie.expires && cookie.expires < now) {
        continue;
      }

      // Check domain
      if (cookie.domain) {
        if (!this.domainMatches(urlObj.hostname, cookie.domain)) {
          continue;
        }
      }

      // Check path
      if (cookie.path) {
        if (!urlObj.pathname.startsWith(cookie.path)) {
          continue;
        }
      }

      // Check secure
      if (cookie.secure && urlObj.protocol !== 'https:') {
        continue;
      }

      matchingCookies.push(cookie);
    }

    if (matchingCookies.length === 0) {
      return null;
    }

    return matchingCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }

  private parseSetCookie(header: string, url: URL): Cookie | null {
    const parts = header.split(';').map((p) => p.trim());
    const [nameValue, ...attributes] = parts;
    
    if (!nameValue) return null;
    
    const eqIndex = nameValue.indexOf('=');
    if (eqIndex === -1) return null;
    
    const name = nameValue.slice(0, eqIndex).trim();
    const value = nameValue.slice(eqIndex + 1).trim();
    
    const cookie: Cookie = { name, value };
    
    for (const attr of attributes) {
      const eqIdx = attr.indexOf('=');
      const attrName = (eqIdx === -1 ? attr : attr.slice(0, eqIdx)).toLowerCase();
      const attrValue = eqIdx === -1 ? '' : attr.slice(eqIdx + 1);
      
      switch (attrName) {
        case 'domain':
          cookie.domain = attrValue.startsWith('.') ? attrValue.slice(1) : attrValue;
          break;
        case 'path':
          cookie.path = attrValue;
          break;
        case 'expires':
          cookie.expires = new Date(attrValue);
          break;
        case 'max-age':
          cookie.maxAge = parseInt(attrValue, 10);
          if (!isNaN(cookie.maxAge)) {
            cookie.expires = new Date(Date.now() + cookie.maxAge * 1000);
          }
          break;
        case 'secure':
          cookie.secure = true;
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'samesite':
          const lower = attrValue.toLowerCase();
          if (lower === 'strict' || lower === 'lax' || lower === 'none') {
            cookie.sameSite = (lower.charAt(0).toUpperCase() + lower.slice(1)) as Cookie['sameSite'];
          }
          break;
      }
    }
    
    // Default domain and path
    if (!cookie.domain) {
      cookie.domain = url.hostname;
    }
    if (!cookie.path) {
      cookie.path = '/';
    }
    
    return cookie;
  }

  private domainMatches(hostname: string, cookieDomain: string): boolean {
    if (hostname === cookieDomain) return true;
    if (hostname.endsWith('.' + cookieDomain)) return true;
    return false;
  }
}
