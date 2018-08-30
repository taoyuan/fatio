export interface Reader {
  (i: number, dest: Buffer): Promise<Buffer>;
}

export interface Writer {
  (i: number, data: Buffer): Promise<{ bytesWrite: number, buffer: Buffer }>;
}

export interface Driver {
  sectorSize: number;
  numSectors: number;
  readSectors: (i: number, dest: Buffer) => Promise<Buffer>;
  writeSectors: (i: number, data: Buffer) => Promise<number>;
}
