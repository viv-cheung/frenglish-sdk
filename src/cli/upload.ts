import dotenv from 'dotenv';
import FrenglishSDK from '../sdk';
import { findLanguageFiles, readFiles, validateFiles, getRelativePath } from './utils'; // Import helpers
import { FileContentWithLanguage } from 'src/types/api';

dotenv.config();

const TRANSLATION_PATH = process.env.TRANSLATION_PATH!;
const FRENGLISH_API_KEY = process.env.FRENGLISH_API_KEY;
const EXCLUDED_TRANSLATION_PATH = process.env.EXCLUDED_TRANSLATION_PATH 
  ? JSON.parse(process.env.EXCLUDED_TRANSLATION_PATH.replace(/'/g, '"'))
  : [];

export async function upload(customPath: string = TRANSLATION_PATH, excludePath: string[] = EXCLUDED_TRANSLATION_PATH
) {
  try {
    if (!FRENGLISH_API_KEY) {
      throw new Error('FRENGLISH_API_KEY environment variable is not set');
    }

    const frenglish = new FrenglishSDK(FRENGLISH_API_KEY);
    const supportedLanguages = await frenglish.getSupportedLanguages();
    const supportedFileTypes = await frenglish.getSupportedFileTypes()

    // Find language files using glob
    const languageFiles = await findLanguageFiles(customPath, supportedLanguages, supportedFileTypes, excludePath);
    const filesToUpload: FileContentWithLanguage[] = [];

    // Process each language and its corresponding files
    for (const [language, files] of languageFiles.entries()) {
      if (supportedLanguages.includes(language)) {
        const fileContents = await readFiles(files);
        const validatedFiles = fileContents
          .map((file) => ({
            ...file,
            language,
            fileId: getRelativePath(customPath, file.fileId),
          }))
          .filter((file): file is typeof file & { fileId: string } => file.fileId !== undefined);

        if (!validateFiles(validatedFiles)) {
          console.warn('Some files are invalid');
        }

        filesToUpload.push(...validatedFiles);
      } else {
        console.log(`Skipping unsupported language: ${language}`);
      }
    }

    if (filesToUpload.length === 0) {
      console.log('No valid files to upload.');
      return;
    }

    console.log('Uploading files:');
    filesToUpload.forEach(file => console.log(`- ${file.fileId}`));

    try {
      await frenglish.upload(filesToUpload);
      console.log(`${filesToUpload.length} files uploaded successfully`);
    } catch (uploadError) {
      console.error('Error uploading files:', uploadError);
    }

    console.log('All files processed');
  } catch (error) {
    console.error('Error:', error);
  }
}

// CLI-specific code
if (require.main === module) {
  import('yargs').then(({ default: yargs }) => {
    const argv = yargs(process.argv.slice(2))
      .usage('Usage: $0 <command> [options]')
      .command('upload', 'Upload translation files', {
        path: {
          type: 'string',
          description: 'Specify custom path for uploading files (overrides TRANSLATION_PATH)',
          default: TRANSLATION_PATH,
        },
      })
      .example('$0 upload', 'Upload files using the default TRANSLATION_PATH')
      .example('$0 upload --path ./custom/locales', 'Upload files from a custom directory')
      .help('h')
      .alias('h', 'help')
      .epilog('For more information, visit https://www.frenglish.ai')
      .parse();

    if (argv._.includes('upload')) {
      upload(argv.path as string);
    } else {
      yargs.showHelp();
    }
  });
}