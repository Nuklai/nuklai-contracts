import { AddressLike, getBytes, solidityPacked } from "ethers";

export const getDatasetMintMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: bigint
): Uint8Array => {
  const message = solidityPacked(
    ["uint256", "address", "uint256"],
    [chainId, datasetAddress, datasetId]
  );

  return getBytes(message);
};

export const getDatasetFragmentProposeMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: bigint,
  counter: bigint,
  owner: AddressLike,
  tag: string
): Uint8Array => {
  const proposeMessage = solidityPacked(
    ["uint256", "address", "uint256", "uint256", "address", "bytes32"],
    [chainId, datasetAddress, datasetId, counter, owner, tag]
  );

  return getBytes(proposeMessage);
};

export const getDatasetFragmentProposeBatchMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: bigint,
  counter: bigint,
  owners: AddressLike[],
  tags: string[]
): Uint8Array => {
  const proposeMessage = solidityPacked(
    ["uint256", "address", "uint256", "uint256", "address[]", "bytes32[]"],
    [chainId, datasetAddress, datasetId, counter, owners, tags]
  );

  return getBytes(proposeMessage);
};

export const getDatasetOwnerClaimMessage = (
  chainId: number,
  distributionAddress: AddressLike,
  token: AddressLike,
  amount: bigint,
  beneficiary: AddressLike
): Uint8Array => {
  const datasetOwnerClaimMessage = solidityPacked(
    ["uint256", "address", "address", "uint256", "address"],
    [chainId, distributionAddress, token, amount, beneficiary]
  );

  return getBytes(datasetOwnerClaimMessage);
};

export const getFragmentOwnerClaimMessage = (
  chainId: number,
  distributionAddress: AddressLike,
  beneficiary: AddressLike,
  signatureValidSince: bigint,
  signatureValidTill: bigint
): Uint8Array => {
  const datasetOwnerClaimMessage = solidityPacked(
    ["uint256", "address", "address", "uint256", "uint256"],
    [
      chainId,
      distributionAddress,
      beneficiary,
      signatureValidSince,
      signatureValidTill,
    ]
  );

  return getBytes(datasetOwnerClaimMessage);
};
