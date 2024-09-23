import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';
import fg from 'fast-glob';
import { FileContentWithLanguage } from 'src/types/api';

dotenv.config();

const TRANSLATION_PATH = process.env.TRANSLATION_PATH!;
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;

async function resolvePaths(inputs: string[]): Promise<string[]> {
  const resolvedPaths: string[] = [];

  for (const input of inputs) {
    try {
      const stats = await fs.stat(input);
      if (stats.isDirectory()) {
        resolvedPaths.push(input);
      } else {
        const matches = await fg(input, {
          onlyFiles: false,
          unique: true,
          caseSensitiveMatch: false,
          absolute: true
        });

        if (matches.length === 0) {
          console.warn(`No matches found for pattern: ${input}`);
        }

        resolvedPaths.push(...matches);
      }
    } catch (error) {
      console.error(`Error resolving path ${input}:`, error);
    }
  }

  return resolvedPaths;
}

async function getFilesToUpload(customPaths: string[], supportedLanguages: string[]): Promise<string[]> {
  const allFiles: string[] = [];

  async function traverseDirectory(currentPath: string, isRoot: boolean = true) {
    try {
      const stats = await fs.stat(currentPath);
      if (stats.isDirectory()) {
        const dirName = path.basename(currentPath).toLowerCase();
        if (supportedLanguages.includes(dirName) || isRoot) {
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
              await traverseDirectory(entryPath, false);
            } else if (entry.isFile() && supportedLanguages.includes(path.basename(path.dirname(entryPath)).toLowerCase())) {
              allFiles.push(entryPath);
            }
          }
        } else {
          console.log(`Skipping unsupported language directory: ${currentPath}`);
        }
      } else if (stats.isFile()) {
        const parentDir = path.basename(path.dirname(currentPath)).toLowerCase();
        if (supportedLanguages.includes(parentDir)) {
          allFiles.push(currentPath);
        }
      }
    } catch (error) {
      console.error(`Error accessing path ${currentPath}:`, error);
    }
  }

  for (const customPath of customPaths) {
    await traverseDirectory(customPath);
  }

  return allFiles;
}

function extractTargetLanguage(filePath: string, supportedLanguages: string[]): string {
  const parts = filePath.split(path.sep);
  const langIndex = parts.findIndex(part =>
    supportedLanguages.includes(part.toLowerCase())
  );
  return langIndex !== -1 ? parts[langIndex].toLowerCase() : 'unknown';
}

export async function upload(customPathInputs: string[] = [TRANSLATION_PATH]) {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const frenglishSDK = new FrenglishSDK(FRENGLISH_API_KEY);

    const supportedLanguages = await frenglishSDK.getSupportedLanguages();

    const resolvedPaths = await resolvePaths(customPathInputs);

    if (resolvedPaths.length === 0) {
      console.log('No valid paths provided.');
      return;
    }

    const filesToUpload = await getFilesToUpload(resolvedPaths, supportedLanguages);

    if (filesToUpload.length === 0) {
      console.log('No files to upload');
      return;
    }

    const fileContents = await Promise.all(filesToUpload.map(async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const language = extractTargetLanguage(file, supportedLanguages);
        const fileId = path.basename(file);
        return { 
          language,
          fileId,
          content
        } as FileContentWithLanguage;
      } catch (readError) {
        console.error(`Error reading file ${file}:`, readError);
        return null;
      }
    }));

    const validFileContents: FileContentWithLanguage[] = fileContents.filter(
      (file): file is FileContentWithLanguage => file !== null
    );

    if (validFileContents.length === 0) {
      console.log('No valid files to upload after reading.');
      return;
    }

    console.log('Files to upload:');
    validFileContents.forEach(file => console.log(`${file.language}/${file.fileId}`));

    try {
      await frenglishSDK.upload(validFileContents);
      console.log('Files uploaded successfully');
    } catch (uploadError) {
      console.error('Error uploading files:', uploadError);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// CLI-specific code
if (require.main === module) {
  import('yargs').then(({ default: yargs }) => {
    const argv = yargs(process.argv.slice(2))
      .usage('Usage: $0 <command> [options]')
      .command('upload', 'Upload files for translation', {
        path: {
          type: 'array',
          description: 'Specify custom paths or glob patterns for uploading files (overrides TRANSLATION_PATH)',
          default: [TRANSLATION_PATH]
        }
      })
      .example('$0 upload', 'Upload files using the default TRANSLATION_PATH')
      .example('$0 upload --path ./src/locales/**/*.json', 'Upload JSON files from a custom directory')
      .help('h')
      .alias('h', 'help')
      .epilog('For more information, visit https://www.frenglish.ai')
      .parse();

    if (argv._.includes('upload')) {
      upload(argv.path as string[]);
    } else {
      yargs.showHelp();
    }
  });
}