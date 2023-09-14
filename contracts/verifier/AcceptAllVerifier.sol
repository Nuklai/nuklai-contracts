// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IVerifier.sol";
import "./VerifierManager.sol";

contract AcceptAllVerifier is IVerifier {

    function propose(address /*fragmentNFT*/, uint256 id, bytes32 /*tag*/) external {
        VerifierManager(msg.sender).resolve(id, true);
    }
}
