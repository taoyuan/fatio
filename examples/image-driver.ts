import * as fs from "fs";
import {Driver, fromCallback} from "..";

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
