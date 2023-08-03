import { solidityPackedKeccak256 } from "ethers";

export const encodeTag = (tag: string): string => {
  return solidityPackedKeccak256(["string"], [tag]);
};
