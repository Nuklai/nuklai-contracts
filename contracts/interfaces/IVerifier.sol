// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVerifier {
    function propose(address fragmentNFT, uint256 id, bytes32 tag) external;
}