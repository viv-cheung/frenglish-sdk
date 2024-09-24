#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { translate } from './translate';
import { upload } from './upload';

yargs(hideBin(process.argv))
  .usage('Usage: $0 <command> [options]')
  .command('translate', 'Translate files', (yargs) => {
    return yargs.option('path', {
      type: 'string',
      description: 'Specify a custom path for translation',
      default: process.env.TRANSLATION_PATH
    });
  }, (argv) => {
    translate(argv.path as string);
  })
  .command('upload', 'Upload files for translation', (yargs) => {
    return yargs.option('path', {
      type: 'string',
      description: 'Specify custom path for uploading files',
      default: process.env.TRANSLATION_PATH
    });
  }, (argv) => {
    upload(argv.path as string);
  })
  .demandCommand(1, 'You need at least one command before moving on')
  .help('help')
  .alias('help', 'h')
  .alias('version', 'v')
  .example('$0 translate', 'Translate files using the default path')
  .example('$0 translate --path ./custom/path', 'Translate files from a custom path')
  .example('$0 upload', 'Upload files using the default path')
  .example('$0 upload --path ./custom/path', 'Upload files from a custom path')
  .epilog('For more information, visit https://www.frenglish.ai')
  .wrap(yargs.terminalWidth())
  .parse();