import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';
import { findLanguageFiles, getRelativePath, readFiles } from './utils';
import { PartialConfiguration } from 'src/types/configuration';

dotenv.config();

const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;
const TRANSLATION_PATH = process.env.TRANSLATION_PATH!;

export async function translate(customPath: string = TRANSLATION_PATH, isFullTranslation: boolean = false, partialConfig: PartialConfiguration = {}) {
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
    console.log('Is full translation:', isFullTranslation);

    const translationResponse = await frenglish.translate(contents as [], isFullTranslation, fileIDs as [], partialConfig);

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