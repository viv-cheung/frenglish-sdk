import { describe, it, expect, beforeEach, vi } from 'vitest'
import { findLanguageFilesToTranslate, readFiles, validateFiles, getRelativePath } from '../../src/cli/utils'
import * as fs from 'fs/promises'
import * as path from 'path'
import glob from 'glob-promise'

// Mock external modules
vi.mock('fs/promises')
vi.mock('glob-promise')
vi.mock('path', async () => {
  const actual = await vi.importActual('path') as typeof path
  return {
    ...actual,
    sep: '/',
  }
})

describe('CLI Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findLanguageFilesToTranslate', () => {
    it('should find files for supported languages', async () => {
      const mockFiles = [
        '/base/en/file1.json',
        '/base/fr/file2.json',
        '/base/es/file3.json',
        '/base/shared/file4.json'
      ]
      
      vi.mocked(glob).mockResolvedValue(mockFiles)

      const result = await findLanguageFilesToTranslate(
        '/base',
        'en',
        ['en', 'fr', 'es'],
        ['json'],
        []
      )

      expect(result.get('en')).toContain('/base/en/file1.json')
      expect(result.get('fr')).toContain('/base/fr/file2.json')
      expect(result.get('es')).toContain('/base/es/file3.json')
      // Files without language code should default to first supported language
      expect(result.get('en')).toContain('/base/shared/file4.json')
    })

    it('should exclude files based on exclude patterns', async () => {
      const mockFiles = [
        '/base/en/file1.json',
        '/base/en/excluded/file2.json',
        '/base/en/node_modules/file3.json'
      ]
      
      vi.mocked(glob).mockResolvedValue(mockFiles)

      const result = await findLanguageFilesToTranslate(
        '/base',
        'en',
        ['en'],
        ['json'],
        ['**/excluded/**', '**/node_modules/**']
      )

      expect(result.get('en')).toContain('/base/en/file1.json')
      expect(result.get('en')).not.toContain('/base/en/excluded/file2.json')
      expect(result.get('en')).not.toContain('/base/en/node_modules/file3.json')
    })
  })

  describe('readFiles', () => {
    it('should read multiple files successfully', async () => {
      vi.mocked(fs.readFile).mockImplementation((path) => {
        const mockContent: { [key: string]: string } = {
          'file1.json': 'content1',
          'file2.json': 'content2'
        }
        return Promise.resolve(mockContent[path as string])
      })

      const files = ['file1.json', 'file2.json']
      const result = await readFiles(files)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ fileId: 'file1.json', content: 'content1' })
      expect(result[1]).toEqual({ fileId: 'file2.json', content: 'content2' })
    })

    it('should handle file read errors gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'))

      const files = ['nonexistent.json']
      const result = await readFiles(files)

      expect(result).toHaveLength(0)
    })
  })

  describe('validateFiles', () => {
    it('should validate valid file contents', () => {
      const files = [
        { fileId: 'file1.json', content: 'content1' },
        { fileId: 'file2.json', content: 'content2' }
      ]

      expect(validateFiles(files)).toBe(true)
    })

    it('should reject invalid file contents', () => {
      const files = [
        { fileId: '', content: 'content1' },
        { fileId: 'file2.json', content: '' }
      ]

      expect(validateFiles(files)).toBe(false)
    })
  })

  describe('getRelativePath', () => {
    it('should return relative path without language code prefix', async () => {
      const result = await getRelativePath(
        '/base',
        '/base/en/path/to/file.json',
        ['en', 'fr'],
        []
      )

      expect(result).toBe('path/to/file.json')
    })

    it('should handle paths without language code', async () => {
      const result = await getRelativePath(
        '/base',
        '/base/path/to/file.json',
        ['en', 'fr'],
        []
      )

      expect(result).toBe('path/to/file.json')
    })

    it('should return undefined for excluded paths', async () => {
      const result = await getRelativePath(
        '/base',
        '/base/en/excluded/file.json',
        ['en'],
        ['excluded']
      )

      expect(result).toBeUndefined()
    })

    it('should normalize path separators', async () => {
      const result = await getRelativePath(
        '/base',
        '/base\\en\\path\\to\\file.json',
        ['en'],
        []
      )

      expect(result).toBe('path/to/file.json')
    })
  })
}) 