const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const FrenglishSDK = require('../../frenglish-sdk/src/index');

const ORIGIN_LANGUAGE_DIR = 'src/locales/en';  // Adjust this to your origin language directory
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;

const sdk = new FrenglishSDK(FRENGLISH_API_KEY);

async function getChangedFiles() {
  const output = execSync('git diff --name-only HEAD~1 HEAD').toString().trim();
  return output.split('\n');
}

async function main() {
  const changedFiles = await getChangedFiles();
  const filesToTranslate = changedFiles.filter(file => file.startsWith(ORIGIN_LANGUAGE_DIR));

  if (filesToTranslate.length === 0) {
    console.log('No files to translate');
    return;
  }

  const fileContents = await Promise.all(filesToTranslate.map(async (file) => {
    const content = await fs.readFile(file, 'utf-8');
    return { filename: path.basename(file), content };
  }));

  const filenames = fileContents.map(file => file.filename);
  const contents = fileContents.map(file => file.content);

  try {
    const translationId = await sdk.requestTranslation(filenames, contents);
    console.log(`Translation requested with ID: ${translationId}`);

    let status;
    do {
      await new Promise(resolve => setTimeout(resolve, 5000));  // Wait 5 seconds between checks
      status = await sdk.getTranslationStatus(translationId);
      console.log(`Translation status: ${status}`);
    } while (status !== 'COMPLETED');

    const translation = await sdk.getTranslation(translationId);

    for (const [index, file] of filesToTranslate.entries()) {
      const translatedContent = translation[filenames[index]];
      const translatedFilePath = file.replace('/en/', '/fr/');  // Assuming French translation
      await fs.mkdir(path.dirname(translatedFilePath), { recursive: true });
      await fs.writeFile(translatedFilePath, translatedContent);
      console.log(`Translated file written: ${translatedFilePath}`);
    }
  } catch (error) {
    console.error('Error during translation process:', error);
    process.exit(1);
  }
}

main();