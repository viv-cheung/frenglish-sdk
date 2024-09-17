#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config();

const ORIGIN_LANGUAGE_DIR = process.env.ORIGIN_LANGUAGE_TRANSLATION_PATH!;
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;

const argv = yargs(hideBin(process.argv))
  .option('path', {
    type: 'string',
    description: 'Specify a custom path for translation (overrides ORIGIN_LANGUAGE_DIR)',
    default: ORIGIN_LANGUAGE_DIR
  })
  .parse();

async function getFilesToTranslate(customPath: string): Promise<string[]> {
  const targetDir = customPath || ORIGIN_LANGUAGE_DIR;
  console.log(`Translating all files in: ${targetDir}`);
  const allFiles = await fs.readdir(targetDir);
  return allFiles.map(file => path.join(targetDir, file));
}

async function createTranslation() {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const filesToTranslate = await getFilesToTranslate(argv.path);

    if (filesToTranslate.length === 0) {
      console.log('No files to translate');
      return;
    }

    const fileContents = await Promise.all(filesToTranslate.map(async (file) => {
      const content = await fs.readFile(file, 'utf-8');
      return { fileId: path.basename(file), content };
    }));

    const fileIDs = fileContents.map(file => file.fileId);
    const contents = fileContents.map(file => file.content);

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
            const translatedFilePath = originalFile.replace(argv.path, path.join(path.dirname(argv.path), language));
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

createTranslation();