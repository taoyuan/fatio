export interface Volume {
  sectorSize: number;
  numSectors: number;
  readSectors(i: number, dest: Buffer): Promise<Buffer>;
  writeSectors(i: number, data: Buffer): Promise<number>;
}
