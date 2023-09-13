// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "../interfaces/IDatasetNFT.sol";
import "../interfaces/IFragmentNFT.sol";
import "../interfaces/IVerifierManager.sol";
import "../interfaces/IVerifier.sol";

contract VerifierManager is IVerifierManager, Initializable, Context {

    event FragmentPending(uint256 id);
    event FragmentResolved(uint256 id, bool accept);

    IDatasetNFT public dataset;
    uint256 public datasetId;
    address public defaultVerifier;
    mapping(bytes32 tag => address verifier) public verifiers;
    mapping(uint256 id => bytes32 tag) internal pendingFragmentTags;

    modifier onlyDatasetOwner() {
        require(dataset.ownerOf(datasetId) == _msgSender(), "Not a Dataset owner");
        _;
    }

    modifier onlyFragmentNFT() {
        require(dataset.fragmentNFT(datasetId) == _msgSender(), "Not a Frament NFT for this Dataset");
        _;
    }

    constructor() {
        _disableInitializers();
    }


    function initialize(address dataset_, uint256 datasetId_) external initializer() {
        dataset = IDatasetNFT(dataset_);
        datasetId = datasetId_;
    }

    function setDefaultVerifier(address defaultVerifier_) external onlyDatasetOwner {
        defaultVerifier = defaultVerifier_;
    }

    function setTagVerifier(bytes32 tag, address verifier) external onlyDatasetOwner {
        verifiers[tag] = verifier;
    }

    function setTagVerifiers(bytes32[] calldata tags, address[] calldata verifiers_) external onlyDatasetOwner {
        require(tags.length == verifiers_.length, "Array length missmatch");
        for(uint256 i; i < tags.length; i++){
            verifiers[tags[i]] = verifiers_[i];
        }
    }

    function propose(uint256 id, bytes32 tag) external onlyFragmentNFT {
        address verifier = _verifierForTag(tag);
        require(verifier != address(0), "verifier not set"); 
        
        pendingFragmentTags[id] = tag;
        IVerifier(verifier).propose(_msgSender(), id, tag);
        emit FragmentPending(id);
    }

    function resolve(uint256 id, bool accept) external {
        bytes32 tag = pendingFragmentTags[id];
        address verifier = _verifierForTag(tag);
        require(verifier == _msgSender(), "Wrong verifier");
        IFragmentNFT fragmentNFT = IFragmentNFT(dataset.fragmentNFT(datasetId));
        delete pendingFragmentTags[id];
        if(accept){
            fragmentNFT.accept(id);
        }else{
            fragmentNFT.reject(id);
        }
        emit FragmentResolved(id, accept);
    }


    function _verifierForTag(bytes32 tag) internal view returns(address verifier) {
        verifier = verifiers[tag];
        if(verifier == address(0) && defaultVerifier != address(0)) {
            verifier = defaultVerifier;
        }
    }
}
