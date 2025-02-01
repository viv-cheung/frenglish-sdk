import { describe, it, expect, vi, beforeEach } from 'vitest'
import FrenglishSDK from '../../src/sdk'
import { TranslationStatus } from '../../src/types/translation'
import { FRENGLISH_BACKEND_URL } from '../../src/config/config'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('FrenglishSDK', () => {
  const apiKey = 'test-api-key'
  let sdk: FrenglishSDK

  beforeEach(() => {
    vi.clearAllMocks()
    sdk = new FrenglishSDK(apiKey)
  })

  describe('registerWebhook', () => {
    it('should successfully register a webhook', async () => {
      const webhookUrl = 'https://example.com/webhook'
      mockFetch.mockResolvedValueOnce({ ok: true })

      await sdk.registerWebhook(webhookUrl)

      expect(mockFetch).toHaveBeenCalledWith(
        `${FRENGLISH_BACKEND_URL}/api/webhook/register-webhook`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ webhookUrl, apiKey }),
        }
      )
    })

    it('should throw error when registration fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid webhook URL')
      })

      await expect(sdk.registerWebhook('invalid-url'))
        .rejects.toThrow('Failed to register webhook')
    })
  })

  describe('translate', () => {
    it('should successfully translate content', async () => {
      const content = ['test content']
      const filenames = ['test.json']
      const translationId = 123
      const translatedContent = [{
        language: 'fr',
        files: [{ fileId: 'test.json', content: 'contenu test' }]
      }]

      // Mock initial translation request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ translationId })
      })

      // Mock status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: TranslationStatus.COMPLETED })
      })

      // Mock content retrieval
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(translatedContent)
      })

      const result = await sdk.translate(content, false, filenames)

      expect(result).toEqual({
        translationId,
        content: translatedContent
      })
    })

    it('should handle translation cancellation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ translationId: 123 })
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: TranslationStatus.CANCELLED })
      })

      await expect(sdk.translate(['content']))
        .rejects.toThrow('Translation cancelled')
    })
  })

  describe('translateString', () => {
    it('should successfully translate a string', async () => {
      const content = 'Hello'
      const lang = 'fr'
      const translationId = 123
      const translatedContent = [{
        files: [{
          content: JSON.stringify({ translation: 'Bonjour' })
        }]
      }]

      // Mock supported languages check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(['en', 'fr', 'es'])
      })

      // Mock translation request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ translationId })
      })

      // Mock status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: TranslationStatus.COMPLETED })
      })

      // Mock content retrieval
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(translatedContent)
      })

      const result = await sdk.translateString(content, lang)
      expect(result).toBe('Bonjour')
    })

    it('should throw error for unsupported language', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(['en', 'fr'])
      })

      await expect(sdk.translateString('Hello', 'invalid'))
        .rejects.toThrow('Language \'invalid\' is not supported')
    })
  })

  describe('getTextMap', () => {
    it('should successfully retrieve text map', async () => {
      const mockTextMap = { texts: { key: 'value' } }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTextMap)
      })

      const result = await sdk.getTextMap()
      expect(result).toEqual(mockTextMap)
    })
  })

  describe('upload', () => {
    it('should successfully upload files', async () => {
      const files = [{
        language: 'en',
        fileId: 'test.json',
        content: '{"key": "value"}'
      }]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })

      const result = await sdk.upload(files)
      expect(result).toEqual({ success: true })
    })

    it('should handle upload errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid file format')
      })

      await expect(sdk.upload([]))
        .rejects.toThrow('Failed to upload files')
    })
  })

  describe('getSupportedLanguages', () => {
    it('should return supported languages', async () => {
      const languages = ['en', 'fr', 'es']
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(languages)
      })

      const result = await sdk.getSupportedLanguages()
      expect(result).toEqual(languages)
    })
  })

  describe('getPublicAPIKeyFromDomain', () => {
    it('should return public API key', async () => {
      const mockApiKey = 'public-key'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiKey)
      })

      const result = await sdk.getPublicAPIKeyFromDomain('example.com')
      expect(result).toBe(mockApiKey)
    })
  })

  describe('getSupportedFileTypes', () => {
    it('should return supported file types', async () => {
      const fileTypes = ['json', 'po']
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fileTypes)
      })

      const result = await sdk.getSupportedFileTypes()
      expect(result).toEqual(fileTypes)
    })
  })

  describe('getProjectSupportedLanguages', () => {
    it('should return project supported languages', async () => {
      const response = {
        supportedLanguages: ['en', 'fr'],
        originLanguage: 'en'
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response)
      })

      const result = await sdk.getProjectSupportedLanguages()
      expect(result).toEqual(response)
    })
  })

  describe('getDefaultConfiguration', () => {
    it('should return default configuration', async () => {
      const config = {
        originLanguage: 'en',
        targetLanguages: ['fr', 'es'],
        model: 'gpt-4'
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config)
      })

      const result = await sdk.getDefaultConfiguration()
      expect(result).toEqual(config)
    })
  })

  describe('getTranslationStatus', () => {
    it('should return translation status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: TranslationStatus.COMPLETED })
      })

      const result = await sdk.getTranslationStatus(123)
      expect(result).toBe(TranslationStatus.COMPLETED)
    })
  })

  describe('getTranslationContent', () => {
    it('should return translation content', async () => {
      const content = [{
        language: 'fr',
        files: [{ fileId: 'test.json', content: 'translated content' }]
      }]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(content)
      })

      const result = await sdk.getTranslationContent(123)
      expect(result).toEqual(content)
    })
  })
}) 