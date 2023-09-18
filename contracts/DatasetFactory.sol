// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IDatasetNFT.sol";
import "./verifier/VerifierManager.sol";
import "./distribution/DistributionManager.sol";
import "./subscription/ERC20LinearSingleDatasetSubscriptionManager.sol";

contract DatasetFactory is Ownable {
    IDatasetNFT public datasetNFT;              // address of DatasetNFT
    address public subscriptionManagerImpl;     // address of deployed ERC20LinearSingleDatasetSubscriptionManager
    address public distributionManagerImpl;     // address of deployed DistributionManager 
    address public verifierManagerImpl;         // address of deployed VerifierManager

    function configure(
        address dataset,
        address subscriptionManager, 
        address distributionManager, 
        address verifierManager
    ) external onlyOwner {
        require(dataset != address(0), "incorrect dataset address");
        require(subscriptionManager != address(0), "incorect subscriptionManager address");
        require(distributionManager != address(0), "incorect distributionManager address");
        require(verifierManager != address(0), "incorect verifierManager address");
        datasetNFT = IDatasetNFT(dataset);
        subscriptionManagerImpl = subscriptionManager;
        distributionManagerImpl = distributionManager;
        verifierManagerImpl = verifierManager;
    }


    function mintAndConfigureDataset(
        address to, bytes calldata mintSignature,
        address defaultVerifier,
        IERC20 feeToken, uint256 feePerConsumerPerDay,
        uint256 dsOwnerFeePercentage,
        bytes32[] calldata tags, uint256[] calldata weights
    ) external {
        uint256 id = datasetNFT.mint(address(this), mintSignature);

        _deployProxies(id);
        _configureVerifierManager(id, defaultVerifier);
        _configureSubscriptionManager(id, feeToken, feePerConsumerPerDay);
        _configureDistributionManager(id, dsOwnerFeePercentage, tags, weights);

        datasetNFT.safeTransferFrom(address(this), to, id);
    }

    function _deployProxies(uint256 id) internal {
        datasetNFT.deployFragmentInstance(id);
        datasetNFT.setManagers(id, IDatasetNFT.ManagersConfig({
            subscriptionManager: subscriptionManagerImpl,
            distributionManager: distributionManagerImpl,
            verifierManager: verifierManagerImpl
        }));        
    }

    function _configureVerifierManager(uint256 id, address defaultVerifier) internal {
        VerifierManager vm = VerifierManager(datasetNFT.verifierManager(id));
        vm.setDefaultVerifier(defaultVerifier);
    }

    function _configureSubscriptionManager(uint256 id, IERC20 feeToken, uint256 feePerConsumerPerDay) internal {
        ERC20LinearSingleDatasetSubscriptionManager sm = ERC20LinearSingleDatasetSubscriptionManager(datasetNFT.subscriptionManager(id));
        sm.setFee(feeToken, feePerConsumerPerDay);
    }

    function _configureDistributionManager(uint256 id, uint256 dsOwnerFeePercentage, bytes32[] calldata tags, uint256[] calldata weights) internal {
        DistributionManager dm = DistributionManager(datasetNFT.distributionManager(id));
        dm.setDatasetOwnerPercentage(dsOwnerFeePercentage);
        dm.setTagWeights(tags, weights);
    }
}
