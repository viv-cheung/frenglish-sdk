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
    description: 'Specify a custom path for uploading files (overrides ORIGIN_LANGUAGE_DIR)',
    default: ORIGIN_LANGUAGE_DIR
  })
  .parse();

async function getFilesToUpload(customPath: string): Promise<string[]> {
  const targetDir = customPath || ORIGIN_LANGUAGE_DIR;
  console.log(`Uploading all files in: ${targetDir}`);
  const allFiles = await fs.readdir(targetDir);
  return allFiles.map(file => path.join(targetDir, file));
}

async function uploadFiles() {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const filesToUpload = await getFilesToUpload(argv.path);

    if (filesToUpload.length === 0) {
      console.log('No files to upload');
      return;
    }

    const fileContents = await Promise.all(filesToUpload.map(async (file) => {
      const content = await fs.readFile(file, 'utf-8');
      return { fileId: path.basename(file), content };
    }));

    console.log('Files to upload:', fileContents.map(file => file.fileId));
    console.log('Uploading files...');

    const frenglishSDK = new FrenglishSDK(FRENGLISH_API_KEY);
    
    try {
      await frenglishSDK.upload(fileContents);
      console.log('Files uploaded successfully');
    } catch (error) {
      console.error('Error uploading files:', error);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

uploadFiles();