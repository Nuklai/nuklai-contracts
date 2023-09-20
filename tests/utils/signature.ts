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
  fromId: bigint,
  toId: bigint,
  owners: AddressLike[],
  tags: string[]
): Uint8Array => {
  const proposeMessage = solidityPacked(
    [
      "uint256",
      "address",
      "uint256",
      "uint256",
      "uint256",
      "address[]",
      "bytes32[]",
    ],
    [chainId, datasetAddress, datasetId, fromId, toId, owners, tags]
  );

  return getBytes(proposeMessage);
};

export const getDatasetOwnerClaimMessage = (
  chainId: number,
  distributionAddress: AddressLike,
  token: AddressLike,
  amount: bigint,
  beneficiary: AddressLike,
  signatureValidSince: bigint,
  signatureValidTill: bigint
): Uint8Array => {
  const datasetOwnerClaimMessage = solidityPacked(
    [
      "uint256",
      "address",
      "address",
      "uint256",
      "address",
      "uint256",
      "uint256",
    ],
    [
      chainId,
      distributionAddress,
      token,
      amount,
      beneficiary,
      signatureValidSince,
      signatureValidTill,
    ]
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


export const getSetTagWeightsMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  distributionAddress: AddressLike,
  tags: string[],
  weights: bigint[]
): Uint8Array => {
  const datasetOwnerSetTagWeightsMessage = solidityPacked(
    ["uint256", "address", "address", "bytes32[]", "uint256[]"],
    [
      chainId,
      datasetAddress,
      distributionAddress,
      tags,
      weights
    ]
  );

  return getBytes(datasetOwnerSetTagWeightsMessage);
}

export const getSetFeeMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  subscriptionAddress: AddressLike,
  token: AddressLike,
  fee: bigint
): Uint8Array => {
  const datasetOwnerSetFeeMessage = solidityPacked(
    ["uint256", "address", "address", "address", "uint256"],
    [
      chainId,
      datasetAddress,
      subscriptionAddress,
      token,
      fee
    ]
  );

  return getBytes(datasetOwnerSetFeeMessage);
}
