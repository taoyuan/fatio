# nfatfs

> A standalone FAT16/FAT32 implementation that takes in a block-access interface and exposes something quite similar to `require('fs')` (i.e. the node.js built-in [Filesystem API](http://nodejs.org/api/fs.html)).

> `nfatfs` is based on [fatfs]()

## Installation

`npm i nfats`

## Example

```js
const nfatfs = require('nfatfs');
const fs = nfatfs.createFileSystem(exampleDriver);      // see below

(async () => {
  const stats = await fs.stat("autoexec.bat");
  console.log(stats);
  // TODO: open a file and write to it or something…
})()
```

## API

* `fs = await nfats.createFileSystem(vol, [opts])` — Simply pass in a block driver (see below) mapped to a FAT partition somewhere, and get back the API documented [here](http://nodejs.org/api/fs.html). An options dictionary can be provided, details are in the next section. You may also optionally provide a callback `cb(err)` which will be automatically registered for the on `'ready'` or `'error'` event.
* `'ready'` event — fired on `fs` when initial volume information has been determined and the API is ready to use. It is safe to call other `fs` methods before this fires **only if** you are sure the first sector will be readable and represents a valid FAT volume.
* `'error'` event — fired if initialization fails for whatever reason.

### Filesystem options

The `opts` dictionary you pass to `nfats.createFileSystem` can contain any of the following options:

* `ro` — Enables readonly mode if `true`. It defaults to `false`, but if your volume driver does not provide a `writeSectors` method it will be overriden to `true`.
* `noatime` — The FAT filesystem can track the last access time (just a date, actually) but this means every read operation would also incur some write overhead. Defaults to `true`, meaning by default access times will **not** be updated on reads. Set this to `false` to track access times.
* `modmode` — chooses how `fs.chmod` (and the mode field from `fs.stat`–family calls) should map FAT attributes to POSIX permissions. Set to the number `0111` to map the readonly flag to the user's write bit being unset, and the archive/system/hidden flags to the user/group/other executable bits respectively. Set to the number `07000` to map the readonly flag to *all* write bits being unset, and the archive/system/hidden flags to the sticky/setgid/setuid bits respectively. Set to `null` for readonly mapping. Defaults to `0111`.
* `umask` — any bits *set* in this octal number will be *unset* in the 'mode' field from `fs.stat`–family calls. It does not affect anything else. Defaults to `process.umask()`, or `0022` if that is unavailable.
* `uid` — This value will be returned as the 'uid' stat field. It does not affect anything else. Defaults to `process.getuid()`, or `0` if that is unavailable.
* `gid` — This value will be returned as the 'gid' stat field. It does not affect anything else. Defaults to `process.getgid()`, or `0` if that is unavailable.

(Note that these are similar to the options you could use with a POSIX `mount` operation.)

And that's it! The [rest of the API](http://nodejs.org/api/fs.html) (`fs.readdir`, `fs.open`, `fs.createReadStream`, `fs.appendFile`, etc.) is as documented by the node.js project.

Well, sort of…

## Caveats

### Temporary

* **BETA** **BETA** **BETA**. Seriously, this is a *brand new*, *from scratch*, *completely unproven* filesystem implementation. It does not have full automated test coverage, and it has not been manually tested very much either. Please please please **make sure you have a backup** of any important drive/image/card you unleash this upon.
* A few methods are not quite implemented, either: `fs.rename`, `fs.unlink` and `fs.rmdir`, as well as `fs.watchFile`/`fs.unwatchFile` and `fs.watch`. These are Coming Soon™.
* There are several internal housekeeping items (redundant FAT tables, extra FAT32 information, etc.) that are not done. These do not seem to affect interop, but you may see warnings when repairing a filesystem written by this module.
* Oh, and not to scare you, but if an IO error happens while writing, the library usually just bails — bubbling an error up to your callback as if it were a hot potato. Although some attempt has been made to do separate writes in the safest order (e.g. allocating an additional file cluster, then appending data into it, and then finally updating the file's size), but this behavior has not been thoroughly audited for all operations. There's certainly no attempt to retry/cleanup/rollback if a multi-step change runs into trouble partway through.

### As-planned

Some of the differences between `nfats` and the node.js `fs` module are "by design" for architectural simplicity and/or due to underlying FAT limitations.

* There are no `fs.*Sync` methods.
* This module does [almost] no read/write caching. This should be done in your volume driver, but see notes below.
* You'll need multiple `createFileSystem` instances for multiple volumes; paths are relative to each, and don't share a namespace.
* The FAT filesystem has no concept of symlinks, and hardlinks are not really an intentional feature. You will get an ENOSYS-like error when trying to create either type of link.


## "Volume driver" API

To use 'nfats', you must provide a driver object with the following properties/methods:

* `driver.sectorSize` — number of bytes per sector on this device
* `driver.numSectors` — count of sectors available on this media
* `driver.readSectors(i, dest) => Promise<Buffer>` — Fill `dest` with data starting at the `i`th sector. You may assume `dest.length` is a multiple of `driver.sectorSize`.
* `driver.writeSectors(i, data) => Promise<void> ` — (optional) Write `data` starting at the `i`th sector. You may assume `data.length` is a multiple of `driver.sectorSize`.

If you do not provide a `writeSectors` method, then `nfats` will work in readonly mode. Pretty simple, eh? And the 'nfats' module makes a good effort to check the parameters passed to your driver methods!

**TBD:** to facilitate proper cache handling, this module might add an optional `driver.flush() => Promise<void>` method at some point in the future.

Here's an example taken from code used to run this module's own tests:

```typescript
// NOTE: this assumes image at `path` has no partition table.
//       If it did, you'd need to translate positions, natch…
import * as fs from "fs";
import {Driver, fromCallback} from "nfatfs";

export function createDriver(path, opts?): Driver {
  opts = opts || {};

  const secSize = 512;
  const ro = opts.readOnly || false;
  const fd = fs.openSync(path, (ro) ? 'r' : 'r+');
  const s = fs.fstatSync(fd);

  return {
    sectorSize: secSize,
    numSectors: s.size / secSize,
    readSectors: (i: number, dest: Buffer): Promise<Buffer> => {
      return fromCallback(cb => fs.read(fd, dest, 0, dest.length, i * secSize, cb), {multiArgs: true})
        .then(([bytesRead, buffer]) => buffer);
    },
    writeSectors: (ro) ? undefined : (i: number, data: Buffer): Promise<any> => {
      return fromCallback(cb => fs.write(fd, data, 0, data.length, i * secSize, cb), {multiArgs: true});
    }
  };
}

```


## License

© 2018 Yuan Tao
