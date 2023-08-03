import { BytesLike, solidityPackedKeccak256 } from "ethers";

export const SIGNER_ROLE: BytesLike = solidityPackedKeccak256(
  ["string"],
  ["SIGNER_ROLE"]
);

export const ONE_DAY = 60 * 60 * 24;
export const ONE_WEEK = ONE_DAY * 7;
