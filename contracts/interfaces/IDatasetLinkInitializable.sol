// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IDatasetNFT.sol";

interface IDatasetLinkInitializable {
    function initialize(IDatasetNFT dataset, uint256 datasetId) external;
}