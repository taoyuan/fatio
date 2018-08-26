import {EventEmitter} from "events";
import * as fatfs from "fatfs";
import {asCallback, fromCallback} from "./utils";

import {PathLike, Stats, WriteStream} from "fs";
import {Readable} from "stream";

export interface Reader {
  (i: number, dest: Buffer): Promise<Buffer>;
}

export interface Writer {
  (i: number, data: Buffer): Promise<{ bytesWrite: number, buffer: Buffer }>;
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

  constructor(protected fs: FileSystem, public fd: number) {
    super();
  }

  fstat(nested?: boolean): Promise<Stats> {
    return this.fs.fstat(this.fd, nested);
  }

  futimes(atime: number | string | Date, mtime: number | string | Date, nested?: boolean) {
    return this.fs.futimes(this.fd, atime, mtime, nested);
  }

  fchmod(mode: number, nested?: boolean) {
    return this.fs.fchmod(this.fd, mode, nested);
  }

  async read(buffer: Buffer, offset: number, length: number, position: number, nested?: boolean): Promise<{ bytesRead: number, buffer: Buffer }> {
    return this.fs.read(this.fd, buffer, offset, length, position, nested);
  }

  async write(buffer: Buffer, offset?: number, length?: number, position?: number, nested?: boolean): Promise<{ bytesWrite: number, buffer: Buffer }> {
    return this.fs.write(this.fd, buffer, offset, length, position, nested);
  }

  ftruncate(len?: number, nested?: boolean) {
    return this.fs.ftruncate(this.fd, len, nested);
  }

  fsync() {
    return this.fs.fsync(this.fd);
  }

  fchown(uid: number, gid: number): Promise<void> {
    return this.fs.fchown(this.fd, uid, gid);
  }

  close() {
    return this.fs.close(this.fd);
  }

}

export class FileSystem extends EventEmitter {
  protected fs: any;
  ready: Promise<void>;

  static create(driver: Driver, opts?: FileSystemOptions) {
    return new FileSystem(driver, opts);
  }

  constructor(driver: Driver, opts?: FileSystemOptions) {
    super();

    this.ready = new Promise<void>(resolve => {
      this.fs = fatfs.createFileSystem({
        sectorSize: driver.sectorSize,
        numSectors: driver.numSectors,
        readSectors: (i, dest, cb) => asCallback(driver.readSectors(i, dest), cb),
        writeSectors: driver.writeSectors ? (i, data, cb) => asCallback(driver.writeSectors && driver.writeSectors(i, data), cb) : null,
      }, opts, () => resolve());
    });

    this.fs.on('ready', () => this.emit('ready'));
    this.fs.on('error', (err) => this.emit('error', err));
  }

  /**** ---- CORE API ---- ****/
  async open(path: string, flags: string, mode?: number, nested?: boolean): Promise<FileHandler> {
    await this.ready;
    // const fd = await fromCallback(cb => this.fs.open(path, flags, mode, cb, toNested(nested)));
    const fd = await fromCallback(cb => {
      const args: any[] = [];
      (mode != null) && args.push(mode);
      args.push(cb);
      this.fs.open(path, flags, ...args);
    });
    return new FileHandler(this.fs, fd);
  }

  async fstat(fd: number, nested?: boolean): Promise<Stats> {
    await this.ready;
    return fromCallback(cb => this.fs.fstat(fd, cb, toNested(nested)));
  }

  async futimes(fd: number, atime: number | string | Date, mtime: number | string | Date, nested?: boolean) {
    await this.ready;
    return fromCallback(cb => this.fs.futimes(fd, atime, mtime, cb, toNested(nested)));
  }

  async fchmod(fd: number, mode: number, nested?: boolean) {
    await this.ready;
    return fromCallback(cb => this.fs.fchmod(fd, mode, cb, toNested(nested)));
  }

  async read(fd: number, buffer: Buffer, offset: number, length: number, position: number, nested?: boolean): Promise<{ bytesRead: number, buffer: Buffer }> {
    await this.ready;
    const [bytesRead, data] = await fromCallback(cb => this.fs.read(fd, buffer, offset, length, position, cb, toNested(nested)), {multiArgs: true});
    return {bytesRead, buffer: data};
  }

  async write(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number, nested?: boolean): Promise<{ bytesWrite: number, buffer: Buffer }> {
    await this.ready;
    const [bytesWrite, data] = await fromCallback(cb => this.fs.write(fd, buffer, offset, length, position, cb, toNested(nested)), {multiArgs: true});
    return {bytesWrite, buffer: data};
  }

  async ftruncate(fd: number, len?: number, nested?: boolean) {
    await this.ready;
    return fromCallback(cb => this.fs.ftruncate(fd, len, cb, toNested(nested)));
  }

  async fsync(fd: number) {
    await this.ready;
    return fromCallback(cb => this.fs.fsync(fd, cb));
  }

  async close(fd: number) {
    await this.ready;
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

  async stat(path: PathLike): Promise<Stats> {
    await this.ready;
    return fromCallback(cb => this.fs.stat(path, cb));
  }

  async lstat(path: PathLike): Promise<Stats> {
    await this.ready;
    return fromCallback(cb => this.fs.lstat(path, cb));
  }

  async exists(path: PathLike): Promise<boolean> {
    await this.ready;
    return new Promise<boolean>(resolve => {
      this.fs.exists(path, resolve);
    });
  }

  async readFile(path: PathLike | number, options?: { encoding?: string | null; flag?: string; } | null): Promise<Buffer | string> {
    await this.ready;
    return fromCallback(cb => {
      const args: any[] = [];
      options && args.push(options);
      args.push(cb);
      this.fs.readFile(path, ...args)
    });
  }

  async writeFile(path: PathLike | number, data: any, options?: { encoding?: string | null; mode?: number | string; flag?: string; } | string | null): Promise<void> {
    await this.ready;
    return fromCallback(cb => {
      const args: any[] = [];
      options && args.push(options);
      args.push(cb);
      return this.fs.writeFile(path, data, ...args)
    });
  }

  async appendFile(path: PathLike | number, data: any, options?: { encoding?: string | null; mode?: number | string; flag?: string; } | string | null): Promise<void> {
    await this.ready;
    return fromCallback(cb => {
      const args: any[] = [];
      options && args.push(options);
      args.push(cb);
      this.fs.appendFile(path, data, ...args)
    });
  }

  async truncate(path: PathLike, len?: number): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.truncate(path, len, cb));
  }

  async readdir(path: PathLike): Promise<String[]> {
    await this.ready;
    return fromCallback(cb => this.fs.readdir(path, cb));
  }

  async mkdir(path: PathLike, mode?: string | number): Promise<void> {
    await this.ready;
    return fromCallback(cb => {
      const args: any[] = [];
      mode && args.push(mode);
      args.push(cb);
      this.fs.mkdir(path, ...args)
    });
  }

  async utimes(path: PathLike, atime?: string | number | Date, mtime?: string | number | Date): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.utimes(path, atime, mtime, cb));
  }

  async chmod(path: PathLike, mode: string | number): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.chmod(path, mode, cb));
  }

  async lchmod(path: PathLike, mode: string | number): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.lchmod(path, mode, cb));
  }

  async chown(path: PathLike, uid: number, gid: number): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.chown(path, uid, gid, cb));
  }

  async lchown(path: PathLike, uid: number, gid: number): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.lchown(path, uid, gid, cb));
  }

  /* STUBS */
  async link(existingPath: PathLike, newPath: PathLike): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.link(existingPath, newPath, cb));
  }

  async symlink(target: PathLike, path: PathLike, type?: string | null): Promise<void> {
    await this.ready;
    return fromCallback(cb => {
      const args: any[] = [];
      type && args.push(type);
      args.push(cb);
      this.fs.realpath(path, ...args)
    });
  }

  async readlink(path: PathLike): Promise<Buffer> {
    await this.ready;
    return fromCallback(cb => this.fs.readlink(path, cb));
  }

  async realpath(path: PathLike, cache?: boolean): Promise<string> {
    await this.ready;
    return fromCallback(cb => {
      const args: any[] = [];
      cache && args.push(cache);
      args.push(cb);
      this.fs.realpath(path, ...args)
    });
  }

  async fchown(fd: number, uid: number, gid: number): Promise<void> {
    await this.ready;
    return fromCallback(cb => this.fs.fchown(fd, uid, gid, cb));
  }
}

function toNested(nested?: boolean) {
  return nested ? '_nested_' : undefined;
}
