import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';

dotenv.config();

const ORIGIN_LANGUAGE_DIR = process.env.ORIGIN_LANGUAGE_TRANSLATION_PATH!;
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;

async function getFilesToTranslate(customPath: string): Promise<string[]> {
  try {
    const stats = await fs.stat(customPath);
    if (stats.isDirectory()) {
      console.log(`Translating all files in directory: ${customPath}`);
      const allFiles = await fs.readdir(customPath);
      return allFiles.map(file => path.join(customPath, file));
    } else if (stats.isFile()) {
      console.log(`Translating single file: ${customPath}`);
      return [customPath];
    } else {
      throw new Error(`Invalid path: ${customPath}`);
    }
  } catch (error) {
    console.error(`Error accessing path ${customPath}:`, error);
    return [];
  }
}

export async function translate(customPath: string) {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const filesToTranslate = await getFilesToTranslate(customPath);

    if (filesToTranslate.length === 0) {
      console.log('No files to translate');
      return;
    }

    const fileContents = await Promise.all(filesToTranslate.map(async (file) => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        return { fileId: path.basename(file), content };
      } catch (error) {
        console.error(`Error reading file ${file}:`, error);
        return null;
      }
    }));

    const validFileContents = fileContents.filter((file): file is { fileId: string; content: string } => file !== null);

    if (validFileContents.length === 0) {
      console.log('No valid files to translate after reading.');
      return;
    }

    const fileIDs = validFileContents.map(file => file.fileId);
    const contents = validFileContents.map(file => file.content);

    console.log('Files to translate:', fileIDs);
    console.log('Uploading files and creating translation...');

    const translationSDK = new FrenglishSDK(FRENGLISH_API_KEY);
    
    const translationResponse = await translationSDK.translate(fileIDs as [], contents as []);

    if (translationResponse && translationResponse.content) {
      for (const languageData of translationResponse.content) {
        const language = languageData.language;
        const translatedFiles = languageData.files;
    
        console.log(`Processing language: ${language}`);
        console.log(`Number of translated files: ${translatedFiles.length}`);
    
        for (const translatedFile of translatedFiles) {
          console.log(`Processing file: ${translatedFile.fileId}`);
          console.log(`File content length: ${translatedFile.content.length}`);
    
          const originalFile = filesToTranslate.find(file => path.basename(file) === translatedFile.fileId);
          if (originalFile) {
            const translatedFilePath = originalFile.replace(customPath, path.join(path.dirname(customPath), language));
            await fs.mkdir(path.dirname(translatedFilePath), { recursive: true });
            
            if (translatedFile.content.length > 0) {
              await fs.writeFile(translatedFilePath, translatedFile.content, 'utf8');
              console.log(`Translated file written: ${translatedFilePath}`);
            } else {
              console.warn(`Empty content for file: ${translatedFile.fileId}. Skipping.`);
            }
          } else {
            console.warn(`Original file not found for translated file: ${translatedFile.fileId}`);
          }
        }
      }
    } else {
      console.warn('No content in translation response');
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
      .command('translate', 'Translate files', {
        path: {
          type: 'string',
          description: 'Specify a custom path for translation (file or directory, overrides TRANSLATION_PATH)',
          default: ORIGIN_LANGUAGE_DIR
        }
      })
      .example('$0 translate', 'Translate files using the default TRANSLATION_PATH')
      .example('$0 translate --path "./custom/path/file.json"', 'Translate a specific JSON file')
      .example('$0 translate --path "./custom/path"', 'Translate all files in a custom directory')
      .help('h')
      .alias('h', 'help')
      .epilog('For more information, visit https://www.frenglish.ai')
      .parse();

    if (argv._.includes('translate')) {
      translate(argv.path as string);
    } else {
      yargs.showHelp();
    }
  });
}