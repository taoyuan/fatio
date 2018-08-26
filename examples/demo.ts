import * as _path from "path";
import * as _fs from "fs";
import * as os from "os";
import * as cp from "child_process";
import {createFileSystem, Driver, FileSystem, fromCallback} from "../src";
import {createDriver} from "./image-driver";

const FS_METHODS = [
  'mkdir', 'readdir',
  //'rename','unlink','rmdir',
  'close', 'open', 'fsync',
  'ftruncate', 'truncate',
  'write', 'read', 'readFile', 'writeFile', 'appendFile',

  'chown', 'lchown', 'fchown',
  'chmod', 'lchmod', 'fchmod',
  'utimes', 'futimes',
  'stat', 'lstat', 'fstat', 'exists',
  'link', 'symlink', 'readlink', 'realpath',

  //'watchFile','unwatchFile','watch'
];

(async () => {
  const type = process.argv[2];

  if (!type) {
    throw `Usage: node examples/demo [FAT12|FAT16|FAT32|ExFAT|…|/path/to/image]`;
  } else if (type[0] === '/') {
    await testWithImage(type);
  } else {
    const uniq = Math.random().toString(36).slice(2);
    const img = _path.join(os.tmpdir(), 'nfatfs-demo-' + uniq + ".img");
    const [_, err] = await fromCallback(cb => cp.exec(_path.resolve(__dirname, './make-sample.sh ' + JSON.stringify(img) + ' ' + JSON.stringify(type)), cb), {multiArgs: true});
    console.warn(err);
    try {
      await testWithImage(img);
    } catch (e) {
      throw e;
    } finally {
      _fs.unlink(img, function (e) {
        if (e) console.warn("Error cleaning up test image", e);
      });
    }
  }
})();

async function testWithImage(path) {
  await startTests(createDriver(path));
}

export async function startTests(driver: Driver, waitTime?) {
  const fs = createFileSystem(driver, {umask: 0o0020, uid: 99, gid: 42});
  waitTime = waitTime || 0.5e3;
  FS_METHODS.forEach((method) => {
    assert(method in fs, "fs." + method + " has implementation.");
  });

  const BASE_DIR = "/fat_test-" + Math.random().toFixed(20).slice(2);
  const FILENAME = "Simple File.txt";
  const TEXTDATA = "Hello world!";

  let isReady = false;
  fs.on('ready', function () {
    assert(isReady = true, "Driver is ready.");
  });

  fs.on('error', function (e) {
    assert(e, "If fs driver fires 'error' event, it should include error object.");
    assert(false, "…but driver should not error when initializing in our case.");
  });

  setTimeout(() => assert(isReady, "Driver fired ready event in timely fashion."), waitTime);

  const files = await fs.readdir("/");
  assert(isReady, "Method completed after 'ready' event.");
  assert(Array.isArray(files), "Got a list of files: " + files);

  await fs.mkdir(BASE_DIR);
  let arr = await fs.readdir(BASE_DIR);
  assert(arr.length === 0, "No files in BASE_DIR yet.");

  const file = _path.join(BASE_DIR, FILENAME);
  await fs.writeFile(file, TEXTDATA);
  await startStreamTest(fs, {BASE_DIR, FILENAME, TEXTDATA, waitTime});

  // realpath
  let path = await fs.realpath(file);
  assert(path === file, "We already had the real path.");
  path = await fs.realpath(_path.join(BASE_DIR, ".", "garbage", ".", "..", FILENAME));
  assert(path === file, "Fixed fluffy path matches normal one.");

  try {
    await fs.realpath(_path.join(BASE_DIR, "non", "existent", "path"));
    assert(false, "Should throw exception");
  } catch (e) {
    assert(e, "Expected error calling fs.realpath on non-existent file.");
  }

  // readdir
  arr = await fs.readdir(BASE_DIR);
  assert(arr.length === 2, "Test directory contains two files.");     // (ours + startStreamTests's)
  assert(arr[0] === FILENAME, "Filename is correct.");

  let stats = await fs.stat(file);
  assert(stats.isFile() === true, "Result is a file…");
  assert(stats.isDirectory() === false, "…and not a directory.");
  assert(stats.size === Buffer.byteLength(TEXTDATA), "Size matches length of content written.");

  let exists = await fs.exists(file);
  assert(exists, "File exists.");

  let data = await fs.readFile(file, {encoding: 'utf8'});
  assert(data === TEXTDATA, "Data matches what was written.");

  // now, overwrite the same file and make sure that goes well too
  await fs.writeFile(file, Buffer.from([0x42]));
  arr = await fs.readdir(BASE_DIR);
  assert(arr.length === 2, "Test directory still contains two files.");
  assert(arr[0] === FILENAME, "Filename still correct.");

  stats = await fs.stat(file);
  assert(stats.isFile() === true, "Result is still a file…");
  assert(stats.isDirectory() === false, "…and not a directory.");
  assert(stats.size === 1, "Size matches length of now-truncated content.");

  data = await fs.readFile(file);
  assert(Buffer.isBuffer(data), "Result without encoding is a buffer.");
  assert(data.length === 1, "Buffer is correct size.");
  assert(data[0] === 0x42, "Buffer content is correct.");

  await fs.truncate(file, 1025);
  data = await fs.readFile(file);
  assert(data.length === 1025, "Read after extension is correct size.");
  assert(data[0] === 0x42, "First byte is still correct.");

  let allZeroes = true;
  for (let i = 1, len = data.length; i < len; ++i) if (data[i] !== 0) allZeroes = false;
  assert(allZeroes, "Extended portion of file is zero-filled.");

  await fs.truncate(file, 3);
  data = await fs.readFile(file);
  assert(data.length === 3, "Read after shortening is correct size.");
  assert(data[0] === 0x42, "First byte is still correct.");
  assert(data[1] === 0x00, "Second byte is still correct.");
  assert(data[2] === 0x00, "Third byte is still correct.");
  await proceedWithMoreTests(fs, {BASE_DIR, FILENAME, TEXTDATA, waitTime, file});
}

async function startStreamTest(fs, {BASE_DIR, FILENAME, TEXTDATA, waitTime}) {
  const file = _path.join(BASE_DIR, FILENAME + '2');
  const outStream = fs.createWriteStream(file);
  let outStreamOpened = false;
  outStream.on('open', function (fd) {
    outStreamOpened = true;
    assert(typeof fd === 'number', "Got file descriptor on fs.createWriteStream open.");
  }).on('error', function (e) {
    assert(e, "If fs.createWriteStream fires 'error' event, it should include error object.");
    assert(false, "But, fs.createWriteStream should not error during these tests.");
  });
  setTimeout(function () {
    assert(outStreamOpened, "outStream fired 'open' event in a timely fashion.");
  }, waitTime);

  const TEXT_MOD = TEXTDATA.toLowerCase() + "\n";
  const NUM_REPS = (waitTime <= 1e3) ? 1024 : 16;
  outStream.write(TEXT_MOD, 'utf16le');
  outStream.write("Ο καλύτερος χρόνος να φυτευτεί ένα \ud83c\udf31 είναι δέκα έτη πριν.", 'utf16le');
  outStream.write("La vez del segundo mejor ahora está.\n", 'utf16le');
  for (let i = 0; i < NUM_REPS; ++i) outStream.write("123456789\n", 'ascii');
  outStream.write("JavaScript how do they work\n", 'utf16le');
  outStream.write("The end, almost.\n", 'utf16le');
  outStream.end(TEXTDATA, 'utf16le');
  let outStreamFinished = false;
  outStream.on('finish', async () => {
    outStreamFinished = true;

    const inStream = fs.createReadStream(file, {start: NUM_REPS * 10, encoding: 'utf16le', autoClose: false});
    let gotData = false, gotEOF = false, inStreamFD = null;
    inStream.on('open', function (fd) {
      assert(typeof fd === 'number', "Got file descriptor on fs.createReadStream open.");
      inStreamFD = fd;
    });
    inStream.on('data', function (d) {
      gotData = true;
      assert(typeof d === 'string', "Data returned as string.");
      assert(d.slice(d.length - TEXTDATA.length) === TEXTDATA, "End of file matches what was written.");
    });
    inStream.on('end', async () => {
      gotEOF = true;

      const len = Buffer.byteLength(TEXT_MOD, 'utf16le');
      const buf = new Buffer(len);
      await fs.fsync(inStreamFD);
      try {
        await fs.fsync('garbage');
        assert(false, "Should throw exception");
      } catch (e) {
        assert(e, "Expected error from garbage fsync.");
      }

      const {bytesRead, buffer} = await fs.read(inStreamFD, buf, 0, len, 0);
      // assert(!e, "No error reading from beginning of inStream's file descriptor.");
      assert(bytesRead === len, "Read complete buffer at beginning of inStream's fd.");
      assert(buffer.toString('utf16le') === TEXT_MOD, "Data matches at beginning of inStream's fd.");
      await fs.close(inStreamFD);
    });
    setTimeout(function () {
      assert(gotData, "inStream fired 'data' event in a timely fashion.");
      setTimeout(function () {
        assert(gotEOF, "inStream fired 'eof' event in a timely fashion.");
      }, waitTime);
    }, waitTime);
  });
  setTimeout(function () {
    assert(outStreamFinished, "outStream fired 'finish' event in a timely fashion.");
  }, 2 * waitTime);
}

async function proceedWithMoreTests(fs: FileSystem, {BASE_DIR, FILENAME, TEXTDATA, waitTime, file}) {
  let {fd} = await fs.open(file, 'r');
  const was = "\u0042\u0000\u0000";
  const str = "abc";

  await fs.appendFile(file, str);
  assert(fd, "File descriptor opened before appendFile called.");
  const buf = new Buffer(str.length);

  let bytesRead: number;
  let buffer: Buffer;

  ({bytesRead, buffer} = await fs.read(fd, buf, 0, buf.length, was.length));
  assert(bytesRead === str.length, "All appended data was readable.");
  assert(buffer === buf, "Buffer returned from fs.read matched what was passed in.");
  assert(buffer.toString() === str, "Correct data found where expected.");

  let data = await fs.readFile(file, {encoding: 'ascii'});
  assert(data.length === 6, "Read is correct size after append.");
  assert(data === was + str, "Read string matches what was written and then appended.");

  let {fd: fd2} = await fs.open(file, 'a');
  const str2 = "zyx";
  const buf2 = new Buffer(str2.length + 2);

  buf2.write(str2, 1);
  let bytesWrite: number;
  ({bytesWrite, buffer} = await fs.write(fd2, buf2, 1, buf2.length - 2, was.length));
  assert(bytesWrite === buf2.length - 2, "Wrote proper amount from buffer.");
  assert(buffer === buf2, "Returned original buffer.");
  buf2.fill(0);
  buf2[0] = 0xFF;

  ({bytesRead, buffer} = await fs.read(fd, buf2, 1, buf2.length - 1, was.length));
  assert(bytesRead === buf2.length - 1, "Read proper amount into buffer.");
  assert(buf2[0] === 0xFF, "Read left first byte in buffer properly alone.");
  assert(buffer.slice(1).toString() === (str + str2).slice(0, buf2.length - 1), "Data was appended, not written at position.");

  const F = _path.join(BASE_DIR, "Manually inspect from time to time, please!.txt");
  const S = 512;
  const N = 16;
  const b = new Buffer(S * N);
  for (let i = 0; i < N; ++i) b.slice(S * i, S * i + S).fill(i.toString(16).charCodeAt(0));

  await fs.writeFile(F, b);
  data = await fs.readFile(F);
  assert(data.length === b.length, "Readback is correct size");
  let matched = true;
  for (let i = 0; i < S * N; ++i) if (b[i] !== data[i]) matched = false;
  assert(matched, "Readback matches write byte-for-byte");

  let stats = await fs.stat(F);
  assert(stats.atime instanceof Date && !isNaN(stats.atime.getTime()), "Access time is a valid date.");
  assert(stats.mtime instanceof Date && !isNaN(stats.mtime.getTime()), "Modify time is a valid date.");
  assert(stats.ctime instanceof Date && !isNaN(stats.ctime.getTime()), "Change^WCreate time is a valid date.");
  let tf = stats.ctime.getTime();
  let ct = Date.now();
  assert(tf - 2 * waitTime < ct && ct < tf + 2 * waitTime, "Create time is within ± two `waitTime`s of now.");

  assert(stats.uid === 99, "Desired UID applied.");
  assert(stats.gid === 42, "Desired GID applied.");
  assert(stats.mode & 0o0100, "Archive bit is set.");
  assert(stats.mode & 0o0200, "Writable perm is set for user.");
  assert((stats.mode & 0o0022) === 0o0002, "Writable perm is only masked out for group.");

  try {
    await fs.chown(F, 99, 256);
  } catch (e) {
    assert(e && e.code === 'NOSYS', "Expected error from fs.fchown.");
  }

  await fs.utimes(F, new Date(2009, 7 - 1, 2));
  await fs.chmod(F, 0o422);

  const stats2 = await fs.stat(F);
  assert(+stats.ctime === +stats2.ctime, "Create time not changed by fs.utimes");
  assert(stats2.atime.toString().indexOf("Jul 02 2009 00:00:00") === 4, "Access time set correctly");
  let tf2 = stats2.mtime.getTime();
  let ct2 = Date.now();
  assert(tf2 - 2e3 < ct2 && ct2 < tf2 + 2e3 + waitTime, "Modify time is within ± a few seconds of now.");

  // NOTE: due to serialization, this can check results of the `fs.chmod` below, too!
  assert(!(stats2.mode & 0o0100), "Archive bit is now unset.");
  assert(!(stats2.mode & 0o0222), "Writable perms are unset.");
  assert(stats2.mode & 0o0100000, "Regular file bit is set.");
}

function assert(b, msg) {
  if (!msg) console.warn("no msg", Error().stack);
  if (!b) throw Error("Assertion failure. " + msg);
  console.log(msg);
}
