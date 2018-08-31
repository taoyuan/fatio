import * as fs from "fs";
import {Volume} from "../defines";
import {fromCallback} from "../utils";

export class ImageVolume implements Volume {
  sectorSize: number = 512;
  numSectors: number;

  protected fd: number;
  protected readOnly: boolean;

  static create(path, opts?: {readOnly?: boolean}) {
    return new ImageVolume(path, opts);
  }

  constructor(file, opts?: {readOnly?: boolean}) {
    opts = opts || {};

    this.readOnly = opts.readOnly || false;

    this.fd = fs.openSync(file, this.readOnly ? 'r' : 'r+');
    this.numSectors = fs.fstatSync(this.fd).size / this.sectorSize;
  }

  readSectors(i: number, dest: Buffer) {
    return fromCallback(cb => fs.read(this.fd, dest, 0, dest.length, i * this.sectorSize, cb), {multiArgs: true})
      .then(([bytesRead, buffer]) => buffer);
  }

  writeSectors(i: number, data: Buffer) {
    if (this.readOnly) {
      return Promise.resolve({bytesWrite: 0, buffer: Buffer.allocUnsafe(0)})
    }
    return fromCallback(cb => fs.write(this.fd, data, 0, data.length, i * this.sectorSize, cb), {multiArgs: true})
      .then(([bytesWrite, _]) => bytesWrite);
  }
}
