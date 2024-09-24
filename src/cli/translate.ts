import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';
import { findLanguageFiles, getRelativePath, readFiles } from './utils';

dotenv.config();

const ORIGIN_LANGUAGE_DIR = process.env.ORIGIN_LANGUAGE_TRANSLATION_PATH!;
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;
const TRANSLATION_PATH = process.env.TRANSLATION_PATH!;

export async function translate(customPath: string = TRANSLATION_PATH) {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const frenglish = new FrenglishSDK(FRENGLISH_API_KEY);

    // Find all files to translate using glob
    const originLanguage = (await frenglish.getDefaultConfiguration()).originLanguage
    const supportedFileTypes = await frenglish.getSupportedFileTypes()
    const languageFiles = await findLanguageFiles(customPath, [originLanguage], supportedFileTypes); 

    // Flatten the languageFiles map into a single array of file paths
    const filesToTranslate = Array.from(languageFiles.values()).flat();

    if (filesToTranslate.length === 0) {
      console.log('No files found to translate.');
      return;
    }

    const fileContents = await readFiles(filesToTranslate);

    if (fileContents.length === 0) {
      console.log('No valid files to translate after reading.');
      return;
    }

    // We get relative path
    const fileIDs = fileContents.map(file => getRelativePath(customPath, file.fileId, 'en'));
    const contents = fileContents.map(file => file.content);

    console.log('Files to translate:', fileIDs);
    console.log('Uploading files and creating translation...');

    const translationResponse = await frenglish.translate(fileIDs as [], contents as []);

    if (translationResponse && translationResponse.content) {
      for (const languageData of translationResponse.content) {
        const language = languageData.language;
        const translatedFiles = languageData.files;
        for (const translatedFile of translatedFiles) {
    
          const originalFile = fileIDs.find(file => file === translatedFile.fileId);
          if (originalFile) {
            const translatedFilePath = path.join(customPath, language, originalFile)
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