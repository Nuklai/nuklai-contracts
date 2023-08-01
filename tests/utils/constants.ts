import { BytesLike, solidityPackedKeccak256 } from "ethers";

export const SIGNER_ROLE: BytesLike = solidityPackedKeccak256(
  ["string"],
  ["SIGNER_ROLE"]
);
