// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IFragmentNFT is IERC721 {

    function initialize(IDatasetNFT dataset, uint256 datasetId) external;


}