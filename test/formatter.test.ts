import hex = require('hex');
import fs = require('fs');

import {Formatter} from "../src";
import {MockDriver} from "./fixtures/mocks/mock-driver";

describe('fat', () => {

  describe('fat16', () => {
    it('should define sector struct', async () => {
      const driver = new MockDriver({numSectors: 1024 * 100});
      const formatter = new Formatter(driver);
      await formatter.format32('FATIO-TEST');
      // hex(driver.data);
      fs.writeFileSync('test.img', driver.data);
    })
  });

});
