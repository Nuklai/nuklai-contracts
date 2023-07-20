// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./VerifierManager.sol";

contract AcceptManuallyVerifier {
    using EnumerableSet for EnumerableSet.UintSet;

    event FragmentPending(address fragmentNFT, uint256 id);
    event FragmentResolved(address fragmentNFT, uint256 id, bool accept);

    mapping(address fragmentNFT => EnumerableSet.UintSet) internal pendingFragments;

    modifier onlyVerifierManager(address fragmentNFT) {
        address verifierManager = IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).verifierManager(IFragmentNFT(fragmentNFT).datasetId());
        require(verifierManager == msg.sender, "Not a VeriferManager");
        _;
    }

    modifier onlyDatasetOwner(address fragmentNFT) {
        address datasetOwner = IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).ownerOf(IFragmentNFT(fragmentNFT).datasetId());
        require(datasetOwner == msg.sender, "Not a Dataset owner");
        _;
    }

    function propose(address fragmentNFT, uint256 id, bytes32 /*tag*/) external onlyVerifierManager(fragmentNFT) {
        pendingFragments[fragmentNFT].add(id);
        emit FragmentPending(fragmentNFT, id);
    }


    function resolve(address fragmentNFT, uint256 id, bool accept) external onlyDatasetOwner(fragmentNFT) {
        VerifierManager vm = VerifierManager(IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).verifierManager(IFragmentNFT(fragmentNFT).datasetId()));
        vm.resolve(id, accept);
        emit FragmentResolved(fragmentNFT, id, accept);
    }
}