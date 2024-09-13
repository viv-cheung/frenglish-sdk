const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const FrenglishSDK = require('frenglish-sdk').default;

const ORIGIN_LANGUAGE_DIR = 'src/locales/en';  // Adjust this to your origin language directory
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;
const frenglish = new FrenglishSDK(FRENGLISH_API_KEY);

async function getChangedFiles() {
  try {
    // First, try to get changed files between the last two commits
    const output = execSync('git diff --name-only HEAD^ HEAD').toString().trim();
    const changedFiles = output.split('\n').filter(file => file.startsWith(ORIGIN_LANGUAGE_DIR));
    
    if (changedFiles.length > 0) {
      return changedFiles;
    } else {
      console.log('No changed files found in the origin language directory. Falling back to all files.');
    }
  } catch (error) {
    console.log('Error getting changed files:', error.message);
    console.log('Falling back to all files in the origin language directory.');
  }

  // Fallback: get all files in the origin language directory
  const allFiles = execSync(`find ${ORIGIN_LANGUAGE_DIR} -type f`).toString().trim().split('\n');
  return allFiles;
}

async function main() {
  try {
    const filesToTranslate = await getChangedFiles();

    if (filesToTranslate.length === 0) {
      console.log('No files to translate');
      return;
    }

    const fileContents = await Promise.all(filesToTranslate.map(async (file) => {
      const content = await fs.readFile(file, 'utf-8');
      return { fileId: path.basename(file), content };
    }));

    const filenames = fileContents.map(file => file.fileId);
    const contents = fileContents.map(file => file.content);
    
    // Adjust the translate call based on the SDK's expected parameters
    const translation = await frenglish.translate(filenames, contents);
    console.log(`Translation requested with ID: ${translation.translationId}`);

    for (const languageData of translation.content) {
      const language = languageData.language
      const translatedFiles = languageData.files

      for (const translatedFile of translatedFiles) {
        const originalFile = filesToTranslate.find(file => path.basename(file) === translatedFile.fileId);
        if (originalFile) {
          const translatedFilePath = originalFile.replace(`/en/`, `/${language}/`);
          await fs.mkdir(path.dirname(translatedFilePath), { recursive: true });
          await fs.writeFile(translatedFilePath, translatedFile.content);
          console.log(`Translated file written: ${translatedFilePath}`);
        } else {
          console.warn(`Original file not found for translated file: ${translatedFile.fileId}`);
        }
      }
    }
  } catch (error) {
    console.error('Error during translation process:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', await error.response.text());
    }
    process.exit(1);
  }
}

main();