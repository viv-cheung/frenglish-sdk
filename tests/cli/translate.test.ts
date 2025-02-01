import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { translate } from '../../src/cli/translate'
import FrenglishSDK from '../../src/sdk'
import { findLanguageFilesToTranslate, readFiles, getRelativePath } from '../../src/cli/utils'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Configuration } from 'src/types/configuration'

// Mock the SDK, utils, and filesystem modules
vi.mock('../../src/sdk')
vi.mock('../../src/cli/utils')
vi.mock('fs/promises')
vi.mock('path', async () => {
  const actual = await vi.importActual('path') as typeof path
  return {
    ...actual,
    join: vi.fn((...args) => args.join('/'))
  }
})
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn()
  }
}))

describe('Translate functionality', () => {
  // Store the original env values to restore them later
  const originalEnv = { ...process.env }
  
  beforeAll(() => {
    // Verify .env is loaded
    console.log('FRENGLISH_API_KEY:', process.env.FRENGLISH_API_KEY)
    console.log('TRANSLATION_PATH:', process.env.TRANSLATION_PATH)
    console.log('TRANSLATION_OUTPUT_PATH:', process.env.TRANSLATION_OUTPUT_PATH)
  })

  // Define mock values used throughout tests
  const mockPath = process.env.TRANSLATION_PATH || path.join(__dirname, '../fixtures/translationPath/locales')
  const mockExcludedPaths = process.env.EXCLUDED_TRANSLATION_PATH ? 
    JSON.parse(process.env.EXCLUDED_TRANSLATION_PATH) : 
    ['**/excluded/**']

  beforeEach(() => {
    vi.clearAllMocks()
    
    // No need to manually set env variables - they're loaded from .env
    // Just mock the SDK methods
    vi.mocked(FrenglishSDK.prototype.getDefaultConfiguration).mockResolvedValue({
      originLanguage: 'en',
      languages: ['fr', 'es'],
    } as Configuration)
    vi.mocked(FrenglishSDK.prototype.getSupportedLanguages).mockResolvedValue(['en', 'fr', 'es'])
    vi.mocked(FrenglishSDK.prototype.getSupportedFileTypes).mockResolvedValue(['json', 'po'])
  })

  afterEach(() => {
    // Restore the original env after each test
    process.env = { ...originalEnv }
  })

  it('should successfully translate files', async () => {
    // Mock language files map with actual test files
    const mockLanguageFiles = new Map([
      ['en', [
        path.join(process.env.TRANSLATION_PATH!, 'en/example.json'),
        path.join(process.env.TRANSLATION_PATH!, 'en/intro.md'),
        path.join(process.env.TRANSLATION_PATH!, 'en/messages.po')
      ]]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)

    // Mock file contents using actual file paths
    const mockFileContents = [
      { 
        fileId: path.join(process.env.TRANSLATION_PATH!, 'en/example.json'),
        content: '{"key": "value"}'
      }
    ]
    vi.mocked(readFiles).mockResolvedValue(mockFileContents)

    // Mock relative path resolution
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    // Updated mock translation response to match RequestTranslationResponse type
    const mockTranslationResponse = {
      translationId: 123,
      content: [
        {
          language: 'fr',
          files: [{ fileId: 'file1.json', content: '{"key": "valeur"}' }]
        },
        {
          language: 'es',
          files: [{ fileId: 'file1.json', content: '{"key": "valor"}' }]
        }
      ]
    }
    vi.mocked(FrenglishSDK.prototype.translate).mockResolvedValue(mockTranslationResponse)

    // Execute translation
    await translate(mockPath, false, {}, mockExcludedPaths)

    // Verify SDK initialization and method calls
    expect(FrenglishSDK).toHaveBeenCalledWith(process.env.FRENGLISH_API_KEY)
    expect(FrenglishSDK.prototype.getDefaultConfiguration).toHaveBeenCalled()
    expect(FrenglishSDK.prototype.getSupportedLanguages).toHaveBeenCalled()
    expect(FrenglishSDK.prototype.getSupportedFileTypes).toHaveBeenCalled()
    expect(fs.mkdir).toHaveBeenCalled()
    expect(fs.writeFile).toHaveBeenCalledTimes(2)
  })

  it('should handle missing API key', async () => {
    // Remove API key from environment
    delete process.env.FRENGLISH_API_KEY

    const consoleSpy = vi.spyOn(console, 'error')
    await translate(mockPath)

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error:',
      expect.any(Error)
    )
    expect(FrenglishSDK.prototype.translate).not.toHaveBeenCalled()
  })

  it('should handle empty file list', async () => {
    // Mock empty language files map
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(new Map())
    
    const consoleLogSpy = vi.spyOn(console, 'log')
    await translate(mockPath)

    expect(consoleLogSpy).toHaveBeenCalledWith('No files found to translate.')
    expect(FrenglishSDK.prototype.translate).not.toHaveBeenCalled()
  })

  it('should handle empty file contents', async () => {
    // Mock language files but empty contents
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)
    vi.mocked(readFiles).mockResolvedValue([])

    const consoleLogSpy = vi.spyOn(console, 'log')
    await translate(mockPath)

    expect(consoleLogSpy).toHaveBeenCalledWith('No valid files to translate after reading.')
    expect(FrenglishSDK.prototype.translate).not.toHaveBeenCalled()
  })

  it('should handle empty translation response', async () => {
    // Mock successful file finding and reading
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' }
    ])
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    // Updated mock empty translation response
    vi.mocked(FrenglishSDK.prototype.translate).mockResolvedValue({
      translationId: 124,
      content: []
    })

    const consoleWarnSpy = vi.spyOn(console, 'warn')
    await translate(mockPath)

    expect(consoleWarnSpy).toHaveBeenCalledWith('No content in translation response')
  })

  it('should handle empty content in translated files', async () => {
    // Mock successful file finding and reading
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' }
    ])
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    // Updated mock translation response
    const mockTranslationResponse = {
      translationId: 125,
      content: [
        {
          language: 'fr',
          files: [{ fileId: 'file1.json', content: '' }]
        }
      ]
    }
    vi.mocked(FrenglishSDK.prototype.translate).mockResolvedValue(mockTranslationResponse)

    const consoleWarnSpy = vi.spyOn(console, 'warn')
    await translate(mockPath)

    expect(consoleWarnSpy).toHaveBeenCalledWith('Empty content for file: file1.json. Skipping.')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('should handle translation with partial configuration', async () => {
    // Mock successful file finding and reading
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' }
    ])
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    const partialConfig = {
        originLanguage: 'en',
        languages: ['fr'],
    }

    await translate(mockPath, false, partialConfig)

    expect(FrenglishSDK.prototype.translate).toHaveBeenCalledWith(
      expect.any(Array),
      false,
      expect.any(Array),
      partialConfig
    )
  })

  it('should handle full translation mode', async () => {
    // Mock successful file finding and reading
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' }
    ])
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    await translate(mockPath, true)

    expect(FrenglishSDK.prototype.translate).toHaveBeenCalledWith(
      expect.any(Array),
      true,
      expect.any(Array),
      {}
    )
  })
}) 