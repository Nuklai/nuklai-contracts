import { AddressLike, getBytes, solidityPacked } from "ethers";

export const getDatasetMintMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: number,
  ownerAddress: AddressLike
): Uint8Array => {
  const message = solidityPacked(
    ["uint256", "address", "uint256", "address"],
    [chainId, datasetAddress, datasetId, ownerAddress]
  );

  return getBytes(message);
};

export const getDatasetFragmentProposeMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: number,
  fragmentId: number,
  owner: AddressLike,
  tag: string
): Uint8Array => {
  const proposeMessage = solidityPacked(
    ["uint256", "address", "uint256", "uint256", "address", "bytes32"],
    [chainId, datasetAddress, datasetId, fragmentId, owner, tag]
  );

  return getBytes(proposeMessage);
};
