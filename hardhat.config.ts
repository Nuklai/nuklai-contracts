import 'dotenv/config';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-deploy';
import 'hardhat-deploy-ethers';
import 'hardhat-contract-sizer';
import 'hardhat-dependency-compiler';
import { network } from './utils';
import './tasks';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.18',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
    overrides: {
      'contracts/DatasetFactory.sol': {
        version: '0.8.18',
        settings: {
          viaIR: true,
        },
      },
    },
  },
  networks: {
    goerli: {
      url: network.getNodeUrl('goerli'),
      accounts: network.getAccounts('goerli'),
      verify: {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY_GOERLI,
        },
      },
    },
    fuji: {
      url: network.getNodeUrl('fuji'),
      accounts: network.getAccounts('fuji'),
      verify: {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY_FUJI,
        },
      },
    },
  },
  namedAccounts: {
    dtAdmin: 0,
    user: 1,
    datasetOwner: 2,
    contributor: 3,
    subscriber: 4,
    secondSubscriber: 5,
    consumer: 6,
    secondConsumer: 7,
  },

  dependencyCompiler: {
    paths: [
      'hardhat-deploy/solc_0.8/openzeppelin/proxy/transparent/ProxyAdmin.sol',
      //'hardhat-deploy/solc_0.8/openzeppelin/proxy/transparent/TransparentUpgradeableProxy.sol',
      //'hardhat-deploy/solc_0.8/proxy/OptimizedTransparentUpgradeableProxy.sol'
    ],
  },
};

export default config;
