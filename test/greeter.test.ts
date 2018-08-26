
import { Fs } from "../src/greeter";
import * as chai from "chai";

const expect = chai.expect;

describe("greeter", () => {
  it("should greet with message", () => {
    const greeter = new Fs("friend");
    expect(greeter.greet()).to.equal("Bonjour, friend!");
  });
});
