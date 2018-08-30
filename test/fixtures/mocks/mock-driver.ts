import {Driver} from "../../../src";

export class MockDriver implements Driver {
  data: Buffer;

  sectorSize: number = 512;
  numSectors: number = 1024;

  constructor(opts?: {sectorSize?, numSectors?}) {
    opts = opts || {};

    this.sectorSize = opts.sectorSize || 512;
    this.numSectors = opts.numSectors || 1024;

    this.data = Buffer.alloc(this.sectorSize * this.numSectors);
  }

  async readSectors(i: number, dest: Buffer) {
    const start = i * this.sectorSize;
    this.data.copy(dest, 0, start, start + dest.length);
    return dest;
  }

  async writeSectors(i: number, data: Buffer) {
    return data.copy(this.data, i * this.sectorSize, 0, data.length);
  }
}
