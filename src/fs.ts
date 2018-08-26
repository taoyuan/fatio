import {EventEmitter} from "events";
import * as fatfs from "fatfs";
import {asCallback, fromCallback} from "./utils";

import {PathLike, Stats, WriteStream} from "fs";
import {Readable} from "stream";

export interface Reader {
  (i: number, dest: Buffer): Promise<Buffer>;
}

export interface Writer {
  (i: number, data: Buffer): Promise<{bytesWrite: number, buffer: Buffer}>;
}

export interface Driver {
  sectorSize: number;
  numSectors: number;
  readSectors: Reader;
  writeSectors: Writer | undefined;
}

export interface FileSystemOptions {
  ro?: boolean;
  noatime?: boolean;
  modmode?: number;
  umask?: number;
  uid?: number;
  gid?: number;
}

export function createFileSystem(driver: Driver, opts?: FileSystemOptions) {
  return FileSystem.create(driver, opts);
}

export class FileHandler extends EventEmitter {

  constructor(protected fs: any, public fd: number) {
    super();
  }

  fstat(nested?: boolean): Promise<Stats> {
    return fromCallback(cb => this.fs.fstat(this.fd, cb, toNested(nested)));
  }

  futimes(atime: number | string | Date, mtime: number | string | Date, nested?: boolean) {
    return fromCallback(cb => this.fs.futimes(this.fd, atime, mtime, cb, toNested(nested)));
  }

  fchmod(mode: number, nested?: boolean) {
    return fromCallback(cb => this.fs.fchmod(this.fd, mode, cb, toNested(nested)));
  }

  async read(buffer: Buffer, offset: number, length: number, position: number, nested?: boolean): Promise<{ bytesRead: number, buffer: Buffer }> {
    const [bytesRead, data] = await fromCallback(cb => this.fs.read(this.fd, buffer, offset, length, position, cb, toNested(nested)), {multiArgs: true});
    return {bytesRead, buffer: data};
  }

  async write(buffer: Buffer, offset?: number, length?: number, position?: number, nested?: boolean): Promise<{ bytesWrite: number, buffer: Buffer }> {
    const [bytesWrite, data] = await fromCallback(cb => this.fs.write(this.fd, buffer, offset, length, position, cb, toNested(nested)), {multiArgs: true});
    return {bytesWrite, buffer: data};
  }

  ftruncate(len?: number, nested?: boolean) {
    return fromCallback(cb => this.fs.ftruncate(this.fd, len, cb, toNested(nested)));
  }

  fsync() {
    return fromCallback(cb => this.fs.fsync(this.fd, cb));
  }

  fchown(uid: number, gid: number): Promise<void> {
    return fromCallback(cb => this.fs.fchown(this.fd, uid, gid, cb));
  }

  close() {
    return fromCallback(cb => this.fs.close(this.fd, cb));
  }

}

export class FileSystem extends EventEmitter {

  static create(driver: Driver, opts?: FileSystemOptions) {
    return new FileSystem(fatfs.createFileSystem({
      sectorSize: driver.sectorSize,
      numSectors: driver.numSectors,
      readSectors: (i, dest, cb) => asCallback(driver.readSectors(i, dest), cb),
      writeSectors: driver.writeSectors ? (i, data, cb) => asCallback(driver.writeSectors && driver.writeSectors(i, data), cb) : null,
    }, opts));
  }

  constructor(protected fs) {
    super();

    this.fs.on('ready', () => this.emit('ready'));
    this.fs.on('error', (err) => this.emit('ready', ...arguments));
  }

  /**** ---- CORE API ---- ****/
  async open(path: string, flags: string, mode?: number, nested?: boolean): Promise<FileHandler> {
    // const fd = await fromCallback(cb => this.fs.open(path, flags, mode, cb, toNested(nested)));
    const fd = await fromCallback(cb => {
      const args: any[] = [];
      (mode != null) && args.push(mode);
      args.push(cb);
      this.fs.open(path, flags, ...args);
    });
    return new FileHandler(this.fs, fd);
  }

  fstat(fd: number, nested?: boolean): Promise<Stats> {
    return fromCallback(cb => this.fs.fstat(fd, cb, toNested(nested)));
  }

  futimes(fd: number, atime: number | string | Date, mtime: number | string | Date, nested?: boolean) {
    return fromCallback(cb => this.fs.futimes(fd, atime, mtime, cb, toNested(nested)));
  }

  fchmod(fd: number, mode: number, nested?: boolean) {
    return fromCallback(cb => this.fs.fchmod(fd, mode, cb, toNested(nested)));
  }

  async read(fd: number, buffer: Buffer, offset: number, length: number, position: number, nested?: boolean): Promise<{ bytesRead: number, buffer: Buffer }> {
    const [bytesRead, data] = await fromCallback(cb => this.fs.read(fd, buffer, offset, length, position, cb, toNested(nested)), {multiArgs: true});
    return {bytesRead, buffer: data};
  }

  async write(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number, nested?: boolean): Promise<{ bytesWrite: number, buffer: Buffer }> {
    const [bytesWrite, data] = await fromCallback(cb => this.fs.write(fd, buffer, offset, length, position, cb, toNested(nested)), {multiArgs: true});
    return {bytesWrite, buffer: data};
  }

  ftruncate(fd: number, len?: number, nested?: boolean) {
    return fromCallback(cb => this.fs.ftruncate(fd, len, cb, toNested(nested)));
  }

  fsync(fd: number, ) {
    return fromCallback(cb => this.fs.fsync(fd, cb));
  }

  close(fd: number, ) {
    return fromCallback(cb => this.fs.close(fd, cb));
  }

  /* STREAM WRAPPERS */
  createReadStream(path: PathLike, options?: {
    flags?: string;
    encoding?: string;
    fd?: number;
    mode?: number;
    autoClose?: boolean;
    start?: number;
    end?: number;
    highWaterMark?: number;
  }): Readable {
    return this.fs.createReadStream(path, options);
  }

  createWriteStream(path: PathLike, options?: {
    flags?: string;
    encoding?: string;
    fd?: number;
    mode?: number;
    autoClose?: boolean;
    start?: number;
  }): WriteStream {
    return this.fs.createWriteStream(path, options);
  }

  stat(path: PathLike): Promise<Stats> {
    return fromCallback(cb => this.fs.stat(path, cb));
  }

  lstat(path: PathLike): Promise<Stats> {
    return fromCallback(cb => this.fs.lstat(path, cb));
  }

  exists(path: PathLike): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.fs.exists(path, resolve);
    });
  }

  readFile(path: PathLike | number, options?: { encoding?: string | null; flag?: string; } | null): Promise<Buffer | string> {
    return fromCallback(cb => {
      const args: any[] = [];
      options && args.push(options);
      args.push(cb);
      this.fs.readFile(path, ...args)
    });
  }

  writeFile(path: PathLike | number, data: any, options?: { encoding?: string | null; mode?: number | string; flag?: string; } | string | null): Promise<void> {
    return fromCallback(cb => {
      const args: any[] = [];
      options && args.push(options);
      args.push(cb);
      return this.fs.writeFile(path, data, ...args)
    });
  }

  appendFile(path: PathLike | number, data: any, options?: { encoding?: string | null; mode?: number | string; flag?: string; } | string | null): Promise<void> {
    return fromCallback(cb => {
      const args: any[] = [];
      options && args.push(options);
      args.push(cb);
      this.fs.appendFile(path, data, ...args)
    });
  }

  truncate(path: PathLike, len?: number): Promise<void> {
    return fromCallback(cb => this.fs.truncate(path, len, cb));
  }

  readdir(path: PathLike): Promise<String[]> {
    return fromCallback(cb => this.fs.readdir(path, cb));
  }

  mkdir(path: PathLike, mode?: string | number): Promise<void> {
    return fromCallback(cb => {
      const args: any[] = [];
      mode && args.push(mode);
      args.push(cb);
      this.fs.mkdir(path, ...args)
    });
  }

  utimes(path: PathLike, atime?: string | number | Date, mtime?: string | number | Date): Promise<void> {
    return fromCallback(cb => this.fs.utimes(path, atime, mtime, cb));
  }

  chmod(path: PathLike, mode: string | number): Promise<void> {
    return fromCallback(cb => this.fs.chmod(path, mode, cb));
  }

  lchmod(path: PathLike, mode: string | number): Promise<void> {
    return fromCallback(cb => this.fs.lchmod(path, mode, cb));
  }

  chown(path: PathLike, uid: number, gid: number): Promise<void> {
    return fromCallback(cb => this.fs.chown(path, uid, gid, cb));
  }

  lchown(path: PathLike, uid: number, gid: number): Promise<void> {
    return fromCallback(cb => this.fs.lchown(path, uid, gid, cb));
  }

  /* STUBS */
  link(existingPath: PathLike, newPath: PathLike): Promise<void> {
    return fromCallback(cb => this.fs.link(existingPath, newPath, cb));
  }

  symlink(target: PathLike, path: PathLike, type?: string | null): Promise<void> {
    return fromCallback(cb => {
      const args: any[] = [];
      type && args.push(type);
      args.push(cb);
      this.fs.realpath(path, ...args)
    });
  }

  readlink(path: PathLike): Promise<Buffer> {
    return fromCallback(cb => this.fs.readlink(path, cb));
  }

  realpath(path: PathLike, cache?: boolean): Promise<string> {
    return fromCallback(cb => {
      const args: any[] = [];
      cache && args.push(cache);
      args.push(cb);
      this.fs.realpath(path, ...args)
    });
  }

  fchown(fd: number, handler: FileHandler, uid: number, gid: number): Promise<void> {
    return fromCallback(cb => this.fs.fchown(fd, uid, gid, cb));
  }
}

function toNested(nested?: boolean) {
  return nested ? '_nested_' : undefined;
}
