// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IDatasetLinkInitializable {
  function initialize(address dataset, uint256 datasetId) external;
}
