// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VerifierManager.sol";

contract AcceptAllVerifier {

    function propose(uint256 id, bytes32 /*tag*/) external {
        VerifierManager(msg.sender).resolve(id,true);
    }
}