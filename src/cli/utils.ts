import * as fs from 'fs/promises';
import * as path from 'path';
import glob from 'glob-promise';


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
  supportedFileTypes: string[]
): Promise<Map<string, string[]>> {
  const languageFiles = new Map<string, string[]>();

  // Use glob to match only .json and .md files
  const fileTypes = supportedFileTypes.join(',')
  const pattern = `**/*.{${fileTypes}}`;
  const files = await glob(pattern, { cwd: basePath, absolute: true });

  // Process each file to detect the language and store the full path, including basePath
  files.forEach((file: string) => {
    const relativeToBase = path.relative(basePath, file);
    const absoluteParts = file.split(path.sep);

    // Check if any part of the absolute path contains a supported language
    const language = absoluteParts.find(part => supportedLanguages.includes(part.toLowerCase()));

    if (language) {
      // Keep the full path starting from basePath
      const fullPath = path.join(basePath, relativeToBase);

      if (languageFiles.has(language)) {
        languageFiles.get(language)!.push(fullPath);
      } else {
        languageFiles.set(language, [fullPath]);
      }
    }
  });

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

// Helper function to get the relative path excluding the language code
export function getRelativePath(basePath: string, filePath: string, language: string): string {
  const fullRelativePath = path.relative(basePath, filePath);
  const parts = fullRelativePath.split(path.sep);
  return parts.slice(1).join(path.sep); // Remove the language code
}
