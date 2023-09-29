// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {VerifierManager} from "./VerifierManager.sol";

/**
 * @title AcceptAllVerifier contract
 * @author Data Tunnel
 * @notice This contract implements a verifier that accepts all proposals by default
 */
contract AcceptAllVerifier is IVerifier {
  /**
   * @notice Propose function
   * @dev Calls the VerifierManager's resolve function with a 'true' acceptance flag.
   * @param id ID of the pending Fragment to be accepted
   */
  function propose(address /*fragmentNFT*/, uint256 id, bytes32 /*tag*/) external {
    VerifierManager(msg.sender).resolve(id, true);
  }
}
