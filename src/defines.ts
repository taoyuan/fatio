export interface Driver {
  sectorSize: number;
  numSectors: number;
  readSectors(i: number, dest: Buffer): Promise<Buffer>;
  writeSectors(i: number, data: Buffer): Promise<number>;
}
