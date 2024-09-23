#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fg from 'fast-glob';
import { FileContentWithLanguage } from 'src/types/api';

dotenv.config();

const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;
const argv = yargs(hideBin(process.argv))
  .option('path', {
    type: 'array', // Changed from 'string' to 'array'
    description: 'Specify custom paths or glob patterns for uploading files',
    demandOption: true
  })
  .parse();

const customPathInputs: string[] = argv.path as string[];

// Function to resolve paths using fast-glob
async function resolvePaths(inputs: string[]): Promise<string[]> {
  const resolvedPaths: string[] = [];

  for (const input of inputs) {
    const matches = await fg(input, {
      onlyDirectories: true, // Only match directories
      unique: true,          // Ensure unique paths
      caseSensitiveMatch: false,
      absolute: true          // Return absolute paths
    });

    if (matches.length === 0) {
      console.warn(`No matches found for pattern: ${input}`);
    }

    resolvedPaths.push(...matches);
  }

  return resolvedPaths;
}

async function getFilesToUpload(customPaths: string[], supportedLanguages: string[]): Promise<string[]> {
  const allFiles: string[] = [];

  // Helper function to traverse directories recursively
  async function traverseDirectory(currentPath: string) {
    try {
      const stats = await fs.stat(currentPath);
      if (stats.isDirectory()) {
        const langCode = path.basename(currentPath).toLowerCase();
        // Check if the current directory is a supported language
        if (supportedLanguages.includes(langCode)) {
          console.log(`Scanning for files in: ${currentPath}`);
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
              // Recursively traverse subdirectories
              await traverseDirectory(entryPath);
            } else if (entry.isFile()) {
              allFiles.push(entryPath);
            }
          }
        } else {
          // If the directory is not a supported language, skip it
          console.log(`Skipping unsupported language directory: ${currentPath}`);
        }
      } else if (stats.isFile()) {
        // If it's a file directly under the custom path
        const targetLanguage = extractTargetLanguage(currentPath, supportedLanguages);
        if (supportedLanguages.includes(targetLanguage)) {
          allFiles.push(currentPath);
        }
      }
    } catch (error) {
      console.error(`Error accessing path ${currentPath}:`, error);
    }
  }

  // Start traversing each custom path
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

async function uploadFiles() {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const frenglishSDK = new FrenglishSDK(FRENGLISH_API_KEY);

    console.log('Fetching supported languages...');
    const supportedLanguages = await frenglishSDK.getSupportedLanguages();
    console.log('Supported languages:', supportedLanguages);

    // Resolve glob patterns to actual paths
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
        return null; // Exclude this file from upload
      }
    }));

    // Type Predicate to filter out nulls
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

uploadFiles();
