import { solidityPackedKeccak256, toBigInt, keccak256, toUtf8Bytes} from 'ethers';

export const encodeTag = (tag: string): string => {
  return solidityPackedKeccak256(['string'], [tag]);
};

export const getUuidHash = (uuid: string): string => {
  return solidityPackedKeccak256(['string'], [uuid]);  // same as keccak256(toUtf8Bytes(uuid));

}; 

export const getUint256FromBytes32 = (hash: string): bigint => {
  return toBigInt(hash);
}