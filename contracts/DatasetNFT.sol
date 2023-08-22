// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IDistributionManager.sol";
import "./interfaces/ISubscriptionManager.sol";
import "./interfaces/IVerifierManager.sol";
import "./interfaces/IDatasetNFT.sol";
import "./interfaces/IFragmentNFT.sol";

contract DatasetNFT is IDatasetNFT, ERC721, AccessControl {
    string private constant NAME = "AllianceBlock DataTunel Dataset";
    string private constant SYMBOL = "ABDTDS";

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    error NOT_OWNER(uint256 id, address account);
    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);

    event ManagersConfigChange(uint256 id);
    event FragmentInstanceDeployement(uint256 id, address instance);
    event DatasetUuidSet(string uuid, uint256 ds);


    address public fragmentImplementation;
    address public deployerFeeBeneficiary;
    uint256 internal mintCounter;
    mapping(uint256 id => ManagersConfig config) public configurations;
    mapping(uint256 id => ManagersConfig proxy) public proxies;
    mapping(uint256 id => IFragmentNFT fragment) public fragments;
    mapping(uint256 => string) public uuids;
    mapping(DeployerFeeModel feeModel => uint256 feePercentage) public deployerFeeModelPercentage;
    mapping(uint256 id => DeployerFeeModel feeModel) public deployerFeeModels;

    modifier onlyTokenOwner(uint256 id) {
        if(_ownerOf(id) != _msgSender()) revert NOT_OWNER(id, _msgSender());
        _;
    }

    constructor() ERC721(NAME, SYMBOL){
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    //TODO handle metadata URI stuff

    /**
     * @notice Mints a Dataset NFT
     * @param to Dataset admin
     * @param signature Signature from a DT service confirming creation of Dataset
     */
    function mint(address to, bytes calldata signature) external {
        require(!Strings.equal(uuids[mintCounter], ""), "No uuid set for data set id");
        bytes32 msgHash = _mintMessageHash(mintCounter, to);
        address signer = ECDSA.recover(msgHash, signature);
        if(!hasRole(SIGNER_ROLE, signer)) revert BAD_SIGNATURE(msgHash, signer);
        _mint(to, mintCounter);
    }

    function setUuidForDatasetId(string memory uuid) external onlyRole(DEFAULT_ADMIN_ROLE) returns(uint256 ds) {
        ds = ++mintCounter;
        uuids[ds] = uuid;

        emit DatasetUuidSet(uuid, ds);
    }

    function setManagers(uint256 id, ManagersConfig calldata config) external onlyTokenOwner(id)  {
        if(configurations[id].subscriptionManager != config.subscriptionManager) {
            proxies[id].subscriptionManager = _cloneAndInitialize(config.subscriptionManager, id);
        }
        if(configurations[id].distributionManager != config.distributionManager) {
            proxies[id].distributionManager = _cloneAndInitialize(config.distributionManager, id);
        }
        if(configurations[id].verifierManager != config.verifierManager) {
            proxies[id].verifierManager = _cloneAndInitialize(config.verifierManager, id);
        }

        configurations[id] = config;
        emit ManagersConfigChange(id);
    }


    function setDeployerFeeModelPercentages(DeployerFeeModel[] calldata models, uint256[] calldata percentages) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(models.length == percentages.length, "array length missmatch");
        for(uint256 i; i < models.length; i++) {
            DeployerFeeModel m = models[i];
            require(uint8(m) != 0, "model 0 always has no fee");
            uint256 p = percentages[i];
            require(p <= 1e18, "percentage can not be more than 100%");
            deployerFeeModelPercentage[m] = p;
        }
    }

    function setDeployerFeeModel(uint256 datasetId, DeployerFeeModel model) external onlyRole(DEFAULT_ADMIN_ROLE) {
        deployerFeeModels[datasetId] = model;
    }

    function setDeployerFeeBeneficiary(address deployerFeeBeneficiary_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        deployerFeeBeneficiary = deployerFeeBeneficiary_;
    }

    function setFragmentImplementation(address fragmentImplementation_) external onlyRole(DEFAULT_ADMIN_ROLE){
        require(fragmentImplementation_ == address(0) || Address.isContract(fragmentImplementation_), "invalid fragment implementation address");
        fragmentImplementation = fragmentImplementation_;
    }

    function deployFragmentInstance(uint256 id) external onlyTokenOwner(id) returns(address){
        require(fragmentImplementation != address(0), "fragment creation disabled");
        require(address(fragments[id]) == address(0), "fragment instance already deployed");
        IFragmentNFT instance = IFragmentNFT(_cloneAndInitialize(fragmentImplementation, id));
        fragments[id] = instance;
        emit FragmentInstanceDeployement(id, address(instance));
        return address(instance);
    }

    function proposeFragment(uint256 datasetId, address to, bytes32 tag, bytes calldata signature) external {
        IFragmentNFT fragmentInstance = fragments[datasetId];
        require(address(fragmentInstance) != address(0), "No fragment instance deployed");
        fragmentInstance.propose(to, tag, signature);
    }

    function proposeManyFragments(
        uint256 datasetId,
        address[] memory owners,
        bytes32[] memory tags,
        bytes calldata signature
    ) external {
        IFragmentNFT fragmentInstance = fragments[datasetId];
        require(address(fragmentInstance) != address(0), "No fragment instance deployed");
        fragmentInstance.proposeMany(owners, tags, signature);
    }


    function isSigner(address account) external view returns(bool) {
        return hasRole(SIGNER_ROLE, account);
    }

    function subscriptionManager(uint256 id) external view returns(address) {
        return proxies[id].subscriptionManager;
    }
    function distributionManager(uint256 id) external view returns(address) {
        return proxies[id].distributionManager;
    }
    function verifierManager(uint256 id) public view returns(address) {
        return proxies[id].verifierManager;
    }
    function fragmentNFT(uint256 id) external view returns(address) {
        return address(fragments[id]);
    }

    function deployerFeePercentage(uint256 id) external view returns(uint256) {
        DeployerFeeModel m = deployerFeeModels[id];
        return deployerFeeModelPercentage[m];
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IDatasetNFT).interfaceId || super.supportsInterface(interfaceId);
    }

    function _cloneAndInitialize(address implementation, uint256 datasetId) internal returns(address proxy)  {
        require(implementation != address(0), "bad implementation address");
        proxy = Clones.clone(implementation);
        IDatasetLinkInitializable(proxy).initialize(address(this), datasetId);
    }



    function _mintMessageHash(uint256 id, address to) private view returns(bytes32) {
        return ECDSA.toEthSignedMessageHash(abi.encodePacked(
            block.chainid,
            address(this),
            id,
            to
        ));
    }

}