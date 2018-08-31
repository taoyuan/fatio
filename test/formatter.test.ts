import {Formatter} from "../src";
import {MockVolume} from "./fixtures/mocks/mock-volume";

describe('fat', () => {

  describe('fat16', () => {
    it('should define sector struct', async () => {
      const volume = new MockVolume({numSectors: 1024 * 100});
      const formatter = new Formatter(volume);
      await formatter.format32('FATIO-TEST');
      // hex(volume.data);
      // fs.writeFileSync('test.img', volume.data);
    })
  });

});
