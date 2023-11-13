/* eslint max-classes-per-file: ["error", 2] */

const { test } = require('tap');
const fs = require('fs-extra');
const path = require('path');
const sandbox = require('@log4js-node/sandboxed-module');
const zlib = require('zlib');
const util = require('util');

const osDelay = process.platform === 'win32' ? 400 : 200;

const sleep = util.promisify(setTimeout);
const gunzip = util.promisify(zlib.gunzip);
const EOL = require('os').EOL || '\n';
const log4js = require('../../lib/log4js');

const removeFile = async (filename) => {
  try {
    await fs.unlink(filename);
  } catch (e) {
    // let's pretend this never happened
  }
};

test('log4js fileAppender', (batch) => {
  batch.test('with default fileAppender settings', async (t) => {
    const testFile = path.join(__dirname, 'fa-default-test.log');
    const logger = log4js.getLogger('default-settings');
    await removeFile(testFile);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await removeFile(testFile);
    });

    log4js.configure({
      appenders: { file: { type: 'file', filename: testFile } },
      categories: { default: { appenders: ['file'], level: 'debug' } },
    });

    logger.info('This should be in the file.');

    await sleep(osDelay);
    const fileContents = await fs.readFile(testFile, 'utf8');
    t.match(fileContents, `This should be in the file.${EOL}`);
    t.match(
      fileContents,
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}] \[INFO] default-settings - /
    );
    t.end();
  });

  batch.test('should give error if invalid filename', async (t) => {
    const file = '';
    t.throws(
      () =>
        log4js.configure({
          appenders: {
            file: {
              type: 'file',
              filename: file,
            },
          },
          categories: {
            default: { appenders: ['file'], level: 'debug' },
          },
        }),
      new Error(`Invalid filename: ${file}`)
    );
    const dir = `.${path.sep}`;
    t.throws(
      () =>
        log4js.configure({
          appenders: {
            file: {
              type: 'file',
              filename: dir,
            },
          },
          categories: {
            default: { appenders: ['file'], level: 'debug' },
          },
        }),
      new Error(`Filename is a directory: ${dir}`)
    );
    t.end();
  });

  batch.test('should flush logs on shutdown', async (t) => {
    const testFile = path.join(__dirname, 'fa-default-test.log');
    const logger = log4js.getLogger('default-settings');
    await removeFile(testFile);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await removeFile(testFile);
    });

    log4js.configure({
      appenders: { test: { type: 'file', filename: testFile } },
      categories: { default: { appenders: ['test'], level: 'trace' } },
    });

    logger.info('1');
    logger.info('2');
    logger.info('3');

    await new Promise((resolve) => {
      log4js.shutdown(resolve);
    });
    const fileContents = await fs.readFile(testFile, 'utf8');
    // 3 lines of output, plus the trailing newline.
    t.equal(fileContents.split(EOL).length, 4);
    t.match(
      fileContents,
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}] \[INFO] default-settings - /
    );
    t.end();
  });

  batch.test('with a max file size and no backups', async (t) => {
    const testFile = path.join(__dirname, 'fa-maxFileSize-test.log');
    const logger = log4js.getLogger('max-file-size');
    await removeFile(testFile);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await removeFile(testFile);
    });

    // log file of 100 bytes maximum, no backups
    log4js.configure({
      appenders: {
        file: {
          type: 'file',
          filename: testFile,
          maxLogSize: 100,
          backups: 0,
        },
      },
      categories: {
        default: { appenders: ['file'], level: 'debug' },
      },
    });

    logger.info('This is the first log message.');
    logger.info('This is an intermediate log message.');
    logger.info('This is the second log message.');
    // wait for the file system to catch up
    await sleep(osDelay * 2);
    const fileContents = await fs.readFile(testFile, 'utf8');
    t.match(fileContents, 'This is the second log message.');
    t.equal(fileContents.indexOf('This is the first log message.'), -1);
    const files = await fs.readdir(__dirname);
    const logFiles = files.filter((file) =>
      file.includes('fa-maxFileSize-test.log')
    );
    t.equal(logFiles.length, 1, 'should be 1 file');
    t.end();
  });

  batch.test('with a max file size in wrong unit mode', async (t) => {
    const invalidUnit = '1Z';
    const expectedError = new Error(`maxLogSize: "${invalidUnit}" is invalid`);
    t.throws(
      () =>
        log4js.configure({
          appenders: {
            file: {
              type: 'file',
              maxLogSize: invalidUnit,
            },
          },
          categories: {
            default: { appenders: ['file'], level: 'debug' },
          },
        }),
      expectedError
    );
    t.end();
  });

  batch.test('with a max file size in unit mode and no backups', async (t) => {
    const testFile = path.join(__dirname, 'fa-maxFileSize-unit-test.log');
    const logger = log4js.getLogger('max-file-size-unit');
    await Promise.all([removeFile(testFile), removeFile(`${testFile}.1`)]);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await Promise.all([removeFile(testFile), removeFile(`${testFile}.1`)]);
    });

    // log file of 1K = 1024 bytes maximum, no backups
    log4js.configure({
      appenders: {
        file: {
          type: 'file',
          filename: testFile,
          maxLogSize: '1K',
          backups: 0,
          layout: { type: 'messagePassThrough' },
        },
      },
      categories: {
        default: { appenders: ['file'], level: 'debug' },
      },
    });
    const maxLine = 22; // 1024 max file size / 47 bytes per line
    for (let i = 0; i < maxLine; i++) {
      logger.info('These are the log messages for the first file.'); // 46 bytes per line + '\n'
    }

    logger.info('This is the second log message.');

    // wait for the file system to catch up
    await sleep(osDelay);
    const fileContents = await fs.readFile(testFile, 'utf8');
    t.match(fileContents, 'This is the second log message.');
    t.notMatch(fileContents, 'These are the log messages for the first file.');
    const files = await fs.readdir(__dirname);
    const logFiles = files.filter((file) =>
      file.includes('fa-maxFileSize-unit-test.log')
    );
    t.equal(logFiles.length, 1, 'should be 1 file');
    t.end();
  });

  batch.test('with a max file size and 2 backups', async (t) => {
    const testFile = path.join(
      __dirname,
      'fa-maxFileSize-with-backups-test.log'
    );
    const logger = log4js.getLogger('max-file-size-backups');
    await Promise.all([
      removeFile(testFile),
      removeFile(`${testFile}.1`),
      removeFile(`${testFile}.2`),
    ]);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await Promise.all([
        removeFile(testFile),
        removeFile(`${testFile}.1`),
        removeFile(`${testFile}.2`),
      ]);
    });

    // log file of 50 bytes maximum, 2 backups
    log4js.configure({
      appenders: {
        file: {
          type: 'file',
          filename: testFile,
          maxLogSize: 50,
          backups: 2,
        },
      },
      categories: { default: { appenders: ['file'], level: 'debug' } },
    });

    logger.info('This is the first log message.');
    logger.info('This is the second log message.');
    logger.info('This is the third log message.');
    logger.info('This is the fourth log message.');
    // give the system a chance to open the stream
    await sleep(osDelay);
    const files = await fs.readdir(__dirname);
    const logFiles = files
      .sort()
      .filter((file) => file.includes('fa-maxFileSize-with-backups-test.log'));
    t.equal(logFiles.length, 3);
    t.same(logFiles, [
      'fa-maxFileSize-with-backups-test.log',
      'fa-maxFileSize-with-backups-test.log.1',
      'fa-maxFileSize-with-backups-test.log.2',
    ]);
    let contents = await fs.readFile(path.join(__dirname, logFiles[0]), 'utf8');
    t.match(contents, 'This is the fourth log message.');
    contents = await fs.readFile(path.join(__dirname, logFiles[1]), 'utf8');
    t.match(contents, 'This is the third log message.');
    contents = await fs.readFile(path.join(__dirname, logFiles[2]), 'utf8');
    t.match(contents, 'This is the second log message.');

    t.end();
  });

  batch.test('with a max file size and 2 compressed backups', async (t) => {
    const testFile = path.join(
      __dirname,
      'fa-maxFileSize-with-backups-compressed-test.log'
    );
    const logger = log4js.getLogger('max-file-size-backups');
    await Promise.all([
      removeFile(testFile),
      removeFile(`${testFile}.1.gz`),
      removeFile(`${testFile}.2.gz`),
    ]);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await Promise.all([
        removeFile(testFile),
        removeFile(`${testFile}.1.gz`),
        removeFile(`${testFile}.2.gz`),
      ]);
    });

    // log file of 50 bytes maximum, 2 backups
    log4js.configure({
      appenders: {
        file: {
          type: 'file',
          filename: testFile,
          maxLogSize: 50,
          backups: 2,
          compress: true,
        },
      },
      categories: { default: { appenders: ['file'], level: 'debug' } },
    });
    logger.info('This is the first log message.');
    logger.info('This is the second log message.');
    logger.info('This is the third log message.');
    logger.info('This is the fourth log message.');
    // give the system a chance to open the stream
    await sleep(osDelay);
    const files = await fs.readdir(__dirname);
    const logFiles = files
      .sort()
      .filter((file) =>
        file.includes('fa-maxFileSize-with-backups-compressed-test.log')
      );
    t.equal(logFiles.length, 3, 'should be 3 files');
    t.same(logFiles, [
      'fa-maxFileSize-with-backups-compressed-test.log',
      'fa-maxFileSize-with-backups-compressed-test.log.1.gz',
      'fa-maxFileSize-with-backups-compressed-test.log.2.gz',
    ]);
    let contents = await fs.readFile(path.join(__dirname, logFiles[0]), 'utf8');
    t.match(contents, 'This is the fourth log message.');

    contents = await gunzip(
      await fs.readFile(path.join(__dirname, logFiles[1]))
    );
    t.match(contents.toString('utf8'), 'This is the third log message.');
    contents = await gunzip(
      await fs.readFile(path.join(__dirname, logFiles[2]))
    );
    t.match(contents.toString('utf8'), 'This is the second log message.');
    t.end();
  });

  batch.test('handling of writer.writable', (t) => {
    const output = [];
    let writable = true;

    const RollingFileStream = class {
      write(loggingEvent) {
        output.push(loggingEvent);
        this.written = true;
        return true;
      }

      // eslint-disable-next-line class-methods-use-this
      on() {}

      // eslint-disable-next-line class-methods-use-this
      get writable() {
        return writable;
      }
    };
    const fileAppender = sandbox.require('../../lib/appenders/file', {
      requires: {
        streamroller: {
          RollingFileStream,
        },
      },
    });

    const appender = fileAppender.configure(
      { filename: 'test1.log', maxLogSize: 100 },
      {
        basicLayout(loggingEvent) {
          return loggingEvent.data;
        },
      }
    );

    t.test('should log when writer.writable=true', (assert) => {
      writable = true;
      appender({ data: 'something to log' });
      assert.ok(output.length, 1);
      assert.match(output[output.length - 1], 'something to log');
      assert.end();
    });

    t.test('should not log when writer.writable=false', (assert) => {
      writable = false;
      appender({ data: 'this should not be logged' });
      assert.ok(output.length, 1);
      assert.notMatch(output[output.length - 1], 'this should not be logged');
      assert.end();
    });

    t.end();
  });

  batch.test('when underlying stream errors', (t) => {
    let consoleArgs;
    let errorHandler;

    const RollingFileStream = class {
      end() {
        this.ended = true;
      }

      on(evt, cb) {
        if (evt === 'error') {
          this.errored = true;
          errorHandler = cb;
        }
      }

      write() {
        this.written = true;
        return true;
      }
    };
    const fileAppender = sandbox.require('../../lib/appenders/file', {
      globals: {
        console: {
          error(...args) {
            consoleArgs = args;
          },
        },
      },
      requires: {
        streamroller: {
          RollingFileStream,
        },
      },
    });

    fileAppender.configure(
      { filename: 'test1.log', maxLogSize: 100 },
      { basicLayout() {} }
    );
    errorHandler({ error: 'aargh' });

    t.test('should log the error to console.error', (assert) => {
      assert.ok(consoleArgs);
      assert.equal(
        consoleArgs[0],
        'log4js.fileAppender - Writing to file %s, error happened '
      );
      assert.equal(consoleArgs[1], 'test1.log');
      assert.equal(consoleArgs[2].error, 'aargh');
      assert.end();
    });
    t.end();
  });

  batch.test('with removeColor fileAppender settings', async (t) => {
    const testFilePlain = path.join(__dirname, 'fa-removeColor-test.log');
    const testFileAsIs = path.join(__dirname, 'fa-asIs-test.log');
    const logger = log4js.getLogger('default-settings');
    await removeFile(testFilePlain);
    await removeFile(testFileAsIs);

    t.teardown(async () => {
      await new Promise((resolve) => {
        log4js.shutdown(resolve);
      });
      await removeFile(testFilePlain);
      await removeFile(testFileAsIs);
    });

    log4js.configure({
      appenders: {
        plainFile: { type: 'file', filename: testFilePlain, removeColor: true },
        asIsFile: { type: 'file', filename: testFileAsIs, removeColor: false },
      },
      categories: {
        default: { appenders: ['plainFile', 'asIsFile'], level: 'debug' },
      },
    });

    logger.info(
      'This should be in the file.',
      '\x1b[33mColor\x1b[0m \x1b[93;41mshould\x1b[0m be \x1b[38;5;8mplain\x1b[0m.',
      {},
      []
    );

    await sleep(osDelay);
    let fileContents = await fs.readFile(testFilePlain, 'utf8');
    t.match(
      fileContents,
      `This should be in the file. Color should be plain. {} []${EOL}`
    );
    t.match(
      fileContents,
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}] \[INFO] default-settings - /
    );

    fileContents = await fs.readFile(testFileAsIs, 'utf8');
    t.match(
      fileContents,
      'This should be in the file.',
      `\x1b[33mColor\x1b[0m \x1b[93;41mshould\x1b[0m be \x1b[38;5;8mplain\x1b[0m. {} []${EOL}`
    );
    t.match(
      fileContents,
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}] \[INFO] default-settings - /
    );
    t.end();
  });

  batch.end();
});
