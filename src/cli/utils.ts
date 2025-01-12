import * as fs from 'fs/promises';
import * as path from 'path';
import glob from 'glob-promise';
import { minimatch } from 'minimatch';

/**
 * Finds language files by detecting where in the path the language code occurs.
 * Retains the full path starting from the provided basePath and includes everything to the right of the language folder.
 *
 * @param basePath - the base directory to start searching from
 * @param supportedLanguages - array of supported language codes (e.g., ['en', 'fr', 'es'])
 * @returns {Promise<Map<string, string[]>>} - a map of language codes to file paths
 */
export async function findLanguageFiles(
  basePath: string,
  supportedLanguages: string[],
  supportedFileTypes: string[],
  excludePath: string[] = []
): Promise<Map<string, string[]>> {
  const languageFiles = new Map<string, string[]>();
  const fileTypes = supportedFileTypes.join(',')
  const pattern = `**/*.{${fileTypes}}`;
  const files = await glob(pattern, { cwd: basePath, absolute: true });

  for (const file of files) {
    const relativeToBase = path.relative(basePath, file);
    
    const shouldExclude = excludePath.some(excludePattern => {
      const normalizedFile = file.replace(/\\/g, '/');
      const normalizedPattern = excludePattern.trim().replace(/\\/g, '/');
      const cleanPattern = normalizedPattern.replace(/[\[\]'"`]/g, '');

      // If pattern contains glob characters (* or **), use minimatch
      if (cleanPattern.includes('*')) {
        return minimatch(normalizedFile, cleanPattern, {
          dot: true,
          matchBase: true,
          nocase: true
        });
      }
      
      // Otherwise, use simple includes for exact path matching
      return normalizedFile.includes(cleanPattern);
    });

    if (shouldExclude) {
      continue;
    }

    const absoluteParts = file.split(path.sep);
    const language = absoluteParts.find(part => supportedLanguages.includes(part.toLowerCase()));

    if (language) {
      const fullPath = path.join(basePath, relativeToBase);
      if (languageFiles.has(language)) {
        languageFiles.get(language)!.push(fullPath);
      } else {
        languageFiles.set(language, [fullPath]);
      }
    }
  }

  return languageFiles;
}

// Helper function for reading files
export async function readFiles(files: string[]): Promise<Array<{ fileId: string; content: string }>> {
  const fileContents = await Promise.all(
    files.map(async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        return { fileId: file, content };
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
        return null;
      }
    })
  );

  return fileContents.filter((file): file is { fileId: string; content: string } => file !== null);
}

// Helper function for validating file contents
export function validateFiles(files: Array<{ fileId: string; content: string }>): boolean {
  return files.every(
    (file) => typeof file.fileId === 'string' && file.fileId.length > 0 && file.content.length > 0
  );
}

// Helper function to get the relative path
export function getRelativePath(basePath: string, filePath: string, excludePaths: string[] = []): string | undefined {
  // Normalize the file path to use forward slashes
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  
  // Check if the file matches any of the exclude patterns
  const isExcluded = excludePaths.some(excludePath => {
    const normalizedExcludePath = excludePath.trim().replace(/\\/g, '/');
    return normalizedFilePath.includes(normalizedExcludePath);
  });

  if (isExcluded) {
    return undefined;
  }

  // Get the relative path and normalize it
  const fullRelativePath = path.relative(basePath, filePath).replace(/\\/g, '/');
  const parts = fullRelativePath.split('/');
  
  // Remove the language code (first directory) and join the rest
  const result = parts.length > 1 ? parts.slice(1).join('/') : '';
  return result || undefined;
}
