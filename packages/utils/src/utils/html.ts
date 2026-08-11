// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
import pkg from 'crypto-js'
import type { JSDOM as JSDOMType, VirtualConsole as VirtualConsoleType } from 'jsdom'
import { extractTextComponents } from './utils.js'
import { CompressionResult, ExtractionResult, MasterStyleMap, OriginalTagInfo } from '../types/html.js'
import { Configuration } from '../types/configuration.js'
import { FlatJSON } from '../types/translation.js'

const { SHA256 } = pkg

if (typeof window === 'undefined') {
  global.Node = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    // Add other node types if needed
  } as any
}

export const FRENGLISH_DATA_KEY = 'data-frenglish-key'

// Attributes we replace with placeholders
export const TRANSLATABLE_ATTRIBUTES = new Set([
  'alt', 'title', 'description', 'placeholder',
  'aria-label', 'aria-valuetext',
  'data-tooltip', 'data-title', 'accesskey', 'prompt', 'label', 'textarea',
])

// – Tags whose inner‑text blobs we may collapse as a single placeholder
const COLLAPSIBLE_TAGS = [
  'p', 'li', 'dt', 'dd', 'caption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'legend', 'summary', 'th', 'td', 'div',
]
const COLLAPSIBLE_SET = new Set(COLLAPSIBLE_TAGS)

// – If a container's children are *only* these tags (and no text),
//   treat children individually instead of collapsing the parent
const ATOMIC_CHILD_SET = new Set([
  'label', 'input', 'textarea', 'button', 'select', 'option',
  'img', 'a', 'picture', 'source',
])

const DO_NOT_COLLAPSE_CLASSES = new Set([
  // --- Navigation & Interactive ---
  'awb-menu__li',
  'awb-submenu__li',
  'menu-item',
  'breadcrumb',
  'pagination',
  'page-numbers',
  'tab',
  // --- Layout & Grid (Page Builders) ---
  'card',
  'col',
  'column',
  'fusion-builder-column',
  'fusion-layout-column',
  'elementor-widget-container',
  'pricing-table',
  // --- Widgets & Modules ---
  'slide',
  'carousel-item',
  'swiper-slide',
  'accordion-item',
  'testimonial',
  'modal',
  // --- Forms ---
  'form-group',
  'form-row',
]);

// – Tags (and matching <script> / <style>) that we *never* walk for text
export const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'code', 'pre', 'template', 'svg'])

// – Heavy / structural nodes that force a parent not to collapse
const HEAVY_LEAF_SELECTOR =
  'script,style,iframe,video,audio,object,embed,canvas,noscript,svg,' +
  'table,ul,ol,dl,div:not(:empty),' + COLLAPSIBLE_TAGS.join(',')

export const PLACEHOLDER_TAG_RE = /<(?:sty|href|excl)\d+\b[^>]*>/i;
// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Injects the language segment into a path for canonical URLs.
 * Preserves trailing slash from original path.
 */
function injectLanguageIntoCanonicalPath(path: string, lang: string, skipPrefix = false): string {
  const lowerLang = (lang || '').toLowerCase().trim();
  if (!lowerLang && !skipPrefix) return path;

  if (!path) path = '/';

  // Normalize multiple slashes
  let basePath = path.replace(/\/{2,}/g, '/');
  if (!basePath.startsWith('/')) basePath = '/' + basePath;

  // IMPORTANT: Remember if original path had trailing slash
  const hadTrailingSlash = basePath.length > 1 && basePath.endsWith('/');

  // Drop trailing slash for segment logic
  let work = basePath;
  if (hadTrailingSlash) {
    work = work.slice(0, -1);
  }

  const segs = work.split('/').filter(Boolean);
  const isLangLike = (s: string) =>
    /^[a-z]{2}(?:-[a-z0-9]{2,})?$/.test((s || '').toLowerCase());

  // Helper to restore trailing slash if original had one
  const maybeAddTrailingSlash = (p: string) => {
    if (!hadTrailingSlash) return p;
    if (p === '/') return '/';  // Don't add trailing slash to root
    return p.endsWith('/') ? p : p + '/';
  };

  // If skipPrefix, just return normalized path without language
  if (skipPrefix) {
    if (!segs.length) return '/';
    // Strip existing language prefix if present
    if (segs[0] === 'proxy' && segs.length >= 2) {
      const host = segs[1];
      const rest = segs.slice(2);
      const newRest = rest.length && isLangLike(rest[0]) ? rest.slice(1) : rest;
      const result = newRest.length ? '/' + ['proxy', host, ...newRest].join('/') : '/' + ['proxy', host].join('/');
      return maybeAddTrailingSlash(result);
    }
    const rest = segs.length && isLangLike(segs[0]) ? segs.slice(1) : segs;
    const result = rest.length ? '/' + rest.join('/') : '/';
    return maybeAddTrailingSlash(result);
  }

  // Root: just "/"
  if (!segs.length) {
    return `/${lowerLang}`;  // No trailing slash for language-only root
  }

  // Proxy pattern: /proxy/{host}/[lang]/...
  if (segs[0] === 'proxy' && segs.length >= 2) {
    const host = segs[1];
    const rest = segs.slice(2);

    if (rest.length && isLangLike(rest[0]) && rest[0].toLowerCase() === lowerLang) {
      // already has this lang - return normalized with original trailing slash preference
      return maybeAddTrailingSlash(work);
    }

    const newRest =
      rest.length && isLangLike(rest[0])
        ? [lowerLang, ...rest.slice(1)]
        : [lowerLang, ...rest];

    const result = '/' + ['proxy', host, ...newRest].join('/');
    return maybeAddTrailingSlash(result);
  }

  // Non-proxy path
  if (segs.length && isLangLike(segs[0]) && segs[0].toLowerCase() === lowerLang) {
    // Already prefixed with this language - return with original trailing slash preference
    return maybeAddTrailingSlash(work);
  }

  const rest =
    segs.length && isLangLike(segs[0])
      ? segs.slice(1) // replace existing lang prefix
      : segs;         // prepend language

  const result = '/' + [lowerLang, ...rest].join('/');
  return maybeAddTrailingSlash(result);
}

/**
 * Strips frx_from_lang parameter from a URL string
 */
function stripFrxFromLang(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.searchParams.delete('frx_from_lang');
    let result = url.toString();
    // Clean up any trailing ? or = that might be left after parameter removal
    // This handles cases where the parameter was the only one or had no value
    result = result.replace(/[?=&]+$/, '');
    // If we removed the last parameter and left a trailing ?, remove it
    result = result.replace(/\?$/, '');
    return result;
  } catch {
    // If URL parsing fails, try simple string replacement as fallback
    let result = urlString
      // Match parameter with value: ?frx_from_lang=value or &frx_from_lang=value
      .replace(/[?&]frx_from_lang=[^&"'\s]*/g, '')
      // Match parameter with just equals: ?frx_from_lang= or &frx_from_lang=
      .replace(/[?&]frx_from_lang=/g, '');

    // Clean up any trailing ? or = that might be left
    result = result.replace(/[?=&]+$/, '');
    // Remove trailing ? if it's the last character
    result = result.replace(/\?$/, '');
    return result;
  }
}

/**
 * Normalizes a URL path by removing trailing = signs.
 * PRESERVES trailing slashes to respect site conventions.
 */
function normalizeUrlPath(path: string): string {
  if (!path || path === '/') return '/';
  // Remove trailing = signs (these shouldn't be in paths)
  return path.replace(/=+$/, '');
}

/**
 * Helper function to insert canonical link in the optimal position in head.
 * Tries to insert after title tag, or after charset/viewport meta tags.
 */
function insertCanonicalLink(doc: Document, canonicalLink: HTMLLinkElement): void {
  // Try to insert after title tag if it exists
  const titleTag = doc.head.querySelector('title');
  if (titleTag) {
    // Insert after title (before its next sibling, or at end if no next sibling)
    if (titleTag.nextSibling) {
      doc.head.insertBefore(canonicalLink, titleTag.nextSibling);
    } else {
      doc.head.appendChild(canonicalLink);
    }
    return;
  }

  // If no title, try to insert after charset or viewport meta tags
  const charset = doc.head.querySelector('meta[charset]');
  const viewport = doc.head.querySelector('meta[name="viewport"]');
  const insertAfter = viewport || charset;
  if (insertAfter && insertAfter.nextSibling) {
    doc.head.insertBefore(canonicalLink, insertAfter.nextSibling);
  } else {
    // Fallback: append to head
    doc.head.appendChild(canonicalLink);
  }
}

/**
 * Injects a canonical link into the document head if one doesn't already exist.
 * Constructs the canonical URL based on the document's base URL and current language.
 * Uses translated slug from URL map if available.
 * Respects showOriginLanguageCode config.
 */
function injectCanonicalLinkIfMissing(
  doc: Document,
  currentLanguage: string,
  config?: Configuration
): void {
  // Ensure head exists
  if (!doc.head) {
    const head = doc.createElement('head');
    if (doc.documentElement) {
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    } else {
      return; // Can't inject without documentElement
    }
  }

  // Check if canonical link already exists
  const existingCanonical = doc.head.querySelector('link[rel="canonical"]');
  if (existingCanonical) return;

  // Determine if we should skip language prefix
  const isOriginLang = !!(currentLanguage && config?.originLanguage &&
    currentLanguage.toLowerCase() === config.originLanguage.toLowerCase());
  const skipLangPrefix = isOriginLang && config?.showOriginLanguageCode === false;

  // Try to get the current URL from various sources
  let baseUrl = '';

  // Try doc.baseURI
  if (!baseUrl || baseUrl === 'about:blank' || baseUrl === 'about:srcdoc') {
    baseUrl = doc.baseURI || '';
  }

  // Try window.location (browser context)
  if (!baseUrl || baseUrl === 'about:blank' || baseUrl === 'about:srcdoc') {
    try {
      if (typeof window !== 'undefined' && window.location) {
        baseUrl = window.location.href;
      }
    } catch {
      // In server-side context, we might not have window.location
    }
  }

  // Try to extract from og:url meta tag
  if (!baseUrl || baseUrl === 'about:blank' || baseUrl === 'about:srcdoc') {
    try {
      const ogUrl = doc.querySelector('meta[property="og:url"]');
      if (ogUrl) {
        const content = ogUrl.getAttribute('content');
        if (content && (content.startsWith('http://') || content.startsWith('https://'))) {
          baseUrl = content;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // If we still don't have a URL, construct a relative canonical based on language
  // This ensures we always inject a canonical if we have a language
  if (!baseUrl || baseUrl === 'about:blank' || baseUrl === 'about:srcdoc') {
    try {
      // Use language prefix for canonical (or skip if showOriginLanguageCode is false)
      const canonicalPath = skipLangPrefix ? '/' : `/${currentLanguage}`;
      const normalizedPath = normalizeUrlPath(canonicalPath);

      const canonicalLink = doc.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      canonicalLink.setAttribute('href', normalizedPath);
      insertCanonicalLink(doc, canonicalLink);
    } catch {
      // If this fails, don't inject
    }
    return;
  }

  try {
    const url = new URL(baseUrl);
    let oldPath = url.pathname || '/';

    // If the URL is just localhost with no meaningful path, try to extract from og:url
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && oldPath === '/') {
      try {
        const ogUrl = doc.querySelector('meta[property="og:url"]');
        if (ogUrl) {
          const ogContent = ogUrl.getAttribute('content');
          if (ogContent && (ogContent.startsWith('http://') || ogContent.startsWith('https://'))) {
            const ogUrlObj = new URL(ogContent);
            oldPath = ogUrlObj.pathname || '/';
            // Update the base URL hostname and protocol from og:url if it's more meaningful
            if (ogUrlObj.hostname !== 'localhost' && ogUrlObj.hostname !== '127.0.0.1') {
              url.hostname = ogUrlObj.hostname;
              url.protocol = ogUrlObj.protocol;
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Use language injection for canonical path (respecting skipLangPrefix)
    const canonicalPath = injectLanguageIntoCanonicalPath(oldPath, currentLanguage, skipLangPrefix);

    // Normalize path (remove trailing slash except root)
    const normalizedPath = normalizeUrlPath(canonicalPath);
    url.pathname = normalizedPath;

    // Remove frx_from_lang parameter if present
    url.searchParams.delete('frx_from_lang');

    const canonicalUrl = url.toString();

    // Create and inject the canonical link
    const canonicalLink = doc.createElement('link');
    canonicalLink.setAttribute('rel', 'canonical');
    canonicalLink.setAttribute('href', canonicalUrl);
    insertCanonicalLink(doc, canonicalLink);
  } catch {
    // If URL construction fails, try relative path approach
    try {
      // Extract pathname from baseUrl if it's a full URL
      let path = '/';
      if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
        const url = new URL(baseUrl);
        path = url.pathname || '/';
      } else if (baseUrl.startsWith('/')) {
        path = baseUrl.split('?')[0].split('#')[0];
      }

      // Use language injection for canonical path (respecting skipLangPrefix)
      const canonicalPath = injectLanguageIntoCanonicalPath(path, currentLanguage, skipLangPrefix);

      const normalizedPath = normalizeUrlPath(canonicalPath);

      const canonicalLink = doc.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      canonicalLink.setAttribute('href', normalizedPath);
      insertCanonicalLink(doc, canonicalLink);
    } catch {
      // Final fallback: inject a simple language-based canonical (or root if skipLangPrefix)
      try {
        const canonicalLink = doc.createElement('link');
        canonicalLink.setAttribute('rel', 'canonical');
        canonicalLink.setAttribute('href', skipLangPrefix ? '/' : `/${currentLanguage}`);
        insertCanonicalLink(doc, canonicalLink);
      } catch {
        // If this also fails, don't inject
      }
    }
  }
}

/**
 * Rewrite canonical href so it includes the current language in the path.
 * Also strips frx_from_lang parameter and removes trailing slashes.
 * Uses translated slug from URL map if available.
 * Works for:
 *   - absolute URLs: "https://www.cloudflare.com/" -> "https://www.cloudflare.com/fr-ca"
 *   - relative / proxy URLs: "/proxy/cloudflare.com/" -> "/proxy/cloudflare.com/fr-ca"
 * 
 * @param skipLangPrefix - If true, removes language prefix instead of adding it
 *                         (used when showOriginLanguageCode is false for origin language)
 */
export function rewriteProxyCanonicalHref(
  href: string | null,
  currentLanguage?: string,
  skipLangPrefix = false
): string | null {
  if (!href) {
    return href;
  }

  const trimmed = href.trim();
  if (!trimmed) {
    return href;
  }

  // First, strip frx_from_lang parameter
  let cleaned = stripFrxFromLang(trimmed);

  if (!currentLanguage) {
    // Even without language, still clean the URL and remove trailing slash
    try {
      const url = new URL(cleaned);
      const normalizedPathname = normalizeUrlPath(url.pathname);
      url.pathname = normalizedPathname;
      const result = url.toString();
      // Final cleanup: remove any trailing "=" from the entire URL
      return result.replace(/=+$/, '');
    } catch {
      // Relative URL - remove trailing slash and preserve query/fragment
      let path = cleaned;
      let suffix = '';
      const qIndex = path.indexOf('?');
      const hIndex = path.indexOf('#');
      let cut = -1;

      if (qIndex >= 0 && hIndex >= 0) cut = Math.min(qIndex, hIndex);
      else if (qIndex >= 0) cut = qIndex;
      else if (hIndex >= 0) cut = hIndex;

      if (cut >= 0) {
        suffix = path.slice(cut);
        path = path.slice(0, cut);
      }

      const normalizedPath = normalizeUrlPath(path);
      // Clean up trailing "=" from suffix as well
      const cleanedSuffix = suffix.replace(/=+$/, '');
      const result = normalizedPath + cleanedSuffix;
      // Final cleanup: remove any trailing "=" from the entire URL (in case path itself had trailing "=")
      return result.replace(/=+$/, '');
    }
  }

  const lang = currentLanguage.toLowerCase();

  // Case 1: absolute URL (https://...)
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const url = new URL(cleaned);
      const oldPath = url.pathname || '/';
      const newPath = injectLanguageIntoCanonicalPath(oldPath, lang, skipLangPrefix);
      // Normalize path (remove trailing slash except root)
      const normalizedPath = normalizeUrlPath(newPath);
      url.pathname = normalizedPath;
      const result = url.toString();
      // Final cleanup: remove any trailing "=" from the entire URL
      return result.replace(/=+$/, '');
    } catch {
      // fall through to relative logic
    }
  }

  // Case 2: relative URL (including /proxy/...)
  let path = cleaned;
  let suffix = '';
  const qIndex = path.indexOf('?');
  const hIndex = path.indexOf('#');
  let cut = -1;

  if (qIndex >= 0 && hIndex >= 0) cut = Math.min(qIndex, hIndex);
  else if (qIndex >= 0) cut = qIndex;
  else if (hIndex >= 0) cut = hIndex;

  if (cut >= 0) {
    suffix = path.slice(cut);
    path = path.slice(0, cut);
  }

  const oldPath = path || '/';
  const newPath = injectLanguageIntoCanonicalPath(oldPath, lang, skipLangPrefix);
  // Normalize path (remove trailing slash except root)
  const normalizedPath = normalizeUrlPath(newPath);

  if (normalizedPath === oldPath && !suffix) {
    // Even when path doesn't change (e.g., origin language), ensure path is normalized (no trailing slash)
    // and clean up trailing "="
    const result = normalizedPath.replace(/=+$/, '');
    return result;
  }

  // Clean up trailing "=" from suffix as well
  const cleanedSuffix = suffix.replace(/=+$/, '');
  const result = normalizedPath + cleanedSuffix;
  // Final cleanup: remove any trailing "=" from the entire URL (in case path itself had trailing "=")
  return result.replace(/=+$/, '');
}

// match tag‑names like "sty0", "href12", "excl3"
const PLACEHOLDER_TAGNAME_RE = /^(?:sty|href|excl)\d+$/i

function matchesExcludedByConfig(el: Element, config: Configuration): boolean {
  const list = (config as any)?.excludedTranslationBlocks || [];
  // Accept both shapes:
  // 1) [{ selector: string, ...}, ...]
  // 2) [{ blocks: [{ selector: string }, ...] }, ...]
  for (const g of list) {
    if (g?.selector && el.matches?.(g.selector)) return true;
    if (Array.isArray(g?.blocks)) {
      for (const b of g.blocks) {
        if (b?.selector && el.matches?.(b.selector)) return true;
      }
    }
  }
  // Also allow the legacy class name used elsewhere
  if (el.matches?.('.no-translate')) return true;
  return false;
}


export function canonicalizeForHash(s: string): string {
  return String(s ?? '')
    .normalize('NFC')        // normalize combining marks
    .replace(/\r\n/g, '\n')  // CRLF → LF
    .replace(/\r/g, '\n')    // stray CR → LF
    .replace(/\u00A0/g, ' ') // NBSP → normal space
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // ZW chars & BOM
    .trim();
}

// Scan for placeholders that have an explicit closing tag in the raw string
export function scanPairedPlaceholders(raw: string) {
  const paired = new Set<string>()
  for (const m of raw.matchAll(/<\/((?:sty|href|excl)\d+)>/gi)) {
    paired.add(m[1].toLowerCase())
  }
  return paired
}

function serializeOpenPlaceholderTag(el: Element) {
  let s = `<${el.tagName.toLowerCase()}`
  for (const a of Array.from(el.attributes)) {
    s += ` ${a.name}="${String(a.value).replace(/"/g, '&quot;')}"`
  }
  s += '>'
  return s
}

function stampTranslated(el: Element, currentLanguage?: string) {
  if (!currentLanguage) return;
  const existing = el.getAttribute('translated-lang')
  // Allow overwrite when the stamp is missing or belongs to a different language.
  // Stale origin-language stamps (e.g. translated-lang="en-ca" on a fr-ca page)
  // must not block re-application of the target translation.
  if (!existing || existing.toLowerCase() !== currentLanguage.toLowerCase()) {
    el.setAttribute('translated-lang', currentLanguage);
  }
}

// Turn *unpaired* placeholder elements (e.g., <sty0> with no </sty0> in the raw)
// back into a TEXT node "<sty0>" followed by their children.
// This prevents the parser from auto‑inserting "</sty0>".
export function neutralizeUnpairedPlaceholders(root: Element | DocumentFragment, paired: Set<string>) {
  const all = Array.from(root.querySelectorAll('*'))
  for (const el of all) {
    const tag = el.tagName.toLowerCase()
    if (PLACEHOLDER_TAGNAME_RE.test(tag) && !paired.has(tag)) {
      const doc = el.ownerDocument!
      const frag = doc.createDocumentFragment()
      frag.appendChild(doc.createTextNode(serializeOpenPlaceholderTag(el)))
      while (el.firstChild) frag.appendChild(el.firstChild)
      el.replaceWith(frag)
    }
  }
}

const generatePlaceholder = (txt: string) => {
  const canon = canonicalizeForHash(txt.trim())
  const hash = SHA256(canon).toString()
  return hash
};

/**
 * Whether a keyed node's key should be discarded and reminted from its body.
 *
 * Only during origin-language extraction. Target-lang passes (including
 * `/request-translated-file`) must not remint: that path often runs with
 * injectDataKey=false, so dropping the key leaves English with no anchor for
 * mismatch-apply / setInnerContent — bust then serves untranslated HTML.
 *
 * Only on compress=true passes. Keys are minted in the compressed form, so a
 * compress=false pass would hash the same body differently and overwrite a
 * perfectly good anchor with a non-canonical one. Reminting is therefore
 * restricted to the pass that mints keys in the first place.
 *
 * - Origin-lang + compress + origin stamp or unstamped: always remint. A key
 *   here is untrusted whether or not it matches the body: customers paste
 *   served HTML back into their CMS, so origin markup can carry keys we never
 *   minted and never registered in the text map. Skipping those left the string
 *   invisible to extraction forever — it never reached the map, so nothing could
 *   request a translation for it.
 * - Origin-lang + target stamp: never remint (body is translated).
 * - Target-lang pass, or compress=false: never remint.
 */
function shouldInvalidateStaleKeys(
  el: Element,
  currentLanguage: string | undefined,
  config: Configuration,
  compress: boolean,
): boolean {
  if (!compress) return false
  const originLang = (config.originLanguage || '').toLowerCase()
  if (!originLang) return false
  const current = (currentLanguage || '').toLowerCase()
  if (current !== originLang) return false

  const stamped = (el.getAttribute('translated-lang') || '').toLowerCase()
  // Unstamped nodes are treated as origin content on an origin-lang pass.
  if (!stamped) return true
  return stamped === originLang
}

function isHashPlaceholder(value: string | null | undefined, hash: string): boolean {
  const v = (value || '').trim()
  return !!v && /^[a-f0-9]{64}$/i.test(v) && v.toLowerCase() === hash.toLowerCase()
}

export type TextMaps = { forward: Record<string, string>; reverse: Record<string, string> }

async function upsertPlaceholder(raw: string | undefined | null, maps: TextMaps, inject: boolean, config: Configuration, compress: boolean, masterStyleMap: MasterStyleMap) {
  if (!raw) return null
  const { leadingSpace, middleText, trailingSpace } = extractTextComponents(raw)
  if (!middleText) return null

  let compressedMiddleTextString: string
  if (compress) {
    const compressedMiddleText = await getCompressedInLineWithStyleMap(middleText, config, masterStyleMap)
    compressedMiddleTextString = compressedMiddleText
  } else {
    compressedMiddleTextString = unescapeHtml(middleText)
  }

  const PH_TAG_RE = /<(\/?)(sty|href|excl)(\d+)([^>]*)>/gi;
  compressedMiddleTextString = compressedMiddleTextString.replace(
    PH_TAG_RE,
    (
      _full: string,
      slash: string = '',
      prefix: string,
      num: string,
      rest: string = ''
    ) => `<${slash}${prefix.toLowerCase()}${num}${rest}>`
  );

  const canonKey = canonicalizeForHash(compressedMiddleTextString)
  let hash = maps.reverse[canonKey]
  if (!hash) {
    hash = generatePlaceholder(compressedMiddleTextString)
    maps.forward[hash] = compressedMiddleTextString
    maps.reverse[canonKey] = hash
  }
  return {
    hash,
    newText: leadingSpace + (inject ? hash : compressedMiddleTextString) + trailingSpace,
  }
}

export async function createDocument(html: string, url?: string): Promise<Document> {
  // IMPORTANT: Do not remove this because this cannot load in the frontend.
  if (typeof window !== 'undefined' && window.document && !(globalThis as any).IS_UNIT_TEST) {
    return window.document
  }
  // Import JSDOM and VirtualConsole
  const { JSDOM, VirtualConsole } = (await import('jsdom')) as { JSDOM: typeof JSDOMType, VirtualConsole: typeof VirtualConsoleType };

  const virtualConsole = new VirtualConsole();

  // Listen for the generic 'jsdomError' event, which is type-safe.
  virtualConsole.on('jsdomError', (e) => {
    // Inside the handler, check if the error message is the one we want to suppress.
    if (e.message.includes('Could not parse CSS stylesheet')) {
      // If it is, simply return and do nothing, effectively silencing the error.
      return;
    }
  });

  // Pass the configured virtual console in the JSDOM options
  // If url is provided, set it as the url option to ensure baseURI is set
  const dom = new JSDOM(html, {
    virtualConsole,
    url: url || 'http://localhost',
  });

  return dom.window.document;
}

// ---------------------------------------------------------------------------
// Node‑level guards
// ---------------------------------------------------------------------------
const isAtomicContainer = (el: Element) => {
  if (!el.firstChild) return false
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) return false
    if (n.nodeType === Node.ELEMENT_NODE && !ATOMIC_CHILD_SET.has((n as Element).tagName.toLowerCase())) return false
  }
  return true
}

export const shouldCollapse = (el: Element) => {
  for (const className of DO_NOT_COLLAPSE_CLASSES) {
    if (el.classList.contains(className)) {
      return false;
    }
  }
  const tag = el.tagName.toLowerCase();

  if (Array.from(el.classList).some(cls => cls.startsWith('col-') || cls.startsWith('wp-block-'))) {
    return false;
  }

  if (tag === 'html' || tag === 'head' || tag === 'body' || SKIPPED_TAGS.has(tag)) return false;
  if (el.hasAttribute(FRENGLISH_DATA_KEY)) return false;
  if (el.querySelector(HEAVY_LEAF_SELECTOR)) return false;
  if (isAtomicContainer(el)) return false;
  if (tag === 'a' || COLLAPSIBLE_SET.has(tag)) return !!el.textContent?.trim();
  return false;
};

// ---------------------------------------------------------------------------
// Recursive processors
// ---------------------------------------------------------------------------
async function processAttributes(
  el: Element,
  maps: TextMaps,
  inject: boolean,
  config: Configuration,
  compress: boolean,
  injectDataKey: boolean,
  masterStyleMap: MasterStyleMap,
  currentLanguage?: string
) {
  const tag = el.tagName.toLowerCase()
  const mutate = !!inject; // ← single switch controlling visible writes

  // Determine if we should skip language prefix for canonical/og:url
  const isOriginLang = !!(currentLanguage && config.originLanguage &&
    currentLanguage.toLowerCase() === config.originLanguage.toLowerCase());
  const skipLangPrefix = isOriginLang && config.showOriginLanguageCode === false;

  // Generic attribute handling
  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    const keyAttr = `${FRENGLISH_DATA_KEY}-${attr}`
    const val = el.getAttribute(attr)
    if (el.hasAttribute(keyAttr)) {
      const existingHash = el.getAttribute(keyAttr) || ''
      // Injected placeholder form — still valid.
      if (isHashPlaceholder(val, existingHash)) continue
      // Only remint on origin-language passes for origin-stamped/unstamped nodes.
      if (!shouldInvalidateStaleKeys(el, currentLanguage, config, compress)) {
        continue
      }
      // Untrusted on origin content even when it still matches the value — a
      // pasted-in key is correct for the text yet absent from the text map.
      el.removeAttribute(keyAttr)
    }
    if (!val?.trim()) continue
    const rep = await upsertPlaceholder(val, maps, inject, config, compress, masterStyleMap)
    if (!rep) continue
    if (injectDataKey) el.setAttribute(keyAttr, rep.hash)
    // Only replace visible value when we're injecting placeholders
    if (mutate) {
      el.setAttribute(attr, rep.newText)
      stampTranslated(el, currentLanguage);
    }
  }

  // value="…" on buttons / inputs
  const valAttr = el.getAttribute('value')
  const type = el.getAttribute('type')?.toLowerCase() ?? ''
  if (
    valAttr &&
    (tag === 'button' || tag === 'option' ||
      (tag === 'input' && ['button', 'submit', 'reset'].includes(type)))
  ) {
    const rep = await upsertPlaceholder(valAttr, maps, inject, config, compress, masterStyleMap)
    if (rep) {
      if (injectDataKey) el.setAttribute(`${FRENGLISH_DATA_KEY}-value`, rep.hash)
      if (mutate) {
        el.setAttribute('value', rep.newText)
        stampTranslated(el, currentLanguage);
      }
    }
  }

  // <link rel="canonical" href="/proxy/..."> — keep canonical in sync with language.
  // Gate on mutate: client extract uses window.document with injectPlaceholders=false,
  // and must not rewrite live SEO tags when only scanning for text/hash repair.
  if (mutate && tag === 'link') {
    const relRaw = el.getAttribute('rel') || '';
    const rel = relRaw.toLowerCase();
    if (rel && rel.split(/\s+/).includes('canonical')) {
      const href = el.getAttribute('href');
      // Always clean frx_from_lang and normalize trailing slashes, even without language
      const updated = rewriteProxyCanonicalHref(href, currentLanguage, skipLangPrefix);

      if (updated && updated !== href) {
        el.setAttribute('href', updated);
        stampTranslated(el, currentLanguage);
      } else if (href && (href.includes('frx_from_lang') || (href !== '/' && href.endsWith('/')))) {
        // Even if rewriteProxyCanonicalHref didn't change it, clean it if needed
        const cleaned = rewriteProxyCanonicalHref(href, currentLanguage, skipLangPrefix);
        if (cleaned && cleaned !== href) {
          el.setAttribute('href', cleaned);
        }
      }
    }
  }

  // <meta name|property|itemprop=... content="...">
  if (tag === 'meta') {
    const specificKeyAttr = `${FRENGLISH_DATA_KEY}-content`;

    const content = el.getAttribute('content') || '';
    if (!content.trim()) return;

    const isHash = /^[a-f0-9]{64}$/i.test(content);

    // Which key field is used on this tag?
    const rawKey =
      el.getAttribute('name') ||
      el.getAttribute('property') ||
      el.getAttribute('itemprop') ||
      '';
    const metaKey = rawKey.toLowerCase().trim();

    const explicitSkip = el.getAttribute('data-frenglish-skip') === 'content';
    const explicitForce = el.getAttribute('data-frenglish-force') === 'content';
    if (explicitSkip) return;

    // Special case: keep og:locale in sync with the translated language,
    // but never treat it as translatable content.
    if (metaKey === 'og:locale') {
      if (mutate && currentLanguage) {
        const mapped = languageToOgLocale(currentLanguage, content, config);
        if (mapped && mapped !== content) {
          el.setAttribute('content', mapped);
          stampTranslated(el, currentLanguage);
        }
      }
      // Always return here: og:locale is not part of the text map.
      return;
    }

    // Special case for og:url – rewrite URL path with language segment
    // Always strip frx_from_lang and remove trailing slashes, even without language
    if (metaKey === 'og:url') {
      if (mutate) {
        // Always normalize og:url - remove trailing slashes and frx_from_lang
        const updated = rewriteProxyCanonicalHref(content, currentLanguage, skipLangPrefix);
        if (updated) {
          // Always update if there's any difference (trailing slash, frx_from_lang, or language injection)
          if (updated !== content) {
            el.setAttribute('content', updated);
            stampTranslated(el, currentLanguage);
          } else if (content && ((content !== '/' && content.endsWith('/')) || content.endsWith('='))) {
            // Force normalization even if rewriteProxyCanonicalHref returned unchanged
            // This handles edge cases where the function might not detect the trailing slash or "="
            try {
              const url = new URL(content);
              const normalizedPath = normalizeUrlPath(url.pathname);
              if (normalizedPath !== url.pathname || content.endsWith('=')) {
                url.pathname = normalizedPath;
                let result = url.toString();
                // Clean up any trailing "="
                result = result.replace(/=+$/, '');
                if (result !== content) {
                  el.setAttribute('content', result);
                  stampTranslated(el, currentLanguage);
                }
              }
            } catch {
              // If URL parsing fails, try simple string replacement
              let normalized = content.replace(/\/+$/, '') || '/';
              // Also remove trailing "="
              normalized = normalized.replace(/=+$/, '');
              if (normalized !== content && normalized !== '/') {
                el.setAttribute('content', normalized);
                stampTranslated(el, currentLanguage);
              }
            }
          }
        }
      }
      // Do NOT treat og:url as translatable content.
      return;
    }

    // HARD blacklist: never hash/translate these keys unless explicitForce is set.
    const HARD_BLACKLIST_RE =
      /(?:^|:)(?:published_time|modified_time|updated_time|article:published_time|article:modified_time|date|datetime|release_date|expiry|expiration|url|image(?::(?:secure_url|url|width|height|type))?|video|audio|locale|site_name|site|app(?:[_:-]?id)?|id|token|verification|verify|robots|viewport|charset|theme-?color|color-?scheme|referrer|generator|format-detection|twitter:card|twitter:site|twitter:label1|twitter:data1|og:type)\b/;

    const looksLikeUrl = /^(?:https?:)?\/\//i.test(content) || /^(?:mailto:|tel:|data:)/i.test(content) || content.startsWith('/');
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content);
    const looksLikeHexId = /^[0-9a-f]{16,}$/i.test(content);
    const looksLikeDate = /^\d{4}-\d{2}-\d{2}(?:[ tT]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(content);
    const looksLikeJSON = /^[\[\{].*[\]\}]$/.test(content);

    const hardBlocked =
      HARD_BLACKLIST_RE.test(metaKey) ||
      looksLikeUrl || looksLikeEmail || looksLikeHexId || looksLikeDate || looksLikeJSON;

    const COPY_HINT_RE =
      /(^|:)(title|description|keywords?|alt|caption|headline|application-name|apple-mobile-web-app-title|label1|data1)$/;

    const allowByKey = COPY_HINT_RE.test(metaKey) || /:alt$/.test(metaKey);
    const shouldTranslate = explicitForce || (!hardBlocked && allowByKey);
    if (!shouldTranslate) return;

    // Build/Reuse placeholder
    let hash: string;
    let newText: string;

    if (isHash) {
      hash = content;
      newText = content; // already placeholder
    } else {
      const rep = await upsertPlaceholder(content, maps, inject, config, compress, masterStyleMap);
      if (!rep) return;
      hash = rep.hash;
      newText = rep.newText;
    }

    if (injectDataKey) {
      el.setAttribute(specificKeyAttr, hash);             // data-frenglish-key-content="..."
      el.setAttribute('data-frenglish-attr', 'content');  // tells applier which attribute to set
    }

    if (mutate) {
      el.setAttribute('content', newText);                // inject placeholder for apply step
      stampTranslated(el, currentLanguage);
    }
    return
  }
}

async function processDataValue(val: any, maps: TextMaps, inject: boolean, config: Configuration, compress: boolean, masterStyleMap: MasterStyleMap): Promise<any> {
  if (typeof val === 'string') {
    const rep = await upsertPlaceholder(val, maps, inject, config, compress, masterStyleMap)
    return rep?.newText
  }
  if (Array.isArray(val)) return Promise.all(val.map(v => processDataValue(v, maps, inject, config, compress, masterStyleMap)))
  if (val && typeof val === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(val)) out[k] = await processDataValue(v, maps, inject, config, compress, masterStyleMap)
    return out
  }
  return val
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function extractStrings(
  html: string,
  injectPlaceholders = true,
  config: Configuration,
  compress = true,
  injectDataKey = true,
  currentLanguage?: string
): Promise<ExtractionResult & { styleMap: MasterStyleMap }> {
  const maps: TextMaps = { forward: {}, reverse: {} }
  const masterStyleMap: MasterStyleMap = {}
  const doc = await createDocument(html)
  const originallyTagged = new WeakSet<Element>()
  doc.querySelectorAll(`[${FRENGLISH_DATA_KEY}]`).forEach(el => originallyTagged.add(el as Element))
  const NodeConsts = doc.defaultView?.Node ?? { ELEMENT_NODE: 1, TEXT_NODE: 3 }
  const mutate = !!injectPlaceholders // single switch for any visible write

  if (mutate && PLACEHOLDER_TAG_RE.test(html)) {
    try {
      const pairedInRaw = scanPairedPlaceholders(html) // e.g., set('sty0','href1',…)
      neutralizeUnpairedPlaceholders(doc.documentElement, pairedInRaw)
    } catch { }
  }

  const isUntranslatable = (element: Element): boolean => {
    let current: Element | null = element
    while (current) {
      if (
        (current as HTMLElement).id === 'wpadminbar' ||
        current.classList.contains('no-translate') ||
        current.classList.contains('no-translation') ||
        current.hasAttribute('data-no-translation') ||
        current.getAttribute('translate') === 'no' ||
        matchesExcludedByConfig(current, config) ||
        isDevToolsElement(current)
      ) {
        return true
      }
      current = current.parentElement
    }
    return false
  }

  // Helper to detect DevTools elements
  const isDevToolsElement = (el: Element): boolean => {
    // Check for common DevTools identifiers
    const id = (el as HTMLElement).id || ''
    const className = el.className || ''
    const classStr = typeof className === 'string' ? className : Array.from(className).join(' ')
    
    // DevTools often have specific IDs or class patterns
    if (
      id.includes('devtools') ||
      id.includes('chrome-devtools') ||
      classStr.includes('devtools') ||
      classStr.includes('chrome-devtools') ||
      // Check if element is in a shadow root (DevTools often use shadow DOM)
      (el.getRootNode && el.getRootNode() !== el.ownerDocument)
    ) {
      return true
    }
    
    // Check parent chain for DevTools containers
    let parent: Element | null = el.parentElement
    while (parent) {
      const parentId = (parent as HTMLElement).id || ''
      const parentClass = parent.className || ''
      const parentClassStr = typeof parentClass === 'string' ? parentClass : Array.from(parentClass).join(' ')
      
      if (
        parentId.includes('devtools') ||
        parentId.includes('chrome-devtools') ||
        parentClassStr.includes('devtools') ||
        parentClassStr.includes('chrome-devtools')
      ) {
        return true
      }
      parent = parent.parentElement
    }
    
    return false
  }

  // Helper to detect network request metadata patterns (from DevTools Network panel)
  const isNetworkRequestMetadata = (text: string): boolean => {
    if (!text || typeof text !== 'string') return false
    
    const trimmed = text.trim()
    
    // Patterns that indicate network request metadata:
    // - HTTP status codes and methods: "POST | 200", "GET | 404", etc.
    // - HTTP version: "HTTP/1.1 200"
    // - Timing info: "1s 577 ms", "115 ms", etc.
    // - Server headers: "nginx/1.18.0", "Apache/2.4"
    // - Request IDs: "requestId\t20650", "tabId\t1588404987"
    // - DevTools UI text: "réception des en-têtes", "premier octet", "terminé"
    // - Network panel labels: "en-têtes reçus", "serveur :"
    
    const networkPatterns = [
      /^(POST|GET|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\|\s*\d{3}/i, // "POST | 200"
      /HTTP\/\d\.\d\s+\d{3}/i, // "HTTP/1.1 200"
      /\d+\s*(s|ms|sec|msec)\s+\d+\s*ms/i, // "1s 577 ms", "115 ms"
      /(nginx|apache|server)\/[\d.]+/i, // "nginx/1.18.0"
      /(requestId|tabId|frameId)\s*[\d]+/i, // "requestId\t20650"
      /(réception des en-têtes|premier octet|terminé|en-têtes reçus|serveur\s*:)/i, // French DevTools UI
      /(receiving headers|first byte|finished|server\s*:)/i, // English DevTools UI
      /^<sty\d+>.*<\/sty\d+>$/i, // Styled placeholders like "<sty0>POST</sty0>"
    ]
    
    return networkPatterns.some(pattern => pattern.test(trimmed))
  }

  const walk = async (node: Node): Promise<void> => {
    if (node.nodeType === NodeConsts.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (isUntranslatable(el)) return

      const tag = el.tagName.toLowerCase()
      if (SKIPPED_TAGS.has(tag)) {
        if (tag === 'script' && el.id === '__NEXT_DATA__') {
          try {
            const json = JSON.parse(el.textContent || '{}')
            if (json?.props) {
              await processDataValue(json.props, maps, injectPlaceholders, config, compress, masterStyleMap)
              if (mutate) el.textContent = JSON.stringify(json)
            }
          } catch { }
        }
        return
      }

      const isIconElement =
        (tag === 'a' || tag === 'i' || tag === 'span') && !el.textContent?.trim()
      const hasIconClass = Array.from(el.classList || []).some(
        cls => cls.includes('icon') || cls.includes('ionicon')
      )
      if (isIconElement && hasIconClass) {
        await processAttributes(el, maps, injectPlaceholders, config, compress, injectDataKey, masterStyleMap, currentLanguage)
        return
      }

      if (el.hasAttribute(FRENGLISH_DATA_KEY)) {
        const existingHash = el.getAttribute(FRENGLISH_DATA_KEY) || ''
        const inner = el.innerHTML || ''

        // Mid-pipeline placeholder form: inner content IS the hash.
        if (isHashPlaceholder(inner, existingHash)) {
          return
        }

        // Only invalidate on origin-language extraction. Target-lang passes keep
        // the key so mismatch-apply can still look up / render translations.
        if (shouldInvalidateStaleKeys(el, currentLanguage, config, compress)) {
          // Key is untrusted on origin content whether or not it matches the
          // body — see shouldInvalidateStaleKeys. Drop anchors and re-extract so
          // the string reaches the text map and can be requested.
          el.removeAttribute(FRENGLISH_DATA_KEY)
          el.removeAttribute('translated-lang')
          originallyTagged.delete(el)
          // fall through to normal extraction
        } else {
          return
        }
      }
      if (el.classList?.contains('ionicon')) {
        await processAttributes(el, maps, injectPlaceholders, config, compress, injectDataKey, masterStyleMap, currentLanguage)
        return
      }
      // Only skip children if the parent was originally tagged,
      // or if we're mutating and have tagged it during this pass.
      const parentEl = (node as HTMLElement).parentElement
      if (parentEl && (originallyTagged.has(parentEl) || (mutate && parentEl.hasAttribute(FRENGLISH_DATA_KEY)))) {
        return
      }

      // Collapse the whole block into a single placeholder/hash (for hashing & map building).
      if (shouldCollapse(el)) {
        const rep = await upsertPlaceholder(el.innerHTML, maps, injectPlaceholders, config, compress, masterStyleMap)
        if (rep) {
          if (injectDataKey) el.setAttribute(FRENGLISH_DATA_KEY, rep.hash)
          if (mutate) {
            el.innerHTML = rep.newText
            stampTranslated(el, currentLanguage);
            try {
              if (PLACEHOLDER_TAG_RE.test(rep.newText)) {
                const localPaired = scanPairedPlaceholders(rep.newText)
                neutralizeUnpairedPlaceholders(el, localPaired)
              }
            } catch { }
          }

          await processAttributes(el, maps, injectPlaceholders, config, compress, injectDataKey, masterStyleMap, currentLanguage)
        }
        return
      }

      await processAttributes(el, maps, injectPlaceholders, config, compress, injectDataKey, masterStyleMap, currentLanguage)

      for (const child of Array.from(el.childNodes)) {
        await walk(child)
      }
      return
    }

    if (node.nodeType === NodeConsts.TEXT_NODE) {
      const parent = (node as Text).parentElement
      const raw = node.textContent || ''
      if (!parent || !raw.trim()) return

      // Skip network request metadata (from DevTools Network panel)
      if (isNetworkRequestMetadata(raw)) {
        return
      }

      const pTag = parent.tagName.toLowerCase()

      // <title> special case
      if (pTag === 'title') {
        const rep = await upsertPlaceholder(raw, maps, injectPlaceholders, config, compress, masterStyleMap)
        if (rep) {
          if (injectDataKey) parent.setAttribute(FRENGLISH_DATA_KEY, rep.hash)
          if (mutate) {
            (node as Text).textContent = rep.newText
            stampTranslated(parent, currentLanguage);
          }
        }
        return
      }

      if (
        parent.hasAttribute(FRENGLISH_DATA_KEY) ||
        SKIPPED_TAGS.has(pTag) ||
        pTag === 'textarea' ||
        (pTag === 'input' &&
          !['button', 'submit', 'reset'].includes((parent.getAttribute('type') || '').toLowerCase()))
      ) {
        return
      }

      const rep = await upsertPlaceholder(raw, maps, injectPlaceholders, config, compress, masterStyleMap)
      if (rep) {
        if (mutate) {
          const span = doc.createElement('span')
          if (injectDataKey) span.setAttribute(FRENGLISH_DATA_KEY, rep.hash)
          stampTranslated(span, currentLanguage);
          stampTranslated(parent, currentLanguage);
          span.textContent = rep.newText
          parent.replaceChild(span, node)
        } else {
          // No visible mutation: just tag the parent so applyTranslations can target it later.
          if (injectDataKey) parent.setAttribute(FRENGLISH_DATA_KEY, rep.hash)
        }
      }
    }
  }

  // process head and body
  if (doc.head) for (const n of Array.from(doc.head.childNodes)) await walk(n)
  if (doc.body) for (const n of Array.from(doc.body.childNodes)) await walk(n)

  // Inject canonical link if it doesn't exist
  if (mutate && doc.head && currentLanguage) {
    injectCanonicalLinkIfMissing(doc, currentLanguage, config)
  }

  return {
    modifiedHtml: doc.documentElement.outerHTML, // unchanged visually if mutate=false
    textMap: maps.forward,
    styleMap: masterStyleMap,
  }
}

async function getCompressedInLineWithStyleMap(
  htmlChunk: string,
  config: Configuration,
  map: MasterStyleMap
): Promise<string> {
  const { compressed, styleMap, hrefMap } =
    await compressInlineStyling(htmlChunk, config)
  const hash = generatePlaceholder(compressed)
  map[hash] = { styleMap, hrefMap }
  return compressed
}

// Sets HTML element language
export function setDocumentLang(doc: Document, lang?: string) {
  if (!lang || !lang.trim()) return
  const htmlEl = doc.documentElement
  if (htmlEl.getAttribute('lang') !== lang) {
    htmlEl.setAttribute('lang', lang)
  }
}

/**
 * Modify HTMl overrides like directionality (rtl vs ltl), language html attribute, etc.
 */
export function injectHTMLOverwrite(doc: Document, language?: string) {
  // Adjust directionality
  if (language && languageReadingDirection(language) === 'rtl') {
    doc.documentElement.setAttribute('dir', 'rtl')
    const style = doc.createElement('style')
    style.textContent = 'body, body * { dir: rtl; text-align: right; }'
    doc.head.appendChild(style)
  }
  // Modify HTML attribute language
  setDocumentLang(doc, language)
}

/**
 * Determines if a BCP‑47 language code should be rendered RTL or LTR.
 */
export function languageReadingDirection(lang: string): 'rtl' | 'ltr' {
  const rtl = ['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ha', 'ps']
  return rtl.includes(lang.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr'
}

// -----------------------------------------------------------------------------
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  INLINE‑STYLING COMPRESSION / DECOMPRESSION                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// -----------------------------------------------------------------------------

/**
 * Decompresses a string that contains either <STYm>…</STYm>
 * **or** <HREFm>…</HREFm> placeholders or similar
 */
export function decompressHTML(
  compressedString: string,
  styleMap: Record<string, OriginalTagInfo>,
  hrefMap: Record<string, string> = {},
): string {
  let out = compressedString

  // If placeholders were HTML-escaped upstream, fix them cheaply.
  out = out.replace(/&lt;((?:sty|href|excl)\d+)([^&]*)&gt;/gi, "<$1$2>");

  // Updated RE to match generic placeholders like <sty0>, <href0>, <excl0>
  const RE = /<((?:sty|href|excl)\d+)([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi
  const SELF = ['input', 'img', 'br', 'hr', 'meta', 'link', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'source', 'track']

  out = out.replace(RE, (m, phTag: string, newAttrs: string = '', content?: string) => {
    const info = styleMap[phTag.toLowerCase()]
    if (!info || !info.tagName) return m

    // parse any attrs the translator left on the tag
    const parsed = Object.fromEntries(
      [...newAttrs.matchAll(/\s+([^\s=]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])
    ) as Record<string, string>

    // merge: translator wins over original (default attributes to {})
    const final: Record<string, string> = { ...(info.attributes ?? {}), ...parsed }

    // serialize
    let attrString = ''
    for (const [k, v] of Object.entries(final)) {
      attrString += ` ${k}="${escapeAttribute(v)}"`
    }

    const tag = info.tagName.toLowerCase()
    if (SELF.includes(tag)) return `<${tag}${attrString}>`
    return `<${tag}${attrString}>${content || ''}</${tag}>`
  })

  // run repeatedly so we handle nested placeholders in one call
  let prev: string
  let pass = 0
  do {
    if (++pass > 20) break
    prev = out
    out = out.replace(RE, (m, phTag: string, _attrs: string, content?: string) => {
      const info = styleMap[phTag.toLowerCase()]
      // don't require attributes; some entries (e.g., br) have none
      if (!info || !info.tagName) return m

      let attrs = ''
      for (const [k, v] of Object.entries((info.attributes ?? {}) as Record<string, string>)) {
        attrs += ` ${k}="${escapeAttribute(v)}"`
      }

      const tag = info.tagName.toLowerCase()
      if (SELF.includes(tag)) return `<${tag}${attrs}>`
      return `<${tag}${attrs}>${content || ''}</${tag}>`
    })
  } while (out !== prev)

  /* ── Restore href placeholders ────────────────────────────────────────── */
  out = restoreHrefs(out, hrefMap)

  /* ── Cosmetic: force lowercase tag-names written by jsdom ─────────────── */
  return out.replace(/<\/?([A-Z]+)/g, m => m.toLowerCase())
}

/**
 * Compresses every **FlatJSON.value** that contains inline HTML. All other
 * values are kept intact. The original array order is preserved.
 *
 * @param originalFlatJson array of FlatJSON items to scan
 * @param collectMaps      whether to build a master style‑map for later restore
 */
export async function compressHTMLTextMapValues(
  originalFlatJson: FlatJSON[],
  config: Configuration
): Promise<{ compressed: FlatJSON[]; styleMap: MasterStyleMap }> {
  const compressed: FlatJSON[] = []
  const masterStyleMap: MasterStyleMap = {}
  const htmlish = /<[a-z][\s\S]*>/i

  for (let i = 0; i < originalFlatJson.length; i++) {
    const item = originalFlatJson[i]
    if (typeof item.value === 'string' && htmlish.test(item.value)) {
      const { compressed: cmp, styleMap, hrefMap } = await compressInlineStyling(item.value, config)
      const compressedValueHash = generatePlaceholder(cmp)

      compressed.push({ ...item, value: cmp })
      masterStyleMap[compressedValueHash] = { styleMap, hrefMap }

    } else {
      compressed.push(item)
    }
  }

  return {
    compressed,
    styleMap: masterStyleMap
  };
}

// -----------------------------------------------------------------------------
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  DEFAULTS                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// -----------------------------------------------------------------------------

const DEFAULT_EXCLUDED_ELEMENTS = '.no-translate'

// -----------------------------------------------------------------------------
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  COMPRESSION / DECOMPRESSION HELPERS                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// -----------------------------------------------------------------------------
/**
 * Map a BCP-47-ish language code (e.g. "fr", "fr-ca") to an Open Graph
 * locale value like "fr_FR" or "fr_CA".
 *
 * We try, in order:
 *  - the language's own region (fr-ca → fr_CA)
 *  - any variant in configuration that shares the same base (fr-ca in config)
 *  - the existing og:locale's region (en_US → US)
 *  - a small set of sensible defaults (fr → fr_FR, en → en_US, …)
 */
function languageToOgLocale(
  lang: string | undefined,
  existingOgLocale?: string | null,
  config?: Configuration
): string | null {
  if (!lang) return null;
  const raw = String(lang).trim();
  if (!raw) return null;

  const norm = raw.toLowerCase().replace('_', '-');
  const parts = norm.split('-').filter(Boolean);
  if (!parts.length) return null;

  const base = parts[0];
  let region: string | undefined;

  // 1) Use region from the language itself, if present (fr-ca → ca, nl-nl → nl)
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length === 2) {
      // Allow same region as base (e.g., nl-nl → nl_NL)
      region = last;
    }
  }

  // 2) Look for a variant with region in the configuration (e.g. "fr-ca")
  if (!region && config) {
    const allLangs: string[] = [];
    if (config.originLanguage) allLangs.push(String(config.originLanguage));
    if (Array.isArray(config.languages)) {
      for (const l of config.languages) {
        if (l) allLangs.push(String(l));
      }
    }

    for (const lRaw of allLangs) {
      const lNorm = lRaw.toLowerCase().replace('_', '-');
      const lParts = lNorm.split('-').filter(Boolean);
      if (!lParts.length) continue;

      // same base (fr, en, etc.)
      if (lParts[0] === base && lParts.length > 1) {
        const candidate = lParts[lParts.length - 1];
        if (candidate.length === 2) {
          // Allow same region as base (e.g., nl-nl → nl_NL)
          region = candidate;
          break;
        }
      }
    }
  }

  // 3) Fallback: reuse region from existing og:locale,
  //    but ONLY if the base matches (fr + fr_FR → FR, NOT fr + en_US)
  if (!region && existingOgLocale) {
    const ex = String(existingOgLocale).trim();
    if (ex) {
      const exNorm = ex.toLowerCase().replace('-', '_');
      const exParts = exNorm.split('_');
      if (exParts.length >= 2 && exParts[1].length === 2) {
        const exBase = exParts[0];      // "en" in "en_us"
        const exRegion = exParts[1];    // "us"
        if (exBase === base) {
          region = exRegion;
        }
      }
    }
  }

  // 4) Last-resort sensible defaults
  if (!region) {
    switch (base) {
      case 'en':
        region = 'ca';
        break;
      case 'fr':
        region = 'ca';
        break;
      case 'es':
        region = 'es';
        break;
      case 'pt':
        region = 'br';
        break;
      case 'nl':
        region = 'nl';
        break;
      case 'zh':
        region = 'cn';
        break;
      case 'tw':
        region = 'tw';
        break;
      default:
        // If we don't know, don't force an invalid OG locale
        return null;
    }
  }

  return `${base}_${region.toUpperCase()}`;
}

/**
 * Convenience wrapper around compressHTML() for a single HTML fragment.
 */
async function compressInlineStyling(htmlChunk: string, config: Configuration) {
  const doc = await getSharedDoc()
  const { compressedString, styleMap, hrefMap } = compressHTML(htmlChunk, doc, config)
  return { compressed: compressedString, styleMap, hrefMap }
}

// cache a single document after the first call
let sharedDocPromise: Promise<Document> | null = null
async function getSharedDoc(): Promise<Document> {
  if (!sharedDocPromise) {
    sharedDocPromise = createDocument('<body></body>')
  }
  return sharedDocPromise
}

/**
 * Walks a small HTML fragment, replacing inline‑formatting tags (<span>,
 * <strong>, …) with neutral <styling_N> placeholders. A style map records the
 * original tag + attributes so the fragment can later be reconstructed.
 */
function compressHTML(
  htmlChunk: string,
  doc: Document,
  config: Configuration // Removed prefix parameter
): CompressionResult {
  const styleMap: { [ph: string]: OriginalTagInfo } = {}
  const hrefMap: { [ph: string]: string } = {}
  let counter = 0
  let hrefCounter = 0
  const container = doc.createElement('div')
  container.innerHTML = htmlChunk

  function walk(n: Node): string {
    switch (n.nodeType) {
      case Node.TEXT_NODE:
        return unescapeHtml(n.textContent || '')
      case Node.ELEMENT_NODE: {
        const el = n as Element
        const tagName = el.tagName.toLowerCase()

        if (tagName === 'br' || tagName === 'hr' || tagName === 'wbr' || tagName === 'area' || tagName === 'base' || tagName === 'col'
          || tagName === 'embed' || tagName === 'param' || tagName === 'source' || tagName === 'track') {
          const ph = `sty${counter++}`
          styleMap[ph] = {
            tagName,
            attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])),
          }
          return `<${ph}>`
        }

        // Compressing hrefs
        if (el.tagName.toLowerCase() === 'a') {
          // Generate generic placeholder without prefix
          const ph = `href${hrefCounter++}`

          // 1️⃣ Collect attributes for later restore
          const restoreAttrs: Record<string, string> = { href: ph }

          // 2️⃣ Build the *visible* attribute string – only translatable ones!
          let attrString = ''
          Array.from(el.attributes).forEach(({ name, value }) => {
            if (name === 'href') {
              hrefMap[ph] = value                         // <-- keep original URL
            } else {
              restoreAttrs[name] = value                  // <-- keep everything
              if (TRANSLATABLE_ATTRIBUTES.has(name)) {
                attrString += ` ${name}="${escapeAttribute(value)}"`
              }
            }
          })

          styleMap[ph] = { tagName: 'a', attributes: restoreAttrs }

          // 3️⃣ Recurse into children
          let inner = ''
          el.childNodes.forEach(c => inner += walk(c))
          return `<${ph}${attrString}>${inner}</${ph}>`
        }

        // Compressing form elements
        const formElements = ['input', 'label', 'textarea', 'button', 'form']
        if (formElements.includes(el.tagName.toLowerCase())) {
          // Generate generic placeholder without prefix
          const ph = `sty${counter++}`
          const attrs: Record<string, string> = {}

          // Build the visible attribute string for translatable attributes
          let attrString = ''
          Array.from(el.attributes).forEach(a => {
            // Keep all attributes in the styleMap for restoration
            attrs[a.name] = a.value

            // Only show translatable attributes in the compressed output
            if (TRANSLATABLE_ATTRIBUTES.has(a.name)) {
              attrString += ` ${a.name}="${escapeAttribute(a.value)}"`
            }
          })

          styleMap[ph] = { tagName: el.tagName, attributes: attrs }

          // For self-closing elements like input, don't process children
          if (['input'].includes(el.tagName.toLowerCase())) {
            return `<${ph}${attrString}>`
          }

          // For other form elements, keep text content uncompressed
          let inner = ''
          el.childNodes.forEach(c => {
            if (c.nodeType === Node.TEXT_NODE) {
              // Keep text content as-is for translation
              inner += c.textContent || ''
            } else {
              // Process other nodes normally
              inner += walk(c)
            }
          })
          return `<${ph}${attrString}>${inner}</${ph}>`
        }

        // Compressing no-translate and such ()
        const excludedBlocks = config.excludedTranslationBlocks
        const excluded = el.matches?.(DEFAULT_EXCLUDED_ELEMENTS) ||
          (excludedBlocks?.some(block =>
            Array.isArray(block.blocks) &&
            block.blocks.some(item => el.matches?.(item.selector))
          ))

        if (excluded) {
          // Generate generic placeholder without prefix
          const ph = `excl${counter++}`
          styleMap[ph] = { tagName: el.tagName, attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])) }

          let inner = ''
          el.childNodes.forEach(c => inner += walk(c))
          return `<${ph}>${inner}</${ph}>`
        }

        if (el.tagName.toLowerCase() === 'img') {
          // Generate generic placeholder without prefix
          const ph = `sty${counter++}` // Using STY prefix, or could be IMG
          const restoreAttrs: Record<string, string> = {}
          let displayAttrsString = '' // Attributes visible to the translator

          Array.from(el.attributes).forEach(attr => {
            restoreAttrs[attr.name] = attr.value // Store ALL original attributes for restoration

            // Only include TRANSLATABLE attributes (like alt, title) in the display string
            if (TRANSLATABLE_ATTRIBUTES.has(attr.name.toLowerCase())) {
              displayAttrsString += ` ${attr.name}="${escapeAttribute(attr.value)}"`
            }
          })

          styleMap[ph] = { tagName: 'img', attributes: restoreAttrs }

          // Return a self-closing placeholder with only translatable attributes
          return `<${ph}${displayAttrsString}>`
        }

        if (isCompressibleInlineElement(el)) {
          // Generate generic placeholder without prefix
          const ph = `sty${counter++}`
          const attrs: Record<string, string> = {}
          Array.from(el.attributes).forEach(a => {
            if (a.name === 'href') {
              // Generate generic placeholder for href
              const hrefPh = `href${hrefCounter++}`
              hrefMap[hrefPh] = a.value
              attrs[a.name] = hrefPh
            } else {
              attrs[a.name] = a.value
            }
          })

          styleMap[ph] = { tagName: el.tagName, attributes: attrs }
          let inner = ''
          el.childNodes.forEach(c => (inner += walk(c)))
          return `<${ph}>${inner}</${ph}>`
        }
        let inner = ''
        el.childNodes.forEach(c => (inner += walk(c)))
        const tag = el.tagName.toLowerCase()
        let attrs = ''
        Array.from(el.attributes).forEach(a => {
          if (a.name === 'href') {
            const hrefPh = `__HREF_${hrefCounter++}__` // This is a different placeholder type, keep as is for now
            hrefMap[hrefPh] = a.value
            attrs += ` href="${hrefPh}"`
          } else {
            attrs += ` ${a.name}="${escapeAttribute(a.value)}"`
          }
        })
        const selfClose = ['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'source', 'track']
        return selfClose.includes(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${inner}</${tag}>`
      }
      default:
        return ''
    }
  }

  let compressed = ''
  container.childNodes.forEach(c => (compressed += walk(c)))
  return { compressedString: compressed, styleMap, hrefMap }
}

/**
 * Returns true if the element is a simple inline formatter that can be safely
 * replaced by a placeholder (<strong>, <span>, …).
 */
function isCompressibleInlineElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return new Set([
    'span', 'strong', 'em', 'i', 'b', 'u', 'sub', 'sup', 'mark', 'small', 'font', 'code',
    'abbr', 'cite', 'bdi', 'bdo', 'del', 'ins', 'kbd', 'q', 'samp', 'var'
  ]).has(tag)
}

/**
 * Restores **all** href placeholders, regardless of any user-supplied
 * prefix that was prepended in compressInlineStyling().
 *
 * (Using plain RegExp back-references proved too fragile once prefixes
 * grew more complex, so we now simply stream-replace from the known map.)
 */
function restoreHrefs(html: string, hrefMap: Record<string, string>) {
  for (const [ph, url] of Object.entries(hrefMap)) {
    // the placeholder may occur several times → global replace
    html = html.split(ph).join(escapeAttribute(url))
  }
  return html
}

/** Escapes attribute values when reconstructing decompressed HTML. */
function escapeAttribute(v: string): string {
  if (!v) return '';
  return v
    .replace(/&(?![a-zA-Z0-9#]+;)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;') // &#39; is more universally compatible than &apos;
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Decodes common HTML entities to create a plain text representation.
 * This is crucial for normalization before hashing.
 * The order of replacement is important: &amp; must be first.
 */
function unescapeHtml(v: string): string {
  if (!v) return '';
  return v
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ----------------------------------------------------------------------------
// Language-based visibility pruning
// ----------------------------------------------------------------------------

/**
 * Normalizes a path:
 * - keeps only pathname
 * - ensures a single leading slash
 * - removes trailing slash (except root '/')
 * - lowercases for matching
 */
function normalizePath(p: string): string {
  try {
    if (/^https?:\/\//i.test(p)) {
      const u = new URL(p)
      p = u.pathname || '/'
    }
  } catch {
    /* ignore */
  }
  p = String(p || '').split('?')[0].split('#')[0].trim()
  if (!p.startsWith('/')) p = '/' + p
  p = p.replace(/\/{2,}/g, '/')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p.toLowerCase()
}

/**
 * If path starts with a locale segment present in config (originLanguage or languages),
 * strip it for a looser match. E.g., /fr/products/a -> /products/a
 */
function stripLocalePrefix(p: string, config: Configuration): string {
  const segs = p.split('/').filter(Boolean)
  if (!segs.length) return p
  const first = segs[0].toLowerCase()
  const localeSet = new Set(([...(config.languages || []), config.originLanguage].filter(Boolean) as string[]).map(l => l.toLowerCase()))
  if (localeSet.has(first)) {
    const rest = '/' + segs.slice(1).join('/')
    return normalizePath(rest || '/')
  }
  return p
}

/**
 * Find the best ancestor to remove (menu item, list item, nav container, etc.)
 * Falls back to the anchor element itself if nothing matches within 6 levels.
 */
function findRemovalContainer(a: Element, extraSelectors: string[] = []): Element {
  const DEFAULT_SELECTORS = [
    'li.menu-item',
    '.menu-item',
    '.awb-menu__li',
    '.awb-menu__sub-li',
    '.nav-item',
    '[role="menuitem"]',
    'li',
  ]
  const selectors = [...DEFAULT_SELECTORS, ...extraSelectors]
  let cur: Element | null = a
  let depth = 0
  while (cur && depth < 6) {
    if (selectors.some(sel => cur!.matches?.(sel))) return cur!
    cur = cur.parentElement
    depth++
  }
  return a
}

/**
 * Build a quick index of normalized paths -> enabledLocales
 * (also keeps a version with locale prefix stripped for looser matches)
 */
function buildPathIndex(config: Configuration) {
  const exact = new Map<string, string[]>()
  const noloc = new Map<string, string[]>()
  const entries = config.languageAvailability?.entries || []

  for (const e of entries) {
    if (!e?.path) continue
    const p = normalizePath(e.path)
    const enabled = e.enabledLocales || []
    exact.set(p, enabled)
    noloc.set(stripLocalePrefix(p, config), enabled)
  }
  return { exact, noloc }
}

/**
 * Find the enabledLocales for a given href, trying:
 * 1) exact normalized path
 * 2) same path with locale prefix stripped
 * 3) substring fallback (entry.path contained in href path)
 */
function lookupEnabledLocalesForHref(
  hrefPath: string,
  config: Configuration,
  exact: Map<string, string[]>,
  noloc: Map<string, string[]>
): string[] | null {
  if (exact.has(hrefPath)) return exact.get(hrefPath)!
  const stripped = stripLocalePrefix(hrefPath, config)
  if (noloc.has(stripped)) return noloc.get(stripped)!

  // substring fallback
  let best: string[] | null = null
  let bestLen = 0
  for (const [p, locs] of exact.entries()) {
    if (hrefPath.includes(p) && p.length > bestLen) { best = locs; bestLen = p.length }
  }
  if (best) return best

  best = null
  bestLen = 0
  for (const [p, locs] of noloc.entries()) {
    if (hrefPath.includes(p) && p.length > bestLen) { best = locs; bestLen = p.length }
  }
  return best
}

function detectLanguageFromHtml(doc: Document, fallback?: string): string {
  let lang = (doc.documentElement.getAttribute('lang') || '').trim()
  if (!lang) lang = (doc.documentElement.getAttribute('xml:lang') || '').trim()
  if (!lang && doc.body) lang = (doc.body.getAttribute('lang') || '').trim()
  if (!lang) {
    const metaHttp = doc.querySelector('meta[http-equiv="content-language"]') as HTMLMetaElement | null
    const metaName = doc.querySelector('meta[name="language"]') as HTMLMetaElement | null
    lang = (metaHttp?.content || metaName?.content || '').trim()
  }
  if (!lang && fallback) lang = fallback
  return (lang || '').toLowerCase()
}

// --- locale helpers (add above or near the function) ---
const normalizeLocale = (s: string) =>
  (s || "").toLowerCase().replace("_", "-").trim();

const normalizeLocaleList = (ls: readonly string[] | undefined) =>
  Array.from(new Set((ls || []).map(normalizeLocale)));

const shouldAllowBaseLangPrefixWithReason = (
  currentLang: string,
  allLocales: readonly string[] | undefined,
  enabledLocalesForPath: readonly string[]
) => {
  const lang = normalizeLocale(currentLang);
  const base = lang.split("-")[0];

  const all = normalizeLocaleList(allLocales);
  const enabled = normalizeLocaleList(enabledLocalesForPath);

  const allHasBase = all.includes(base);
  const allHasVariant = all.some((l) => l.startsWith(base + "-"));
  const enabledHasBase = enabled.includes(base);
  const enabledHasVariant = enabled.some((l) => l.startsWith(base + "-"));

  // Global strictness: if site knows both base and a variant for this language, be strict.
  if ((allHasBase && allHasVariant) || (enabledHasBase && enabledHasVariant)) {
    return { allowBase: false, reason: "strict:base+variant-present" };
  }

  // NEW: Variant is known globally, but not enabled for this path -> be strict.
  // Example: lang=en-us, allLocales contains en-us, enabled=['sv','en'] -> no fallback
  if (lang.includes("-") && all.includes(lang) && !enabled.includes(lang)) {
    return { allowBase: false, reason: "strict:variant-known-but-not-enabled" };
  }

  return { allowBase: true, reason: "fallback-ok" };
};

const localeMatchesConditional = (
  currentLang: string,
  enabledLocales: readonly string[],
  allowBaseFallback: boolean
) => {
  const lang = normalizeLocale(currentLang);
  const enabled = normalizeLocaleList(enabledLocales);

  if (enabled.includes(lang)) return true;
  if (!allowBaseFallback) return false;

  // base fallback: en-us -> en (only if permitted)
  const base = lang.split("-")[0];
  return enabled.includes(base);
};

// ---------------------------------------------------------------------------
// Prune availableUI 
// ---------------------------------------------------------------------------
export async function pruneUnavailableUI(
  html: string,
  configuration: Configuration,
  opts: { ancestorSelectors?: string[]; baseUrl?: string; lang?: string } = {}
): Promise<string> {
  const entries = configuration?.languageAvailability?.entries || [];
  if (!html || !entries.length) return html;

  const PRUNED_ATTR = "data-frenglish-pruned";
  const PRUNED_PATH_ATTR = "data-frenglish-pruned-path";

  const doc = await createDocument(html);
  const baseUrl = opts.baseUrl || doc.baseURI || "https://example.local";
  const { exact, noloc } = buildPathIndex(configuration);

  // language: explicit > detected > configured default
  const configuredOrigin = configuration.originLanguage || (configuration.languages?.[0] ?? "");
  const lang =
    (opts.lang && String(opts.lang).toLowerCase()) ||
    detectLanguageFromHtml(doc, configuredOrigin);
  const allLocales = configuration?.languages ?? [];

  // idempotent hider
  const hide = (el: Element, path: string) => {
    const style = el.getAttribute("style") || "";
    if (!/display\s*:\s*none\s*!important/i.test(style)) {
      el.setAttribute(
        "style",
        (style ? style.replace(/\s*;?\s*$/, "; ") : "") + "display:none !important;"
      );
    }
    el.setAttribute(PRUNED_ATTR, "language-mismatch");
    if (!el.hasAttribute(PRUNED_PATH_ATTR)) el.setAttribute(PRUNED_PATH_ATTR, path);

    // make any link inside unfocusable to screen readers/keyboard
    const link =
      el.tagName.toLowerCase() === "a"
        ? (el as HTMLElement)
        : (el.querySelector("a[href]") as HTMLElement | null);
    if (link && !link.hasAttribute("tabindex")) link.setAttribute("tabindex", "-1");
  };

  // Iterate anchors once; hide either the anchor or its matched ancestor
  const anchors = Array.from(doc.querySelectorAll("a[href]")) as HTMLAnchorElement[];
  const seen = new Set<Element>(); // avoid re-hiding the same container repeatedly

  for (const a of anchors) {
    const rawHref = a.getAttribute("href") || "";
    if (!rawHref || /^(mailto:|tel:|javascript:)/i.test(rawHref)) continue;

    // Resolve and normalize pathname
    let pathname = "";
    try {
      const u = new URL(rawHref, baseUrl);
      pathname = normalizePath(u.pathname);
    } catch {
      pathname = normalizePath(rawHref);
    }

    // Get availability for this path; if none, skip
    const enabled = lookupEnabledLocalesForHref(pathname, configuration, exact, noloc);
    if (!enabled) continue;

    // Check if current lang is allowed for this path
    const { allowBase } = shouldAllowBaseLangPrefixWithReason(lang, allLocales, enabled);
    const allowed = localeMatchesConditional(lang, enabled, allowBase);
    if (allowed) continue;

    // Hide the chosen ancestor (or the anchor itself)
    const container = findRemovalContainer(a, opts.ancestorSelectors || []);
    const target = container ?? a;
    if (!seen.has(target)) {
      hide(target, pathname);
      seen.add(target);
    }
  }

  return doc.documentElement.outerHTML;
}