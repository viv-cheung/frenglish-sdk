import { describe, it, expect, vi, beforeEach } from 'vitest'
import { upload } from '../../src/cli/upload'
import FrenglishSDK from '../../src/sdk'
import { findLanguageFilesToTranslate, readFiles, validateFiles, getRelativePath } from '../../src/cli/utils'

// Mock the SDK and utility functions
vi.mock('../../src/sdk')
vi.mock('../../src/cli/utils')
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn()
  }
}))

describe('Upload functionality', () => {
  const mockApiKey = 'test-api-key'
  const mockPath = '/test/path'
  const mockExcludedPaths = ['**/excluded/**']

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup environment variables
    process.env.FRENGLISH_API_KEY = mockApiKey
    
    // Mock SDK methods
    vi.mocked(FrenglishSDK.prototype.getSupportedLanguages).mockResolvedValue(['en', 'fr', 'es'])
    vi.mocked(FrenglishSDK.prototype.getSupportedFileTypes).mockResolvedValue(['json', 'po'])
    vi.mocked(FrenglishSDK.prototype.upload).mockResolvedValue({ success: true })
  })

  it('should successfully upload files', async () => {
    // Mock language files map
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']],
      ['fr', ['/test/path/fr/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)

    // Mock file contents
    const mockFileContents = [
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' },
      { fileId: '/test/path/fr/file1.json', content: '{"key": "valeur"}' }
    ]
    vi.mocked(readFiles).mockResolvedValue(mockFileContents)

    // Mock file validation
    vi.mocked(validateFiles).mockReturnValue(true)

    // Mock relative path resolution
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    // Execute upload
    await upload(mockPath, mockExcludedPaths)

    // Verify SDK initialization and method calls
    expect(FrenglishSDK).toHaveBeenCalledWith(mockApiKey)
    expect(FrenglishSDK.prototype.getSupportedLanguages).toHaveBeenCalled()
    expect(FrenglishSDK.prototype.getSupportedFileTypes).toHaveBeenCalled()
    expect(findLanguageFilesToTranslate).toHaveBeenCalledWith(
      mockPath,
      ['en', 'fr', 'es'],
      ['json', 'po'],
      mockExcludedPaths
    )
    expect(FrenglishSDK.prototype.upload).toHaveBeenCalled()
  })

  it('should handle missing API key', async () => {
    // Remove API key from environment
    delete process.env.FRENGLISH_API_KEY

    const consoleSpy = vi.spyOn(console, 'error')
    await upload(mockPath)

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error:',
      expect.any(Error)
    )
    expect(FrenglishSDK.prototype.upload).not.toHaveBeenCalled()
  })

  it('should handle empty file list', async () => {
    // Mock empty language files map
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(new Map())
    
    const consoleLogSpy = vi.spyOn(console, 'log')
    await upload(mockPath)

    expect(consoleLogSpy).toHaveBeenCalledWith('No valid files to upload.')
    expect(FrenglishSDK.prototype.upload).not.toHaveBeenCalled()
  })

  it('should handle upload errors', async () => {
    // Mock successful file finding
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)

    // Mock file contents
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' }
    ])

    // Mock file validation
    vi.mocked(validateFiles).mockReturnValue(true)

    // Mock relative path resolution
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    // Mock upload failure
    const mockError = new Error('Upload failed')
    vi.mocked(FrenglishSDK.prototype.upload).mockRejectedValue(mockError)

    const consoleErrorSpy = vi.spyOn(console, 'error')
    await upload(mockPath)

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error uploading files:', mockError)
  })

  it('should skip unsupported languages', async () => {
    // Mock language files including unsupported language
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']],
      ['unsupported', ['/test/path/unsupported/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)

    // Mock file contents
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '{"key": "value"}' }
    ])

    // Mock file validation
    vi.mocked(validateFiles).mockReturnValue(true)

    // Mock relative path resolution
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    const consoleLogSpy = vi.spyOn(console, 'log')
    await upload(mockPath)

    expect(consoleLogSpy).toHaveBeenCalledWith('Skipping unsupported language: unsupported')
    expect(FrenglishSDK.prototype.upload).toHaveBeenCalled()
  })

  it('should warn about invalid files', async () => {
    // Mock language files
    const mockLanguageFiles = new Map([
      ['en', ['/test/path/en/file1.json']]
    ])
    vi.mocked(findLanguageFilesToTranslate).mockResolvedValue(mockLanguageFiles)

    // Mock file contents
    vi.mocked(readFiles).mockResolvedValue([
      { fileId: '/test/path/en/file1.json', content: '' } // Invalid content
    ])

    // Mock file validation to fail
    vi.mocked(validateFiles).mockReturnValue(false)

    // Mock relative path resolution
    vi.mocked(getRelativePath).mockResolvedValue('file1.json')

    const consoleWarnSpy = vi.spyOn(console, 'warn')
    await upload(mockPath)

    expect(consoleWarnSpy).toHaveBeenCalledWith('Some files are invalid')
  })
}) 