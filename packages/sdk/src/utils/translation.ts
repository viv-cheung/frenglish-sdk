import {
  RequestTranslationResponse,
  TranslationResponse,
  TranslationStatus,
  PartialConfiguration,
  parsePartialConfig,
  FileContentWithLanguage,
  CompletedTranslationResponse,
  FlatJSON,
  TextAndStyleMapResponse,
  LangResolveDecision
} from '@frenglish/utils'
import { apiRequest } from './api.js'

/**
 * Call /api/translation/lang/resolve with the path you already computed.
 * Assumes `targetPath` is a path like "/de/about-us" (NOT a full URL).
 */
export async function getRedirectPath(opts: {
  apiKey: string
  targetLang: string         // e.g. "de"
  targetPath: string         // e.g. "/de/about-us"
  baseUrl?: string           // optional site base when redirecting (e.g. "https://example.com")
}): Promise<LangResolveDecision & { finalUrl: string | null }> {
  const { apiKey, targetLang, targetPath, baseUrl } = opts
  const createLangPath = (lang: string, path: string): string => {
    const cleanLang = lang.replace(/\//g, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    if (cleanPath === '/') {
      return `/${cleanLang}`;
    }
    return `/${cleanLang}${cleanPath}`;
  };

  const effectiveBaseUrl =
    baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');

  const decision = await apiRequest<LangResolveDecision>('/api/translation/lang/resolve', {
    body: {
      apiKey,
      path: targetPath,
      lang: targetLang,
    },
    errorContext: 'Failed to resolve language redirect',
  })

  const prefixBase = (p: string) => (effectiveBaseUrl ? effectiveBaseUrl.replace(/\/$/, '') : '') + p;
  let finalUrl: string | null = null;

  if (decision.allowed) {
    const finalPath = createLangPath(targetLang, decision.canonicalPath);
    finalUrl = prefixBase(finalPath);

  } else if (decision.redirectTo) {
    const finalPath = createLangPath(targetLang, decision.redirectTo);
    finalUrl = prefixBase(finalPath);
  }

  return { ...decision, finalUrl };
}

/**
 * Internal helper function to poll for translation completion.
 *
 * @param {number} translationId - ID of the translation to poll for
 * @param {string} apiKey - API key for authentication
 * @param {number} [pollingInterval=500] - Interval between polls in milliseconds
 * @param {number} [maxPollingTime=1800000] - Maximum time to poll in milliseconds
 * @returns {Promise<TranslationResponse[]>} Array of translation responses
 * @throws {Error} If polling times out or the server stays unreachable
 */
export const pollForTranslation = async (
  translationId: number,
  apiKey: string,
  pollingInterval: number = 2000,  // Default 2 seconds
  maxPollingTime: number = 3600000 // Default 60 minutes (3600 * 1000 ms)
): Promise<TranslationResponse[]> => {
  const startTime = Date.now() - pollingInterval
  const MAX_BACKOFF_ATTEMPTS = 8
  const getBackoffDelay = (attempt: number) => Math.min((attempt + 1) * 2000, 16000)
  let consecutiveErrors = 0

  console.log(`Waiting for translation to be completed ...`)

  while (Date.now() - startTime < maxPollingTime) {
    let translationStatus: TranslationStatus | undefined
    try {
      translationStatus = await apiRequest<{ status: TranslationStatus }>('/api/translation/get-status', {
        body: {
          translationId,
          apiKey,
        },
        errorContext: 'Failed to get translation status',
      }).then(data => data.status)
      consecutiveErrors = 0
    } catch (err) {
      if (consecutiveErrors >= MAX_BACKOFF_ATTEMPTS) {
        throw new Error(`Server unresponsive after ${MAX_BACKOFF_ATTEMPTS} back‑off attempts (last delay 16s). Latest error message: ${err}`)
      }
      const delay = getBackoffDelay(consecutiveErrors)
      consecutiveErrors++
      await new Promise(resolve => setTimeout(resolve, delay))
      continue
    }

    if (translationStatus === TranslationStatus.COMPLETED) {
      return apiRequest<TranslationResponse[]>('/api/translation/get-translation', {
        body: { translationId, apiKey,
        },
        errorContext: 'Failed to get translation content',
      })
    } else if (translationStatus === TranslationStatus.OVER_HARD_LIMIT) {
      console.warn(
        '[FrenglishSDK] Project is over the hard limit. Returning best-effort files built from the latest text map.'
      );
      return apiRequest<TranslationResponse[]>('/api/translation/get-translation', {
        body: { translationId, apiKey },
        errorContext: 'Failed to get translation content - Over hard limit',
      });
    } else if (translationStatus === TranslationStatus.SKIPPED) {
      return []
    } else if (translationStatus === TranslationStatus.CANCELLED) {
      throw new Error('Translation cancelled')
    } else if (translationStatus === TranslationStatus.QUEUED || translationStatus === TranslationStatus.PROCESSING) {
      await new Promise(resolve => setTimeout(resolve, pollingInterval))
    } else {
      throw new Error(`Translation (ID: ${translationId}) has unexpected status: ${translationStatus}`)
    }
  }
  throw new Error(`Polling for translation result (ID: ${translationId}) timed out after ${maxPollingTime / 1000} seconds.`)
}

/**
 * Submits content for translation and polls until the translation is ready.
 *
 * @param {string[]} content - The content to translate.
 * @param {string} apiKey - API key for authentication
 * @param {boolean} [isFullTranslation=false] - Whether to perform a full translation.
 * @param {string[]} [filenames=[]] - Filenames associated with the content.
 * @param {PartialConfiguration} [partialConfig={}] - Partial configuration to override default settings.
 * @param {string[]} [paths=[]] - Optional: Paths to specify the urls they're coming from
 * @param {Object} [opts={}] - Additional options for the translation request.
 * @param {boolean} [opts.wait=true] - When true (default), wait and poll until the translation completes
 *   and return the translated content. When false, fire-and-forget: queue the translation and return
 *   immediately with an empty `content` array.
 * @returns {Promise<CompletedTranslationResponse>} A promise that resolves to RequestTranslationResponse with translationId and content
 * @throws {Error} If the request fails, translation is cancelled, or polling times out
 */
export async function translate(
  content: string[],
  apiKey: string,
  isFullTranslation = false,
  filenames: string[] = [],
  partialConfig: PartialConfiguration = {},
  paths: string[] = [],
  opts: { wait?: boolean } = {}
): Promise<CompletedTranslationResponse> {
  const { wait = true } = opts; 
  const parsedConfig = await parsePartialConfig(partialConfig)

  const data = await apiRequest<RequestTranslationResponse>('/api/translation/request-translation', {
    body: { content, isFullTranslation, filenames, partialConfig: parsedConfig, apiKey, paths },
    errorContext: 'Failed to request translation',
  })

  // Fire a follow-up request for “other languages”
  if (parsedConfig && parsedConfig.languages && parsedConfig?.languages?.length > 0) {
    const { languages: _ignored, ...languageLessConfig } = parsedConfig ?? {};
    apiRequest<RequestTranslationResponse>('/api/translation/request-translation', {
      body: {
        content,
        isFullTranslation,
        filenames,
        partialConfig: languageLessConfig,
        apiKey,
        paths,
      },
      errorContext: 'Failed to request translation',
    })
  }

  // fire-and-forget usage
  if (!wait) {
    return { translationId: data.translationId, content: [] }
  }

  const translationContent = await pollForTranslation(data.translationId, apiKey)
  return { translationId: data.translationId, content: translationContent }
}

/**
 * Translates a single string and returns the translated result.
 *
 * @param {string | string[]} content - The string or array of strings to translate.
 * @param {string} lang - The target language code.
 * @param {string} apiKey - API key for authentication
 * @param {PartialConfiguration} [partialConfig={}] - Optional overrides to the default configuration.
 * @returns {Promise<string | string[] | undefined>} A promise that resolves to:
 *   - The translated string(s) if successful
 *   - undefined if the translation result is not in expected format
 * @throws {Error} If the translation is cancelled, the language is unsupported, polling times out, or the request fails.
 */
export async function translateString(
  content: string | string[],
  lang: string,
  isFullTranslation = false,
  apiKey: string,
  partialConfig: PartialConfiguration = {}
): Promise<string | string[] | undefined> {
  const parsedConfig = await parsePartialConfig(partialConfig)

  const supportedLanguages = await apiRequest<string[]>('/api/translation/supported-languages', {
    errorContext: 'Failed to get supported languages',
  })

  if (!supportedLanguages.includes(lang)) {
    throw new Error(`Language '${lang}' is not supported. Supported languages are: ${supportedLanguages.join(', ')}`)
  }

  const data = await apiRequest<RequestTranslationResponse>('/api/translation/request-translation-string', {
    body: {
      content,
      lang,
      partialConfig: parsedConfig,
      apiKey,
      isFullTranslation
    },
    errorContext: 'Failed to request translation string',
  })

  const translationContent = await pollForTranslation(data.translationId, apiKey)

  // Process all translations and files
  const allTranslations = translationContent.flatMap(translation =>
    translation.files.map(file => {
      if (!file.content) return []
      try {
        const parsedContent = JSON.parse(file.content as string)
        return Object.values(parsedContent)
      } catch (e) {
        console.error('Error parsing translation content:', e)
        return []
      }
    })
  ).flat()

  if (allTranslations.length === 0) return undefined
  // If there's only one translation, return it as a string to maintain backward compatibility
  if (allTranslations.length === 1) return allTranslations[0] as string
  // If there are multiple translations, return them as an array
  return allTranslations as string[]
}

/**
 * Retrieves the current status of a submitted translation request.
 *
 * @param {number} translationId - The unique ID of the translation request.
 * @returns {Promise<TranslationStatus>} A promise that resolves to the current translation status (e.g. 'COMPLETED', 'CANCELLED', 'IN_PROGRESS')
 * @throws If the request fails.
 */
export async function getTranslationStatus(translationId: number, apiKey: string): Promise<TranslationStatus> {
  const data = await apiRequest<{ status: TranslationStatus }>('/api/translation/get-status', {
    body: {
      translationId,
      apiKey,
    },
    errorContext: 'Failed to get translation status',
  })
  return data.status
}

/**
 * Fetches the translated content once the translation is complete.
 *
 * @param {number} translationId - The unique ID of the translation request.
 * @returns {Promise<TranslationResponse[]>} A promise that resolves to an array of translation responses, each containing:
 *   - language: The target language code
 *   - files: Array of translated file contents
 * @throws If the request fails.
 */
export async function getTranslationContent(translationId: number, apiKey: string): Promise<TranslationResponse[]> {
  return apiRequest<TranslationResponse[]>('/api/translation/get-translation', {
    body: {
      translationId,
      apiKey,
    },
    errorContext: 'Failed to get translation content',
  })
}

/**
 * Fetches the project's current text map and the corresponding style map.
 * The text map contains all translations, while the style map is crucial for
 * correctly decompressing and rendering any HTML content within the translations.
 *
 * @param {string} apiKey - Your public or private API key.
 * @returns {Promise<TextAndStyleMapResponse | null>} A promise that resolves to:
 * - An object containing both the textMap and styleMap if they exist.
 * - null if either map does not exist for the project.
 * @throws If the API request fails.
 */
export async function getTextAndStyleMap(
  apiKey: string,
  requestedLang?: string,
  hashesOrOpts?: string[] | { hashes?: string[]; baseUrl?: string }
): Promise<{ content: TextAndStyleMapResponse } | null> {
  const opts = Array.isArray(hashesOrOpts)
    ? { hashes: hashesOrOpts }
    : (hashesOrOpts || {});

  return apiRequest<{ content: TextAndStyleMapResponse } | null>(
    '/api/project/request-text-and-style-map',
    {
      body: {
        apiKey,
        requestedLang,
        ...(opts.hashes?.length ? { hashes: opts.hashes } : {}),
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      },
      errorContext: 'Failed to fetch project text and style maps',
    }
  );
}

/**
 * Fetches the project's current text map for translation tracking. This will contain all the translations for your project.
 * The text map keeps the translations consistent, so if you use the same sentences, it will not translate them again and will return the same result.
 *
 * @returns {Promise<{ content: FlatJSON[] } | null>} A promise that resolves to:
 *   - An object containing the text map content if it exists
 *   - null if no text map exists
 * @throws If the request fails.
 */
export async function getTextMap(apiKey: string, requestedLang?: string): Promise<{ content: FlatJSON[] } | null> {
  return apiRequest<{ content: FlatJSON[] } | null>('/api/project/request-text-map', {
    body: {
      apiKey,
      requestedLang
    },
    errorContext: 'Failed to fetch project text map',
  })
}

/**
 * Fetches the translated file for a specific language.
 *
 * @returns {Promise<{ content: FlatJSON[] } | null>} A promise that resolves to:
 *   - A string containing the translated file content if it exists
 *   - A Buffer containing the translated file content if it is binary
 * @throws If the request fails.
 */
export async function getTranslatedFile(apiKey: string, requestedLang: string, content: string | Buffer, fileId: string): Promise< string | Buffer> {
  return apiRequest< {content: string | Buffer} >('/api/project/request-translated-file', {
    body: {
      apiKey,
      requestedLang,
      content,
      fileId
    },
    errorContext: 'Failed to request translated file',
  }).then(res => res.content)
}

/**
 * Retrieves the list of languages supported by the Frenglish translation service.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of supported language codes (e.g. ['en', 'fr', 'es'])
 * @throws If the request fails or the API responds with an error.
 */
export async function getSupportedLanguages(): Promise<string[]> {
  return apiRequest<string[]>('/api/translation/supported-languages', {
    errorContext: 'Failed to get supported languages',
  })
}

/**
 * Retrieves the list of file types supported for translation uploads.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of supported file extensions (e.g. ['.txt', '.json', '.md'])
 * @throws If the request fails or the API responds with an error.
 */
export async function getSupportedFileTypes(): Promise<string[]> {
  return apiRequest<string[]>('/api/translation/supported-file-types', {
    errorContext: 'Failed to get supported file types',
  })
}

/**
 * Uploads one or more files for translation, typically used as base files to compare against.
 *
 * @param {FileContentWithLanguage[]} files - An array of files with language metadata and content.
 * @returns {Promise<{ message: string, originFilesInfo: Array<{ fileId: string, originS3Version: string }> }>} A promise that resolves to:
 *   - message: Success message
 *   - originFilesInfo: Array of uploaded file information
 * @throws If the upload fails or the API responds with an error.
 */
export async function upload(files: FileContentWithLanguage[], apiKey: string): Promise<{ message: string, originFilesInfo: Array<{ fileId: string, originS3Version: string }> }> {
  return apiRequest('/api/translation/upload-files', {
    body: {
      files,
      apiKey,
    },
    errorContext: 'Failed to upload files',
  })
}

/**
 * Retrieves the list of outdated files for a given project.
 *
 * @param {string} apiKey - The API key for authentication.
 * @returns {Promise<TranslationResponse[]>} A promise that resolves to an array of translation responses.
 * @throws If the request fails or the API responds with an error.
 */
export async function getOutdatedFiles(apiKey: string): Promise<TranslationResponse[]> {
  return apiRequest('/api/translation/fetch-outdated-files', {
    body: {
      apiKey,
    },
    errorContext: 'Failed to get outdated files',
  })
}
